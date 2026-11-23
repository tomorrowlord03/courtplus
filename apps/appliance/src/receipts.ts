import { createPublicKey, verify } from 'node:crypto';
import type { CourtPlusApi } from '@courtplus/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, canonical, sha256, type Db } from './db.js';
import { html, HttpError, page, parse, requireValue } from './http.js';
import { digest, envelopes, receiptId, date, timestamp } from './inputs.js';

const signature = z.string().regex(/^[a-zA-Z0-9_-]{86}$/);
const officeName = z.string().trim().min(3).max(120).regex(/^[\p{L}\p{M}\p{N} .(),&/-]+$/u);
const receiptSchema = z.strictObject({
  signature,
  payload: z.strictObject({
    kind: z.literal('courtplus-receipt-v1'), receiptId, issuer: officeName, keyId: digest,
    ruleVersion: z.string().regex(/^rules-[\w.-]{1,64}$/), asOf: date,
    inputsDigest: digest, resultDigest: digest, traceDigest: digest,
    result: z.enum(['APPLY_NOW', 'DUE_IN_N_DAYS', 'NEEDS_LAWYER_REVIEW', 'OUTSIDE_SCREEN']),
    createdAt: timestamp,
  }),
});
const manifestSchema = z.strictObject({
  signature,
  payload: z.strictObject({
    kind: z.literal('courtplus-manifest-v1'), keyId: digest, receiptDigest: digest, pdfDigest: digest,
  }),
});
type Receipt = z.infer<typeof receiptSchema>;
type Manifest = z.infer<typeof manifestSchema>;
type Issuer = { office: string; publicKey: string };
type Stored = { receipt: string; manifest: string; withdrawn: 0 | 1 };
type Checked = { signature: 'unknown_signer' | 'invalid' } | {
  signature: 'valid'; issuer: Issuer; receipt: Receipt; manifest: Manifest;
};

