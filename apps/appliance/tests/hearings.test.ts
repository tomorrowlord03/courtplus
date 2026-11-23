import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HearingPublicationPayload, SignedHearingPublication } from '@courtplus/contracts';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { canonical, openDb, verifyAudit, type Db } from '../src/db.js';

describe('published hearing summaries', () => {
  const origin = 'https://fictional-court.test';
  const password = 'fictional test password 123';
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  let directory: string;
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let judge: string;
  let lawyer: string;

  const signed = (payload: HearingPublicationPayload): SignedHearingPublication => ({
    payload, publicKey, keyId,
    hash: createHash('sha256').update(canonical(payload)).digest('hex'),
    signature: sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString('base64url'),
  });

  async function login(username: string) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { origin }, payload: { username, password, client: 'desktop' } });
    expect(response.statusCode).toBe(200);
    return 'Bearer ' + response.json<{ token: string }>().token;
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-hearings-'));
    const secret = join(directory, 'db.key');
    writeFileSync(secret, randomBytes(32).toString('hex'));
    db = openDb(join(directory, 'db.sqlite3'), secret);
    await addAccount(db, 'fictional_judge', password, 'judge');
    await addAccount(db, 'fictional_lawyer', password, 'legal_aid');
    db.prepare('INSERT INTO persons VALUES (?, ?)').run('p123', JSON.stringify({ id: 'p123', alias: 'Fictional Private Name' }));
    db.prepare('INSERT INTO cases VALUES (?, ?, ?)').run('c123', 'p123', JSON.stringify({
      id: 'c123', personId: 'p123', cnr: 'FICTIONAL-123', pendingStatus: 'trial',
      events: [{ kind: 'hearing', on: '2026-11-20', note: 'Fictional Private Name attended' },
        { kind: 'hearing', on: '2026-12-01' }],
    }));
    app = await buildApp({ db, origin });
    judge = await login('fictional_judge');
    lawyer = await login('fictional_lawyer');
  });

  afterAll(async () => {
    await app?.close(); db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('requires a judge, verifies the signature and publishes only approved text', async () => {
    const payload: HearingPublicationPayload = {
      kind: 'courtplus-hearing-summary-v1', caseRef: 'FICTIONAL-123', recordingId: randomUUID(),
      hearingDate: '2026-11-20', nextDate: '2026-12-01',
      summary: 'The court heard the parties and fixed the next hearing date.', approvedAt: '2026-11-23T00:00:00.000Z',
    };
    const item = signed(payload);
    const send = (authorization: string, body: object) => app.inject({
      method: 'POST', url: '/api/hearings/summary', headers: { authorization }, payload: body,
    });
    expect((await send(lawyer, item)).statusCode).toBe(403);
    expect((await send(judge, { ...item, payload: { ...payload, summary: 'Tampered summary of the fictional hearing.' } })).statusCode).toBe(400);
    expect((await send(judge, item)).statusCode).toBe(201);
    const response = await app.inject('/track/FICTIONAL-123');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stage: 'trial', nextDate: '2026-12-01',
      summaries: [{ summary: payload.summary, verification: 'valid' }] });
    expect(response.body).not.toContain('Fictional Private Name');
    expect(response.body).not.toContain('personId');
    expect(verifyAudit(db).valid).toBe(true);
  });
});
