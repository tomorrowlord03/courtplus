import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { addAccount } from '../src/auth.js';
import { openDb, type Db } from '../src/db.js';
import { EVIDENCE_ROLES } from '../src/evidence.js';
import { roles } from '../src/inputs.js';

describe('judge role (w35)', () => {
  const origin = 'https://courtplus.example.test';
  const password = 'fictional password 12345';
  let directory: string;
  let db: Db;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let judge: string;

  async function login(username: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, client: 'desktop' }),
    });
    expect(res.statusCode).toBe(200);
    return 'Bearer ' + JSON.parse(res.body).token;
  }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-judge-role-'));
    const secret = join(directory, 'db.key');
    writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600 });
    db = openDb(join(directory, 'test.sqlite3'), secret);
    await addAccount(db, 'fictional_magistrate', password, 'judge');
    app = await buildApp({ db, origin, evidenceDir: join(directory, 'vault'), office: 'Fictional Test Court' });
    judge = await login('fictional_magistrate');

    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n%Fictional judge-role payload\n%%EOF')]), 'fictional.pdf');
    form.append('caseRef', 'FICTIONAL-JUDGE-001');
    form.append('description', 'Fictional document for the judge role test');
    form.append('mode', 'anonymous');
    const submitted = await app.inject({ method: 'POST', url: '/evidence', headers: { origin }, body: form as never });
    expect(submitted.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('judge is an auth role and may use the evidence routes', () => {
    expect(roles.options).toContain('judge');
    expect(EVIDENCE_ROLES).toContain('judge');
  });

  test('judge reads the evidence feed and records an action', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/evidence', headers: { authorization: judge } });
    expect(feed.statusCode).toBe(200);
    const [item] = JSON.parse(feed.body) as { id: string }[];
    expect(item).toBeDefined();

    const action = await app.inject({
      method: 'POST', url: `/api/evidence/${item.id}/action`,
      headers: { authorization: judge, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seen', note: 'Seen in chambers' }),
    });
    expect(action.statusCode).toBe(200);
    expect(JSON.parse(action.body).status).toBe('seen');
  });

  test('judge sees the court (review) view and cannot edit cases', async () => {
    const role = await app.inject({
      method: 'POST', url: '/api/role', headers: { authorization: judge, 'content-type': 'application/json' }, body: '[]',
    });
    expect(role.statusCode).toBe(200);
    expect(JSON.parse(role.body)).toBe('utrc');

    const save = await app.inject({
      method: 'POST', url: '/api/saveCase', headers: { authorization: judge, 'content-type': 'application/json' }, body: '[]',
    });
    expect(save.statusCode).toBe(403);
  });

  test('evidence feed still needs a signed-in user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/evidence' });
    expect(res.statusCode).toBe(401);
  });
});
