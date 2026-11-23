import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { CaseRecord, Person } from '@courtplus/contracts';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { canonical, openDb, verifyAudit, type Db } from '../src/db.js';
import { createExportCache } from '../src/exports.js';
import { roles, type Role } from '../src/inputs.js';
import { addIssuer } from '../src/receipts.js';

const origin = 'https://courtplus.example.test';
const password = 'fictional test account password';
const dbKey = randomBytes(32).toString('hex');
const office = 'Fictional District Legal Services Authority';
const fictionalAlias = 'Accused-990001';
const privateMarker = 'Fictional Person For Privacy Test';
const person: Person = { id: 'p990001', alias: fictionalAlias, prisonerType: 'undertrial', priorConviction: 'no', otherHolds: 'no', caseIds: ['c990001'] };
const record: CaseRecord = {
  id: 'c990001', personId: person.id, pendingStatus: 'trial',
  charges: [{ act: 'IPC', section: '379', stage: 'FIR', verified: true }],
  custody: [{ kind: 'judicial', start: '2022-01-01', ongoing: true }],
  events: [{ kind: 'remand', on: '2022-01-01' }],
};
const orgKeys = generateKeyPairSync('ed25519');
const keyId = digest(orgKeys.publicKey.export({ type: 'spki', format: 'der' }));
const pdf = Buffer.from('%PDF-1.7 Fictional signed draft test bytes');
const users = new Map<Role, { authorization: string }>();
let directory: string;
let secret: string;
let dbFile: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = Date.parse('2026-11-23T12:00:00Z');

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function signed(payload: Record<string, unknown>) {
  return canonical({ payload, signature: sign(null, Buffer.from(canonical(payload)), orgKeys.privateKey).toString('base64url') });
}

function draft(extra: Record<string, unknown> = {}) {
  const receiptId = randomUUID();
  const receipt = signed({
    kind: 'courtplus-receipt-v1', issuer: office, receiptId, keyId, ruleVersion: 'rules-fictional',
    asOf: '2026-11-23', inputsDigest: '0'.repeat(64), result: 'NEEDS_LAWYER_REVIEW',
    resultDigest: '1'.repeat(64), traceDigest: '2'.repeat(64), createdAt: '2026-11-23T00:00:00.000Z', ...extra,
  });
  const manifest = signed({
    kind: 'courtplus-manifest-v1', keyId, receiptDigest: digest(receipt), pdfDigest: digest(pdf),
  });
  return { receipt, manifest, receiptId };
}

function api(role: Role, method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({ method, url, headers: users.get(role), payload });
}

