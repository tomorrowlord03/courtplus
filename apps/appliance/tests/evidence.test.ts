import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { openDb, verifyEvidenceLog, type Db } from '../src/db.js';
import { detectMagicBytes, MAX_FILE_SIZE, validateFileBytes } from '../src/evidence.js';

describe('Evidence Vault and Citizen Bridge (w29)', () => {
  const origin = 'https://courtplus.example.test';
  const dbKey = randomBytes(32).toString('hex');
  let directory: string;
  let secret: string;
  let dbFile: string;
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let judgeAuthHeader: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-evidence-test-'));
    secret = join(directory, 'db.key');
    writeFileSync(secret, dbKey, { mode: 0o600 });
    dbFile = join(directory, 'test.sqlite3');
    db = openDb(dbFile, secret);

    await addAccount(db, 'fictional_judge', 'fictional password 12345', 'superintendent');

    app = await buildApp({
      db,
      origin,
      evidenceDir: join(directory, 'vault'),
      office: 'Fictional Sessions Court Evidence Vault',
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'fictional_judge', password: 'fictional password 12345', client: 'desktop' }),
    });
    const loginData = JSON.parse(loginRes.body);
    judgeAuthHeader = 'Bearer ' + loginData.token;
  });

  afterAll(async () => {
    await app.close();
    db.close();
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {}
  });

  // Valid fixture files
  const validPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const validPdf = Buffer.from('%PDF-1.4\n%Fictional evidence PDF document payload\n%%EOF');
  const validJpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

  test('magic-byte rejection on corrupted or mismatched file', () => {
    // 1. Text pretending to be PDF
    const fakePdf = Buffer.from('This is pure plain text pretending to be a court pdf');
    expect(() => validateFileBytes(fakePdf, 'order.pdf')).toThrow();

    // 2. Text pretending to be JPEG
    const fakeJpg = Buffer.from('Not a real jpeg image');
    expect(() => validateFileBytes(fakeJpg, 'photo.jpg')).toThrow();

    // 3. Executable or unsupported extension
    expect(() => validateFileBytes(validPdf, 'malicious.exe')).toThrow();

    // 4. Valid magic bytes detection
    expect(detectMagicBytes(validPng)?.mime).toBe('image/png');
    expect(detectMagicBytes(validPdf)?.mime).toBe('application/pdf');
    expect(detectMagicBytes(validJpg)?.mime).toBe('image/jpeg');
  });

  test('size limit: rejects uploads exceeding 50 MB', async () => {
    const hugeBuffer = new Uint8Array(MAX_FILE_SIZE + 1024);
    hugeBuffer[0] = 0x25; hugeBuffer[1] = 0x50; hugeBuffer[2] = 0x44; hugeBuffer[3] = 0x46; // %PDF
    expect(() => validateFileBytes(hugeBuffer, 'huge.pdf')).toThrow();
  });

  test('hashing and identified submission: SHA-256 and Ed25519 signed receipt', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validPng]), 'screenshot.png');
    formData.append('caseRef', 'CNR-DLCT01-000123-2026');
    formData.append('description', 'CCTV still showing store front at 14:32');
    formData.append('mode', 'identified');
    formData.append('name', 'Sunita Sharma');
    formData.append('phone', '+91-9876543210');
    formData.append('email', 'sunita@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/evidence',
      headers: { origin },
      body: formData as any,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.mode).toBe('identified');
    expect(body.mime).toBe('image/png');
    expect(body.sha256).toBeDefined();
    expect(body.receiptSignature).toBeDefined();
    expect(body.entryHash).toBeDefined();
    expect(body.prevHash).toBeDefined();
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // Verify hashing: SHA-256 of validPng
    const { createHash } = await import('node:crypto');
    const expectedHash = createHash('sha256').update(validPng).digest('hex');
    expect(body.sha256).toBe(expectedHash);
  });

  test('anonymous mode: stores NO identity, returns 128-bit receipt code, and tracks status', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validPdf]), 'whistleblower_audit.pdf');
    formData.append('caseRef', 'CNR-DLCT01-009999-2026');
    formData.append('description', 'Internal discrepancy spreadsheet printout');
    formData.append('mode', 'anonymous');

    const res = await app.inject({
      method: 'POST',
      url: '/evidence',
      headers: { origin },
      body: formData as any,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('anonymous');
    expect(body.receiptCode).toBeDefined();
    expect(body.receiptCode).toHaveLength(32); // 128-bit hex string

    // Verify database stored NO personal identity
    const stored = db.prepare('SELECT submitter_name, submitter_phone, submitter_email, status_code_hash FROM evidence WHERE id = ?').get(body.id) as any;
    expect(stored.submitter_name).toBeNull();
    expect(stored.submitter_phone).toBeNull();
    expect(stored.submitter_email).toBeNull();
    expect(stored.status_code_hash).toBeDefined();

    // Check status via anonymous code route GET /evidence/status/:code
    const statusRes = await app.inject({
      method: 'GET',
      url: '/evidence/status/' + body.receiptCode,
    });
    expect(statusRes.statusCode).toBe(200);
    const statusData = JSON.parse(statusRes.body);
    expect(statusData.id).toBe(body.id);
    expect(statusData.status).toBe('received');
    expect(statusData.caseRef).toBe('CNR-DLCT01-009999-2026');
    expect(statusData.sha256).toBe(body.sha256);

    // Bad code returns 404
    const badCodeRes = await app.inject({
      method: 'GET',
      url: '/evidence/status/00000000000000000000000000000000',
    });
    expect(badCodeRes.statusCode).toBe(404);
  });

  test('chain integrity: evidence log maintains an intact hash chain', () => {
    const check = verifyEvidenceLog(db);
    expect(check.valid).toBe(true);
    expect(check.entries).toBeGreaterThanOrEqual(2);
    expect(check.head).toMatch(/^[a-f0-9]{64}$/);
  });

  test('judge authenticated workflow: feed, preview download, action update, verification & BSA certificate', async () => {
    // 1. List evidence feed
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/evidence',
      headers: { authorization: judgeAuthHeader },
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const item = list[0];

    // 2. Download decrypted file
    const fileRes = await app.inject({
      method: 'GET',
      url: `/api/evidence/${item.id}/file`,
      headers: { authorization: judgeAuthHeader },
    });
    expect(fileRes.statusCode).toBe(200);
    expect(fileRes.headers['content-type']).toBe(item.mime);
    expect(fileRes.rawPayload.byteLength).toBe(item.size);

    // 3. Mark "seen"
    const actionRes1 = await app.inject({
      method: 'POST',
      url: `/api/evidence/${item.id}/action`,
      headers: { authorization: judgeAuthHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seen', note: 'Reviewed by Magistrate' }),
    });
    expect(actionRes1.statusCode).toBe(200);
    const itemAfterSeen = JSON.parse(actionRes1.body);
    expect(itemAfterSeen.status).toBe('seen');
    expect(itemAfterSeen.actionHistory.some((a: any) => a.action === 'seen')).toBe(true);

    // 4. Mark "taken_on_record"
    const actionRes2 = await app.inject({
      method: 'POST',
      url: `/api/evidence/${item.id}/action`,
      headers: { authorization: judgeAuthHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'taken_on_record', note: 'Exhibit P-1 marked' }),
    });
    expect(actionRes2.statusCode).toBe(200);
    const itemAfterRecord = JSON.parse(actionRes2.body);
    expect(itemAfterRecord.status).toBe('taken_on_record');

    // 5. Re-verify hash and signature
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/evidence/${item.id}/verify`,
      headers: { authorization: judgeAuthHeader },
    });
    expect(verifyRes.statusCode).toBe(200);
    const v = JSON.parse(verifyRes.body);
    expect(v.valid).toBe(true);
    expect(v.hashMatch).toBe(true);
    expect(v.signatureValid).toBe(true);
    expect(v.chainValid).toBe(true);

    // 6. BSA s.63 certificate export (HTML mode for headless testing)
    const certRes = await app.inject({
      method: 'GET',
      url: `/api/evidence/${item.id}/certificate?format=html`,
      headers: { authorization: judgeAuthHeader },
    });
    expect(certRes.statusCode).toBe(200);
    expect(certRes.headers['content-type']).toContain('text/html');
    expect(certRes.body).toContain('The Bharatiya Sakshya Adhiniyam, 2023');
    expect(certRes.body).toContain('PART A');
    expect(certRes.body).toContain('PART B');
    expect(certRes.body).toContain(item.sha256);
  });

  test('tamper detection: modifying stored file fails re-verification', async () => {
    // Submit a fresh item
    const formData = new FormData();
    formData.append('file', new Blob([validJpg]), 'sample.jpg');
    formData.append('caseRef', 'CNR-TAMPER-001');
    formData.append('description', 'Test image for tamper test');
    formData.append('mode', 'identified');
    formData.append('name', 'Witness One');
    formData.append('phone', '+91-9999999999');

    const submitRes = await app.inject({
      method: 'POST',
      url: '/evidence',
      headers: { origin },
      body: formData as any,
    });
    const item = JSON.parse(submitRes.body);

    // Live verification should pass initially
    const verifyRes1 = await app.inject({
      method: 'GET',
      url: `/api/evidence/${item.id}/verify`,
      headers: { authorization: judgeAuthHeader },
    });
    expect(JSON.parse(verifyRes1.body).valid).toBe(true);

    // Tamper with the encrypted file on disk
    const row = db.prepare('SELECT file_path FROM evidence WHERE id = ?').get(item.id) as any;
    writeFileSync(row.file_path, Buffer.from('Corrupted encrypted ciphertext tampering'));

    // Verification must detect the tampering and fail
    const verifyRes2 = await app.inject({
      method: 'GET',
      url: `/api/evidence/${item.id}/verify`,
      headers: { authorization: judgeAuthHeader },
    });
    const v2 = JSON.parse(verifyRes2.body);
    expect(v2.valid).toBe(false);
    expect(v2.hashMatch).toBe(false);
  });

  test('mobile GET /submit page returns bilingual English + Hindi interface', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/submit',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Court+ Evidence Vault');
    expect(res.body).toContain('साक्ष्य सेतु');
    expect(res.body).toContain('Anonymous Tip');
    expect(res.body).toContain('अनाम / गोपनीय');
    expect(res.body).toContain('viewport');
  });
});
