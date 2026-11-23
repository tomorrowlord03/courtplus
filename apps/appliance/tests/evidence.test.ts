import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { ScreeningResult } from '@courtplus/contracts';
import {
  createManifest, createReceipt, decodeTrustPem, encodeTrustPem, generateKeyPair, generatePqKeyPair,
  keyBinding, sha256, sha3_256, signHybrid, verifyHybrid, type SigningKey,
} from '@courtplus/export/signing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { openDb, verifyEvidenceLog, type Db } from '../src/db.js';
import { detectMagicBytes, MAX_FILE_SIZE, resolveEvidenceKey, resolveSigningKey, validateFileBytes } from '../src/evidence.js';
import { addIssuer } from '../src/receipts.js';

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

  test('identified submissions carry both hashes and signatures and use the server timestamp', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validPng]), 'screenshot.png');
    formData.append('caseRef', 'CNR-DLCT01-000123-2026');
    formData.append('description', 'CCTV still showing store front at 14:32');
    formData.append('mode', 'identified');
    formData.append('name', 'Sunita Sharma');
    formData.append('phone', '+91-9876543210');
    formData.append('email', 'sunita@example.test');
    const clientTime = '1999-01-01T00:00:00.000Z';
    formData.append('receivedAt', clientTime);
    const beforeUpload = Date.now();

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

    const signed = JSON.parse(body.receipt);
    expect(body.sha256).toBe(createHash('sha256').update(validPng).digest('hex'));
    expect(body.sha3_256).toBe(createHash('sha3-256').update(validPng).digest('hex'));
    expect(signed.payload).toMatchObject({
      kind: 'courtplus-evidence-receipt-v2', receivedAt: body.receivedAt, sha256: body.sha256, sha3_256: body.sha3_256,
    });
    expect(signed.signatures).toEqual({ ed25519: body.receiptSignature, mldsa65: body.pqSignature });
    expect(body.receivedAt).not.toBe(clientTime);
    expect(Date.parse(body.receivedAt)).toBeGreaterThanOrEqual(beforeUpload);
    expect(Date.parse(body.receivedAt)).toBeLessThanOrEqual(Date.now());
    const exported = await app.inject({
      url: '/api/evidence/signing-key', headers: { authorization: judgeAuthHeader },
    });
    expect(exported.statusCode).toBe(200);
    const trusted = { ...decodeTrustPem(exported.body), status: 'active', label: 'Fictional Evidence Vault' } as const;
    expect(verifyHybrid(signed, trusted)).toEqual({ ed25519: true, mldsa65: true });
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
    expect(v.signatures).toEqual({ ed25519: true, mldsa65: true });
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
    expect(certRes.body).toContain('To be filled by the Expert');
    expect(certRes.body).toContain('Other: SHA3-256');
    expect(certRes.body.split(item.sha256)).toHaveLength(3);
    expect(certRes.body.split(item.sha3_256)).toHaveLength(3);
    expect(certRes.body).not.toContain('System Custodian / Vault Authority');
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

  test('escapes the uploaded filename and description in the s.63 certificate', async () => {
    const filename = '<img src=x onerror=alert(1)>.pdf';
    const description = '</td><script>x</script>';
    const form = new FormData();
    form.append('file', new Blob([validPdf]), filename);
    form.append('description', description);
    form.append('caseRef', 'Fictional-Certificate-Case');
    form.append('mode', 'identified');
    form.append('name', 'Fictional Submitter');
    form.append('phone', '+1-202-555-0100');
    const upload = await app.inject({ method: 'POST', url: '/evidence', headers: { origin }, body: form as any });
    expect(upload.statusCode).toBe(201);
    const { id } = upload.json<{ id: string }>();
    const certificate = await app.inject({
      url: `/api/evidence/${id}/certificate?format=html`, headers: { authorization: judgeAuthHeader },
    });
    expect(certificate.statusCode).toBe(200);
    expect(certificate.body).not.toContain(filename);
    expect(certificate.body).not.toContain(description);
    expect(certificate.body).toContain('&lt;img src=x onerror=alert(1)&gt;.pdf');
    expect(certificate.body).toContain('&lt;/td&gt;&lt;script&gt;x&lt;/script&gt;');
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

describe('Production key resolution fail-fast (w37)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  test('fails fast in production when evidence key is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COURTPLUS_EVIDENCE_KEY;
    delete process.env.COURTPLUS_EVIDENCE_KEY_FILE;

    expect(() => resolveEvidenceKey()).toThrow(/Evidence encryption key required in production/i);
  });

  test('fails fast in production when evidence key file does not exist', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COURTPLUS_EVIDENCE_KEY;
    process.env.COURTPLUS_EVIDENCE_KEY_FILE = '/nonexistent/evidence_key';

    expect(() => resolveEvidenceKey()).toThrow(/not found/i);
  });

  test('fails fast in production when evidence key hex is invalid', () => {
    process.env.NODE_ENV = 'production';
    process.env.COURTPLUS_EVIDENCE_KEY = 'invalid-hex';

    expect(() => resolveEvidenceKey()).toThrow(/64-character hex/i);
  });

  test('fails fast in production when signing key file is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COURTPLUS_SIGNING_KEY_FILE;

    expect(() => resolveSigningKey()).toThrow(/Signing key file required in production/i);
  });

  test('fails fast in production when signing key file does not exist', () => {
    process.env.NODE_ENV = 'production';
    process.env.COURTPLUS_SIGNING_KEY_FILE = '/nonexistent/signing_key.pem';

    expect(() => resolveSigningKey()).toThrow(/not found/i);
  });

  test('succeeds in production when valid evidence key and signing key file are provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'courtplus-w37-test-'));
    try {
      const keyHex = randomBytes(32).toString('hex');
      const keyFile = join(dir, 'evidence_key');
      writeFileSync(keyFile, keyHex);

      const { privateKey } = generateKeyPairSync('ed25519');
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const signingKeyFile = join(dir, 'signing_key.pem');
      writeFileSync(signingKeyFile, pem);

      process.env.NODE_ENV = 'production';
      process.env.COURTPLUS_EVIDENCE_KEY_FILE = keyFile;
      process.env.COURTPLUS_SIGNING_KEY_FILE = signingKeyFile;

      const encKey = resolveEvidenceKey();
      expect(encKey).toEqual(Buffer.from(keyHex, 'hex'));

      const signer = resolveSigningKey();
      expect(signer.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(signer.keyId).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildApp fails fast at startup in production when keys are missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'courtplus-w37-startup-'));
    const secret = join(dir, 'db.key');
    writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600 });
    const testDb = openDb(join(dir, 'test.sqlite3'), secret);

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.COURTPLUS_EVIDENCE_KEY;
      delete process.env.COURTPLUS_EVIDENCE_KEY_FILE;
      delete process.env.COURTPLUS_SIGNING_KEY_FILE;

      await expect(buildApp({
        db: testDb,
        origin: 'https://courtplus.example.test',
      })).rejects.toThrow();
    } finally {
      testDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(['production', 'test'])('requires a PQ seed with a configured Ed25519 file in %s', async environment => {
    const dir = mkdtempSync(join(tmpdir(), 'courtplus-pq-startup-'));
    const secret = join(dir, 'db.key');
    writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600 });
    const db = openDb(join(dir, 'test.sqlite3'), secret);
    try {
      const signingKeyFile = join(dir, 'signing_key.pem');
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(signingKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      process.env.NODE_ENV = environment;
      process.env.COURTPLUS_EVIDENCE_KEY = randomBytes(32).toString('hex');
      process.env.COURTPLUS_SIGNING_KEY_FILE = signingKeyFile;
      delete process.env.COURTPLUS_PQ_SIGNING_KEY_FILE;
      const options = { db, origin: 'https://courtplus.example.test', evidenceDir: join(dir, 'vault') };
      await expect(buildApp(options)).rejects.toThrow(/COURTPLUS_PQ_SIGNING_KEY_FILE/);
      process.env.COURTPLUS_PQ_SIGNING_KEY_FILE = join(dir, 'pq_key');
      writeFileSync(process.env.COURTPLUS_PQ_SIGNING_KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
      const app = await buildApp(options);
      await app.close();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Appliance PQ rotation', () => {
  const origin = 'https://courtplus.example.test';
  const office = 'Fictional Rotation Office';
  const oldSeed = Buffer.alloc(32, 1);
  const newSeed = Buffer.alloc(32, 2);
  const pdf = Buffer.from('%PDF-1.4\nFictional rotation fixture\n%%EOF');
  const result = { status: 'NEEDS_LAWYER_REVIEW', asOf: '2026-11-23', ruleVersion: 'rules-fictional', trace: [] } as ScreeningResult;
  let directory: string;
  let retiredDir: string;
  let seedFile: string;
  let options: Parameters<typeof buildApp>[0];
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let headers: { authorization: string };
  let oldKey: SigningKey;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-pq-rotation-'));
    const secret = join(directory, 'db.key');
    writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600 });
    db = openDb(join(directory, 'test.sqlite3'), secret);
    await addAccount(db, 'fictional_operator', 'fictional rotation password', 'superintendent');
    oldKey = { ...generateKeyPair(office), ...generatePqKeyPair(oldSeed) };
    const signingKeyFile = join(directory, 'signing_key');
    writeFileSync(signingKeyFile, oldKey.privateKey, { mode: 0o600 });
    seedFile = join(directory, 'pq_signing_key');
    writeFileSync(seedFile, oldSeed.toString('hex'), { mode: 0o600 });
    retiredDir = join(directory, 'retired');
    mkdirSync(retiredDir);
    vi.stubEnv('COURTPLUS_PQ_SIGNING_KEY_FILE', seedFile);
    vi.stubEnv('COURTPLUS_PQ_RETIRED_DIR', retiredDir);
    vi.stubEnv('COURTPLUS_EVIDENCE_KEY', randomBytes(32).toString('hex'));
    vi.stubEnv('COURTPLUS_EVIDENCE_KEY_FILE', undefined);
    options = { db, office, origin, signingKeyFile, evidenceDir: join(directory, 'vault') };
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  async function issueEvidence() {
    const formData = new FormData();
    formData.append('file', new Blob([pdf]), 'fictional.pdf');
    formData.append('caseRef', 'CNR-DLCT01-000127-2026');
    formData.append('description', 'Fictional rotation evidence');
    formData.append('mode', 'anonymous');
    const response = await app!.inject({ method: 'POST', url: '/evidence', headers: { origin }, body: formData });
    expect(response.statusCode).toBe(201);
    const { id, receipt } = response.json<{ id: string; receipt: string }>();
    return { id, payload: JSON.parse(receipt).payload };
  }

  async function start() {
    app = await buildApp(options);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { username: 'fictional_operator', password: 'fictional rotation password', client: 'desktop' },
    });
    expect(login.statusCode).toBe(200);
    headers = { authorization: 'Bearer ' + login.json().token };
  }

  async function verifyEvidence(id: string) {
    const response = await app!.inject({ url: `/api/evidence/${id}/verify`, headers });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  function draft(key: SigningKey) {
    const { receipt } = createReceipt({ issuer: office, inputs: {}, result }, key);
    return { receipt, manifest: createManifest(pdf, receipt, key) };
  }

  async function verifyDraft(bundle: ReturnType<typeof draft>) {
    const response = await app!.inject({
      method: 'POST', url: '/api/verify-digest', headers,
      payload: { ...bundle, pdfDigest: sha256(pdf), pdfSha3_256: sha3_256(pdf) },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  test.each(['public PEM', 'seed with binding'])('verifies receipts before and after rotation using a retired %s', async format => {
    await start();
    const first = await issueEvidence();
    expect(first.payload).toMatchObject({ kind: 'courtplus-evidence-receipt-v2', pqKeyId: oldKey.pqKeyId });
    const oldDraft = draft(oldKey);
    const bindingPem = encodeTrustPem(oldKey);
    addIssuer(db, office, bindingPem);
    await app!.close();
    app = undefined;

    const retired = format === 'public PEM' ? bindingPem : oldSeed.toString('hex') + '\n' + bindingPem;
    const extension = format === 'public PEM' ? 'pem' : 'seed';
    writeFileSync(join(retiredDir, `previous-key.${extension}`), retired, { mode: 0o600 });
    const newKey = { ...oldKey, ...generatePqKeyPair(newSeed) };
    writeFileSync(seedFile, newSeed.toString('hex'), { mode: 0o600 });
    await start();
    const second = await issueEvidence();
    expect(second.payload).toMatchObject({ kind: 'courtplus-evidence-receipt-v2', keyId: first.payload.keyId, pqKeyId: newKey.pqKeyId });
    const exported = await app!.inject({ url: '/api/evidence/signing-key', headers });
    expect(decodeTrustPem(exported.body).pqKeyId).toBe(newKey.pqKeyId);
    const signatures = { ed25519: true, mldsa65: true };
    for (const receipt of [first, second]) {
      expect(await verifyEvidence(receipt.id)).toMatchObject({ valid: true, hashMatch: true, chainValid: true, signatures });
    }
    for (const bundle of [oldDraft, draft(newKey)]) {
      expect(await verifyDraft(bundle)).toMatchObject({ signature: 'valid', pdf: 'unchanged', signatures });
    }
  });

  test('reports unknown_signer for an unconfigured PQ key with the same Ed25519 signer', async () => {
    await start();
    const historical = await issueEvidence();
    addIssuer(db, office, encodeTrustPem(oldKey));
    await app!.close();
    app = undefined;
    writeFileSync(seedFile, newSeed.toString('hex'), { mode: 0o600 });
    await start();
    const signatures = { ed25519: true, mldsa65: false };
    expect(await verifyEvidence(historical.id)).toMatchObject({ valid: false, signature: 'unknown_signer', signatures });
    expect(await verifyDraft(draft({ ...oldKey, ...generatePqKeyPair(newSeed) })))
      .toMatchObject({ signature: 'unknown_signer', signatures });
  });

  test('rejects a retired key with a broken binding at startup', async () => {
    const binding = signHybrid(keyBinding(oldKey).payload, { ...oldKey, ...generatePqKeyPair(newSeed) });
    writeFileSync(join(retiredDir, 'broken.pem'), encodeTrustPem({ ...oldKey, binding }));
    await expect(buildApp(options)).rejects.toThrow(/Invalid retired PQ key.*broken\.pem/);
  });

  test('starts with a separate draft signing key and ignores foreign PEMs and unrelated entries', async () => {
    const draftKey = { ...generateKeyPair(office), ...generatePqKeyPair(oldSeed) };
    const draftKeyFile = join(directory, 'draft_signing_key');
    writeFileSync(draftKeyFile, draftKey.privateKey, { mode: 0o600 });
    options.signingKeyFile = draftKeyFile;
    writeFileSync(join(retiredDir, 'evidence.pem'), encodeTrustPem(oldKey));
    writeFileSync(join(retiredDir, '.gitkeep'), '');
    mkdirSync(join(retiredDir, 'notes'));

    await start();
    const receipt = await issueEvidence();
    expect(receipt.payload).toMatchObject({ keyId: draftKey.keyId, pqKeyId: draftKey.pqKeyId });
  });

  test.each([['missing', ''], ['mismatched', newSeed.toString('hex') + '\n']])('rejects a %s retired seed', async (_case, prefix) => {
    writeFileSync(join(retiredDir, 'bad.seed'), prefix + encodeTrustPem(oldKey));
    await expect(buildApp(options)).rejects.toThrow(/Invalid retired PQ key.*bad\.seed/);
  });
});