describe.sequential('CourtPlus Cloud', () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-cloud-test-'));
    secret = join(directory, 'db-key');
    dbFile = join(directory, 'db.sqlite3');
    writeFileSync(secret, dbKey, { mode: 0o600 });
    db = openDb(dbFile, secret);
    addIssuer(db, office, orgKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    app = await buildApp({ db, origin, now: () => clock, handoffDueMs: 5000, tickMs: 30 });
    for (const [index, role] of roles.options.entries()) {
      await addAccount(db, role, password, role);
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.' + (index + 20),
        payload: { username: role, password, client: 'desktop' },
      });
      expect(login.statusCode).toBe(200);
      const { token } = login.json<{ token: string }>();
      users.set(role, { authorization: 'Bearer ' + token });
    }
  });

  afterAll(async () => {
    await app?.close();
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('public health, locked CORS, Helmet, and authenticated read', async () => {
    const health = await app.inject('/health');
    expect(health.json()).toEqual({ status: 'ok' });
    expect(health.headers['content-security-policy']).toBeDefined();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/saveCase', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-csrf-token',
    } });
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://other.example.test' } });
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://other.example.test');
    expect((await app.inject({ method: 'POST', url: '/api/listPersons', payload: [] })).statusCode).toBe(401);
    expect((await app.inject('/api/handoff/stream')).statusCode).toBe(401);
    expect((await app.inject('/')).statusCode).toBe(302);
  });

  test('role matrix gates case writes, filing, release, acknowledgement, and publication', async () => {
    for (const role of roles.options) {
      expect((await api(role, 'POST', '/api/listPersons', [])).statusCode).toBe(200);
      expect((await api(role, 'POST', '/api/role', [])).json()).toBe(
        role === 'utrc_member' || role === 'admin' ? 'utrc' : role,
      );
      const canEdit = ['dlsa', 'legal_aid', 'superintendent'].includes(role);
      expect((await api(role, 'POST', '/api/saveCase', [person, record])).statusCode).toBe(canEdit ? 204 : 403);
      expect((await api(role, 'POST', '/api/cases/' + record.id + '/application-filed', { filedOn: '2026-11-22' })).statusCode)
        .toBe(role === 'superintendent' ? 204 : 403);
      expect((await api(role, 'POST', '/api/handoff', { caseId: 'c987000', kind: 'release_order', orderOn: '2026-11-21' })).statusCode)
        .toBe(role === 'dlsa' ? 404 : 403);
      expect((await api(role, 'POST', '/api/handoff/' + randomUUID() + '/ack', {})).statusCode)
        .toBe(role === 'superintendent' ? 404 : 403);
      const { receipt, manifest } = draft();
      expect((await api(role, 'POST', '/api/receipts', { receipt, manifest })).statusCode).toBe(canEdit ? 201 : 403);
      expect((await api(role, 'POST', '/api/receipts/' + randomUUID() + '/withdraw', {})).statusCode)
        .toBe(role === 'admin' ? 404 : 403);
      expect((await api(role, 'POST', '/api/importOrder', [{ name: 'fake.pdf', bytes: { $base64: 'AAAA' } }])).statusCode)
        .toBe(canEdit ? 501 : 403);
    }
    const released = { ...record, releasedOn: '2026-11-21' };
    for (const role of ['legal_aid', 'superintendent'] as const) {
      expect((await api(role, 'POST', '/api/saveCase', [person, released])).statusCode).toBe(403);
    }
    expect((await api('dlsa', 'POST', '/api/saveCase', [person, released])).statusCode).toBe(204);
    expect((await api('superintendent', 'GET', '/api/handoff')).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: record.id, kind: 'release_order', orderOn: '2026-11-21' }),
    ]));
  });

  test('cookie write requires matched CSRF token and origin; login is rate limited', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'legal_aid', password } });
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];
    const csrf = login.json<{ csrfToken: string }>().csrfToken;
    const save = (headers: Record<string, string>) => app.inject({
      method: 'POST', url: '/api/saveCase', payload: [person, record], headers: { cookie, ...headers },
    });
    expect((await save({})).json()).toEqual({ error: 'CSRF_REJECTED' });
    expect((await save({ origin, 'x-csrf-token': '1'.repeat(64) })).statusCode).toBe(403);
    expect((await save({ origin: 'https://other.example.test', 'x-csrf-token': csrf })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST', url: '/api/saveCase', payload: [person, { ...record, releasedOn: '2026-11-21' }],
      headers: { cookie, origin, 'x-csrf-token': csrf },
    })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).json().csrfToken).toBe(csrf);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf } })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(401);

    for (let i = 0; i < 6; i += 1) {
      const rejected = await app.inject({
        method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.50',
        payload: { username: 'invalid', password },
      });
      expect(rejected.statusCode).toBe(i === 5 ? 429 : 401);
    }
  });

  test('handoff POST, live event, overdue, acknowledgement, and replay', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(address + '/api/handoff/stream', {
        headers: { ...users.get('superintendent'), connection: 'close' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const stream = response.body!.getReader();
      const decoder = new TextDecoder();
      let contents = '';
      async function until(pattern: RegExp) {
        while (!pattern.test(contents)) {
          const next = await stream.read();
          if (next.done) throw new Error('SSE ended before ' + pattern);
          contents += decoder.decode(next.value, { stream: true });
        }
      }
      await until(/event: snapshot/);
      const payload = { caseId: record.id, kind: 'acquitted', orderOn: '2026-11-22' };
      const responsePost = await api('dlsa', 'POST', '/api/handoff', payload);
      expect(responsePost.statusCode).toBe(201);
      const { id } = responsePost.json<{ id: string }>();
      await until(/event: posted/);
      expect(contents).toContain(id);
      const postedEventId = /id: (\d+)\nevent: posted/.exec(contents)![1];
      expect((await api('dlsa', 'POST', '/api/handoff', payload)).json().id).toBe(id);
      const board = await api('superintendent', 'POST', '/api/board', ['2026-11-23']);
      expect(board.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'handoff:' + id, state: 'order_verified' })]));
      clock += 5100;
      await until(/event: overdue/);
      const acknowledged = await api('superintendent', 'POST', '/api/handoff/' + id + '/ack', {});
      expect(acknowledged.statusCode).toBe(200);
      expect(acknowledged.json().acknowledgedAt).toBe(clock);
      await until(/event: acknowledged/);
      expect((contents.match(/event: posted/g) ?? []).length).toBe(1);

      const cardId = 'handoff:' + id;
      const update = (role: Role, state: string) => api(role, 'POST', '/api/updateCard', [cardId, { state }]);
      expect((await update('dlsa', 'holds_checked')).statusCode).toBe(403);
      expect((await update('superintendent', 'closed')).statusCode).toBe(409);
      expect((await update('superintendent', 'holds_checked')).json().state).toBe('holds_checked');
      expect((await update('superintendent', 'holds_checked')).json().state).toBe('holds_checked');
      expect((await update('superintendent', 'closed')).json().state).toBe('closed');
      expect((await api('superintendent', 'POST', '/api/board', ['2026-11-23'])).json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: cardId, state: 'closed' })]),
      );

      const replay = await fetch(address + '/api/handoff/stream', {
        headers: { ...users.get('superintendent'), 'last-event-id': postedEventId, connection: 'close' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      const reader = replay.body!.getReader();
      let replayed = '';
      while (!replayed.includes('event: acknowledged')) {
        const next = await reader.read();
        if (next.done) throw new Error('SSE replay ended early');
        replayed += decoder.decode(next.value);
      }
      expect(replayed).toContain('event: overdue');
      expect(replayed).not.toContain('event: snapshot');
      await reader.cancel();
      await stream.cancel();
    } finally {
      controller.abort();
    }
  });

  test('case allowlist strips private fields and public verification renders only receipt metadata', async () => {
    const saved = await api('dlsa', 'POST', '/api/saveCase', [
      { ...person, name: privateMarker },
      { ...record, cnr: 'FICTIONAL-CNR-990001', caseNo: 'private-order-ref', court: privateMarker,
        events: [{ kind: 'remand', on: '2022-01-01', note: privateMarker, source: {
          docId: 'doc990001', quote: privateMarker, verifiedBy: privateMarker,
        } }] },
    ]);
    expect(saved.statusCode).toBe(204);
    const cases = await api('legal_aid', 'POST', '/api/listCases', []);
    expect(cases.body).not.toContain(privateMarker);
    expect(cases.body).not.toContain('FICTIONAL-CNR');
    expect(cases.body).not.toContain('private-order-ref');
    const leak = draft({ extra: privateMarker });
    expect((await api('legal_aid', 'POST', '/api/receipts', { receipt: leak.receipt, manifest: leak.manifest })).statusCode)
      .toBe(422);
    const { receiptId, receipt, manifest } = draft();
    const published = await api('legal_aid', 'POST', '/api/receipts', { receipt, manifest });
    expect(published.json()).toEqual({ receiptId, url: origin + '/v/' + receiptId });
    const publicPage = await app.inject('/v/' + receiptId);
    expect(publicPage.statusCode).toBe(200);
    expect(publicPage.body).toContain('Signature</dt><dd>Valid');
    expect(publicPage.body).toContain(digest(pdf));
    expect(publicPage.body).toContain(office);
    expect(publicPage.body).not.toContain(fictionalAlias);
    expect(publicPage.body).not.toContain(privateMarker);
    expect(publicPage.body).not.toContain(keyId);
    expect((await api('admin', 'POST', '/api/receipts/' + receiptId + '/withdraw', {})).statusCode).toBe(204);
    expect((await app.inject('/v/' + receiptId)).body).toContain('Withdrawn');
  });

  test('verification decodes canonical base64 and distinguishes changed copies', async () => {
    const { receipt, manifest } = draft();
    const checkDigest = await api('legal_aid', 'POST', '/api/verify-digest', { receipt, manifest, pdfDigest: digest(pdf) });
    expect(checkDigest.json()).toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
    const verify = (data: string) => api('legal_aid', 'POST', '/api/verify', [{ receipt, manifest, pdf: { $base64: data } }]);
    expect((await verify(pdf.toString('base64'))).json()).toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
    expect((await verify(Buffer.from('changed').toString('base64'))).json().pdf).toBe('changed');
    expect((await verify('9/==')).statusCode).toBe(400);
    expect((await verify('AAB=')).statusCode).toBe(400);
    expect((await verify('AAA\n')).statusCode).toBe(400);
    expect((await verify('invalid!')).statusCode).toBe(400);
  });

  test('raw verification rejects PDFs over 4 MiB and the digest path still works', async () => {
    const { receipt, manifest } = draft();
    const raw = (size: number) => app.inject({
      method: 'POST', url: '/api/verify', remoteAddress: '192.0.2.41', headers: users.get('legal_aid'),
      payload: [{ receipt, manifest, pdf: { $base64: Buffer.alloc(size).toString('base64') } }],
    });
    const limit = 4 * 1024 * 1024;
    expect((await raw(limit)).json()).toMatchObject({ signature: 'valid', pdf: 'changed' });
    expect((await raw(limit + 1)).statusCode).toBe(400);
    expect((await raw(limit + 32 * 1024)).statusCode).toBe(413);
    const fingerprint = await api('legal_aid', 'POST', '/api/verify-digest', {
      receipt, manifest, pdfDigest: digest(Buffer.alloc(limit + 1)),
    });
    expect(fingerprint.json()).toMatchObject({ signature: 'valid', pdf: 'changed' });
  });

  test.each([
    ['GET', '/health', 180],
    ['GET', '/v/' + randomUUID(), 30],
    ['POST', '/api/verify', 6],
    ['POST', '/api/verify-digest', 30],
    ['POST', '/api/exportDraft', 6],
    ['POST', '/api/exportScReturn', 6],
    ['GET', '/api/handoff/stream', 12],
  ] as const)('%s %s rate-limits clients independently', async (method, url, max) => {
    const request = (remoteAddress: string) => app.inject({ method, url, remoteAddress });
    for (let i = 0; i < max; i += 1) expect((await request('192.0.2.42')).statusCode).not.toBe(429);
    expect((await request('192.0.2.42')).statusCode).toBe(429);
    expect((await request('192.0.2.43')).statusCode).not.toBe(429);
  });

  test('concurrent logins have per-IP and per-account limits without a global cap', async () => {
    const login = (username: string, remoteAddress: string) => app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress, payload: { username, password, client: 'desktop' },
    });
    const sameIp = await Promise.all(roles.options.map(role => login(role, '192.0.2.44')));
    expect(sameIp.map(result => result.statusCode).sort()).toEqual([200, 200, 429, 429, 429]);
    const separate = await Promise.all(roles.options.map((role, index) => login(role, '192.0.2.' + (51 + index))));
    expect(separate.map(result => result.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const sameAccount = await Promise.all([login('dlsa', '192.0.2.58'), login('dlsa', '192.0.2.59')]);
    expect(sameAccount.map(result => result.statusCode).sort()).toEqual([200, 429]);
  });

  test.each(['dlsa', 'fictional-missing'])('five failures from different IPs throttle %s, then expire', async username => {
    const start = Date.now();
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const login = (username: string, attempt: string, index: number) => app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '192.0.2.' + index,
      payload: { username, password: attempt, client: 'desktop' },
    });
    try {
      for (let ip = 61; ip < 66; ip += 1) {
        expect((await login(username, 'fictional incorrect password', ip)).statusCode).toBe(401);
      }
      const blocked = await login(username, password, 66);
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await login('superintendent', password, 66)).statusCode).toBe(200);
      wallClock.mockReturnValue(start + 60_001);
      expect((await login(username, password, 67)).statusCode).toBe(username === 'dlsa' ? 200 : 401);
    } finally {
      wallClock.mockRestore();
    }
  });

  test('only an admin can revoke every cookie and bearer session for an account', async () => {
    const web = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '192.0.2.70', payload: { username: 'utrc_member', password },
    });
    const cookie = String(web.headers['set-cookie']).split(';')[0];
    const target = { username: 'utrc_member' };
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(200);
    expect((await api('dlsa', 'POST', '/api/auth/revoke-sessions', target)).statusCode).toBe(403);
    const adminWeb = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '192.0.2.71', payload: { username: 'admin', password },
    });
    const adminCookie = String(adminWeb.headers['set-cookie']).split(';')[0];
    expect((await app.inject({
      method: 'POST', url: '/api/auth/revoke-sessions', payload: target, headers: { cookie: adminCookie },
    })).json()).toEqual({ error: 'CSRF_REJECTED' });
    expect((await api('admin', 'POST', '/api/auth/revoke-sessions', target)).json().revoked).toBeGreaterThanOrEqual(2);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(401);
    expect((await api('utrc_member', 'GET', '/api/auth/session')).statusCode).toBe(401);
    expect((await api('dlsa', 'GET', '/api/auth/session')).statusCode).toBe(200);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE action = 'session.revoke_all'").get()).toBeDefined();
  });

  test('configured logging redacts CSRF, authorization, and cookie headers', async () => {
    let logged = '';
    const stream = new Writable({ write(chunk, _, done) { logged += chunk.toString(); done(); } });
    const loggedApp = await buildApp({ db, origin, logger: { stream, serializers: { req: request => request } } });
    try {
      loggedApp.log.info({ req: { headers: {
        authorization: 'fictional-sensitive-auth', cookie: 'fictional-sensitive-cookie',
        'x-csrf-token': 'fictional-sensitive-csrf', 'x-test-marker': 'fictional-visible',
      } } });
      expect(JSON.parse(logged).req.headers).toEqual({
        authorization: '[Redacted]', cookie: '[Redacted]', 'x-csrf-token': '[Redacted]',
        'x-test-marker': 'fictional-visible',
      });
    } finally {
      await loggedApp.close();
    }
  });

  test('a full account or cache cannot evict another account’s files', () => {
    let now = 0;
    const cache = createExportCache(() => now);
    const record = vi.fn();
    const contents = [{ name: 'fictional.pdf', type: 'application/pdf', data: Buffer.alloc(12 * 1024 * 1024) }];
    const [path] = cache.store('first', contents, record);
    const fileId = path.split('/')[3];
    expect(cache.get('second', fileId, contents[0].name)).toBeUndefined();
    expect(() => cache.store('first', contents, record)).toThrow('ACCOUNT_EXPORT_CAPACITY');
    cache.store('second', contents, record);
    expect(() => cache.store('third', contents, record)).toThrow('EXPORT_CAPACITY');
    expect(record).toHaveBeenCalledTimes(2);
    expect(cache.get('first', fileId, contents[0].name)).toBe(contents[0]);
    now += 10 * 60_000;
    expect(cache.get('first', fileId, contents[0].name)).toBeUndefined();
    expect(cache.store('third', contents, record)).toHaveLength(1);
  });

  test('SQLCipher encrypts data and audit detects tampering', () => {
    const raw = readFileSync(dbFile);
    expect(raw.subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
    expect(raw.includes(Buffer.from(fictionalAlias))).toBe(false);
    const chain = verifyAudit(db);
    expect(chain.valid).toBe(true);
    expect(chain.entries).toBeGreaterThan(15);
    expect(db.prepare<[], { hash: string }>('SELECT hash FROM accounts LIMIT 1').get()?.hash).toMatch(/^\$argon2id\$/);
    const wrongKey = join(directory, 'wrong-key');
    writeFileSync(wrongKey, '0'.repeat(64));
    expect(() => openDb(dbFile, wrongKey)).toThrow();
    expect(() => db.exec("UPDATE audit_log SET action = 'not audited' WHERE id = 1")).toThrow(/append-only/);
    db.exec("DROP TRIGGER audit_no_update; UPDATE audit_log SET action = 'tampered' WHERE id = 1");
    expect(verifyAudit(db).valid).toBe(false);
  });
});