function decode<T>(schema: z.ZodType<T>, json: string): T | undefined {
  try {
    const value = schema.safeParse(JSON.parse(json) as unknown);
    return value.success ? value.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function addIssuer(db: Db, office: string, pem: string): string {
  const label = parse(officeName, office);
  if (!pem.includes('-----BEGIN PUBLIC KEY-----') || pem.includes('PRIVATE KEY')) {
    throw new Error('Expected an Ed25519 SPKI public key');
  }
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 key');
  const keyId = sha256(key.export({ type: 'spki', format: 'der' }));
  db.transaction(() => {
    db.prepare('INSERT INTO issuers VALUES (?, ?, ?)').run(keyId, key.export({ type: 'spki', format: 'pem' }), label);
    audit(db, 'operator', 'issuer.add', { keyId, office: label });
  }).immediate();
  return keyId;
}

export function createReceipts(db: Db) {
  const lookup = db.prepare<[string], Stored>('SELECT receipt, manifest, withdrawn FROM receipts WHERE id = ?');
  const issuer = db.prepare<[string], Issuer>('SELECT public_key AS publicKey, office FROM issuers WHERE key_id = ?');

  function check(packageData: { receipt: string; manifest: string }): Checked {
    const receipt = decode(receiptSchema, packageData.receipt);
    const manifest = decode(manifestSchema, packageData.manifest);
    if (!receipt || !manifest || receipt.payload.keyId !== manifest.payload.keyId
      || manifest.payload.receiptDigest !== sha256(canonical(receipt))) return { signature: 'invalid' };
    const trusted = issuer.get(receipt.payload.keyId);
    if (!trusted) return { signature: 'unknown_signer' };
    const key = createPublicKey(trusted.publicKey);
    for (const envelope of [receipt, manifest]) {
      const bytes = Buffer.from(envelope.signature, 'base64url');
      if (bytes.toString('base64url') !== envelope.signature
        || !verify(null, Buffer.from(canonical(envelope.payload)), key, bytes)) return { signature: 'invalid' };
    }
    if (receipt.payload.issuer !== trusted.office) return { signature: 'invalid' };
    return { signature: 'valid', receipt, manifest, issuer: trusted };
  }

  const publish = db.transaction((input: { receipt: string; manifest: string }, actor: string) => {
    const checked = check(input);
    if (checked.signature !== 'valid') throw new HttpError(422, checked.signature.toUpperCase());
    const id = checked.receipt.payload.receiptId;
    const receipt = canonical(checked.receipt);
    const manifest = canonical(checked.manifest);
    const existing = lookup.get(id);
    if (existing) {
      if (receipt !== existing.receipt || manifest !== existing.manifest) throw new HttpError(409, 'RECEIPT_CONFLICT');
      return { id, created: false };
    }
    db.prepare('INSERT INTO receipts (id, key_id, receipt, manifest) VALUES (?, ?, ?, ?)')
      .run(id, checked.receipt.payload.keyId, receipt, manifest);
    audit(db, actor, 'receipt.publish', { id, fingerprint: checked.manifest.payload.pdfDigest });
    return { id, created: true };
  });

  const withdraw = db.transaction((id: string, actor: string) => {
    const previous = requireValue(lookup.get(id), 'RECEIPT_NOT_FOUND');
    if (previous.withdrawn === 1) return;
    db.prepare('UPDATE receipts SET withdrawn = 1 WHERE id = ?').run(id);
    audit(db, actor, 'receipt.withdraw', { id });
  });

  function verifyDigest(input: { receipt: string; manifest: string; pdfDigest: string }): Awaited<ReturnType<CourtPlusApi['verify']>> {
    const checked = check(input);
    const unchanged = checked.signature === 'valid' && checked.manifest.payload.pdfDigest === input.pdfDigest;
    return { signature: checked.signature, pdf: unchanged ? 'unchanged' : 'changed', chain: 'not_checked' };
  }
  function verifyBundle({ pdf, ...envelopes }: Parameters<CourtPlusApi['verify']>[0]) {
    return verifyDigest({ ...envelopes, pdfDigest: sha256(pdf) });
  }

  return { check, lookup: (id: string) => lookup.get(id), publish: publish.immediate, withdraw: withdraw.immediate, verifyBundle, verifyDigest };
}
export type Receipts = ReturnType<typeof createReceipts>;

const statusLabels: Record<Receipt['payload']['result'], string> = {
  APPLY_NOW: 'Apply now', DUE_IN_N_DAYS: 'Due soon',
  NEEDS_LAWYER_REVIEW: 'Needs lawyer review', OUTSIDE_SCREEN: 'Outside screen',
};

export function receiptRoutes(
  app: FastifyInstance, receipts: Receipts, origin: string,
  authorize: (request: FastifyRequest, action: 'publish' | 'withdraw') => { id: string },
) {
  const params = z.object({ receiptId });
  app.post('/api/receipts', { bodyLimit: 12 * 1024 }, async (request, reply) => {
    const user = authorize(request, 'publish');
    const { id, created } = receipts.publish(parse(envelopes, request.body), user.id);
    return reply.code(created ? 201 : 200).send({ receiptId: id, url: origin + '/v/' + id });
  });
  app.post('/api/receipts/:receiptId/withdraw', async (request, reply) => {
    const user = authorize(request, 'withdraw');
    receipts.withdraw(parse(params, request.params).receiptId, user.id);
    return reply.code(204).send();
  });
  app.get('/v/:receiptId', { config: { rateLimit: { max: 30 } } }, async (request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    const id = params.safeParse(request.params);
    const stored = id.success ? receipts.lookup(id.data.receiptId) : undefined;
    if (!stored) return page(reply.code(404), 'Receipt unavailable', '<p>No published receipt was found.</p>');
    const entry = receipts.check(stored);
    if (entry.signature !== 'valid') {
      return page(reply, 'Verify CourtPlus draft', '<p>Signature invalid or issuing office unknown.</p>');
    }
    const fields = [
      ['Signature', 'Valid'],
      ['Document fingerprint (SHA-256)', entry.manifest.payload.pdfDigest],
      ['Issuing office', entry.issuer.office],
      ['Status', stored.withdrawn ? 'Withdrawn' : 'Current'],
      ['Screening status at issue', statusLabels[entry.receipt.payload.result]],
    ];
    return page(reply, 'Verify CourtPlus draft', '<dl>' + fields.map(([label, value]) =>
      '<dt>' + html(label) + '</dt><dd>' + html(value) + '</dd>').join('') + '</dl>' +
      '<p>The fingerprint identifies the signed draft. Compare it with your copy to check that the file is unchanged.</p>');
  });
}
