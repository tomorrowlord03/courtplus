import { createHash, createPublicKey, verify } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CaseRecord, PublicCaseTrack, SignedHearingPublication } from '@courtplus/contracts';
import { audit, canonical, type Db } from './db.js';
import { HttpError, parse } from './http.js';
import type { Session } from './auth.js';

const date = z.iso.date();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const publication = z.strictObject({
  payload: z.strictObject({
    kind: z.literal('courtplus-hearing-summary-v1'),
    caseRef: z.string().trim().min(3).max(100),
    recordingId: z.uuid(), hearingDate: date, nextDate: date.nullable(),
    summary: z.string().trim().min(20).max(10_000), approvedAt: z.iso.datetime(),
  }),
  hash: digest, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  keyId: digest, publicKey: z.string().min(80).max(2000),
});
const reference = z.string().trim().min(3).max(100).regex(/^[\p{L}\p{N}\s./_-]+$/u);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const normalise = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function validSignature(item: SignedHearingPublication): boolean {
  try {
    const key = createPublicKey(item.publicKey);
    const bytes = Buffer.from(item.signature, 'base64url');
    return key.asymmetricKeyType === 'ed25519'
      && sha256(key.export({ type: 'spki', format: 'der' })) === item.keyId
      && sha256(canonical(item.payload)) === item.hash
      && bytes.toString('base64url') === item.signature
      && verify(null, Buffer.from(canonical(item.payload)), key, bytes);
  } catch { return false; }
}

export function registerHearingRoutes(app: FastifyInstance, db: Db,
  authorize: (request: FastifyRequest, roles: readonly ('judge' | 'admin')[], write: boolean) => Session) {
  db.exec(`CREATE TABLE IF NOT EXISTS published_hearing_summaries (
    recording_id TEXT PRIMARY KEY, case_ref TEXT NOT NULL, hearing_date TEXT NOT NULL,
    signed_json TEXT NOT NULL CHECK (json_valid(signed_json)), actor TEXT NOT NULL) STRICT`);
  db.exec('CREATE INDEX IF NOT EXISTS published_hearing_case ON published_hearing_summaries(case_ref)');

  app.post('/api/hearings/summary', {
    bodyLimit: 16 * 1024, config: { rateLimit: { max: 12 } },
    preParsing: async request => { authorize(request, ['judge', 'admin'], true); },
  }, async (request, reply) => {
    const actor = authorize(request, ['judge', 'admin'], true);
    const item = parse(publication, request.body);
    if (!validSignature(item)) throw new HttpError(400, 'INVALID_SIGNATURE');
    const record = db.prepare<[], { data: string }>('SELECT data FROM cases').all()
      .map(row => JSON.parse(row.data) as CaseRecord)
      .find(row => [row.cnr, row.caseNo, row.id].some(value => value && normalise(value) === normalise(item.payload.caseRef)));
    if (!record) throw new HttpError(404, 'CASE_NOT_FOUND');
    if (db.prepare<[string], { recording_id: string }>('SELECT recording_id FROM published_hearing_summaries WHERE recording_id = ?')
      .get(item.payload.recordingId)) throw new HttpError(409, 'ALREADY_PUBLISHED');
    db.transaction(() => {
      db.prepare('INSERT INTO published_hearing_summaries VALUES (?, ?, ?, ?, ?)')
        .run(item.payload.recordingId, normalise(item.payload.caseRef), item.payload.hearingDate, canonical(item), actor.id);
      audit(db, actor.id, 'hearing.summary.publish', {
        recordingId: item.payload.recordingId, caseRef: normalise(item.payload.caseRef), hash: item.hash,
      });
    }).immediate();
    return reply.code(201).send({ published: true });
  });

  app.get('/track/:caseRef', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const { caseRef } = parse(z.strictObject({ caseRef: reference }), request.params);
    const wanted = normalise(caseRef);
    const record = db.prepare<[], { data: string }>('SELECT data FROM cases').all()
      .map(row => JSON.parse(row.data) as CaseRecord)
      .find(row => [row.cnr, row.caseNo, row.id].some(value => value && normalise(value) === wanted));
    const rows = db.prepare<[string], { signed_json: string }>(
      'SELECT signed_json FROM published_hearing_summaries WHERE case_ref = ? ORDER BY hearing_date DESC').all(wanted);
    if (!record && !rows.length) throw new HttpError(404, 'CASE_NOT_FOUND');
    const summaries = rows.map(row => {
      const signed = JSON.parse(row.signed_json) as SignedHearingPublication;
      return {
        hearingDate: signed.payload.hearingDate, nextDate: signed.payload.nextDate,
        summary: signed.payload.summary, verification: validSignature(signed) ? 'valid' as const : 'invalid' as const,
      };
    });
    const hearingDates = [...new Set([
      ...(record?.events.filter(event => event.kind === 'hearing').map(event => event.on) ?? []),
      ...summaries.map(item => item.hearingDate),
    ])].sort();
    const nextDate = summaries.find(item => item.nextDate)?.nextDate
      ?? record?.events.filter(event => event.kind === 'hearing' && event.on > new Date().toISOString().slice(0, 10))
        .sort((a, b) => a.on.localeCompare(b.on))[0]?.on ?? null;
    return { stage: record?.pendingStatus ?? null, hearingDates, nextDate, summaries } satisfies PublicCaseTrack;
  });
}
