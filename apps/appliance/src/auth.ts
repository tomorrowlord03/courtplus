import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, sha256, type Db } from './db.js';
import { HttpError, parse } from './http.js';
import { forbidden, password, roles, username, type Role } from './inputs.js';

const cookieName = '__Host-courtplus';
const hashOptions = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const lifetimes = { cookie: 8 * 60 * 60, bearer: 15 * 60 };
const loginWindowMs = 60_000;
const maxAccountFailures = 5;
const maxIpLogins = 2;
const maxUnknownUsers = 1024;
type SessionKind = keyof typeof lifetimes;
type Account = { id: string; hash: string; role: Role };
type LoginFailures = { count: number; until: number };
export type Session = { id: string; role: Role; kind: SessionKind; expires: number; tokenHash: string; csrf: string };
const login = z.strictObject({ username, password, client: z.enum(['web', 'desktop']).default('web') });

export async function addAccount(db: Db, user: string, pass: string, role: Role): Promise<void> {
  const id = randomUUID();
  const encoded = await hash(pass, hashOptions);
  db.transaction(() => {
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, user, encoded, role);
    audit(db, 'operator', 'account.create', { id, role });
  }).immediate();
}

function sessionToken(request: FastifyRequest): [string, SessionKind] {
  const header = request.headers.authorization;
  const token = header === undefined ? request.cookies[cookieName] : /^Bearer ([\w-]{43})$/i.exec(header)?.[1];
  if (!token || !/^[\w-]{43}$/.test(token)) throw new HttpError(401, 'UNAUTHENTICATED');
  return [token, header === undefined ? 'cookie' : 'bearer'];
}

export function allowedOrigin(request: FastifyRequest, origin: string): void {
  if (request.headers.origin !== undefined && request.headers.origin !== origin) forbidden();
}

export async function authRoutes(app: FastifyInstance, db: Db, origin: string) {
  const dummyHash = await hash(randomBytes(24), hashOptions);
  const account = db.prepare<[string], Account>('SELECT id, hash, role FROM accounts WHERE username = ?');
  const read = db.prepare<[string, SessionKind, number], Omit<Session, 'csrf' | 'tokenHash'>>(
    'SELECT accounts.id, accounts.role, sessions.kind, sessions.expires FROM sessions'
    + ' JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND kind = ? AND expires > ?',
  );
  const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const prune = db.prepare('DELETE FROM sessions WHERE expires <= ?');
  const revokeAll = db.prepare('DELETE FROM sessions WHERE account_id = ?');
  const activeAccounts = new Set<string>();
  const activeIps = new Map<string, number>();
  const accountFailures = new Map<string, LoginFailures>();
  const unknownFailures = new Map<string, LoginFailures>();

  function authenticate(request: FastifyRequest): Session {
    const [token, kind] = sessionToken(request);
    const tokenHash = sha256(token);
    const row = read.get(tokenHash, kind, Date.now());
    if (!row) throw new HttpError(401, 'UNAUTHENTICATED');
    return { ...row, tokenHash, csrf: sha256('courtplus-csrf:' + token) };
  }

  function authorize(request: FastifyRequest, allowedRoles: readonly Role[], write = false): Session {
    const session = authenticate(request);
    if (!allowedRoles.includes(session.role)) forbidden();
    if (write && session.kind === 'cookie') {
      allowedOrigin(request, origin);
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf)
        || !timingSafeEqual(Buffer.from(csrf, 'hex'), Buffer.from(session.csrf, 'hex'))) {
        throw new HttpError(403, 'CSRF_REJECTED');
      }
    }
    return session;
  }

  app.post('/api/auth/login', {
    bodyLimit: 2048,
    config: { rateLimit: { max: 5, timeWindow: loginWindowMs } },
  }, async (request, reply) => {
    allowedOrigin(request, origin);
    if (!request.headers['content-type']?.match(/^application\/json(?:\s*;|$)/i)) {
      throw new HttpError(415, 'JSON_REQUIRED');
    }
    const input = parse(login, request.body);
    const user = account.get(input.username);
    const failures = user ? accountFailures : unknownFailures;
    const at = Date.now();
    const recent = failures.get(input.username);
    const prior = recent && recent.until > at ? recent : undefined;
    if (prior && prior.count >= maxAccountFailures) {
      reply.header('retry-after', Math.ceil((prior.until - at) / 1000));
      throw new HttpError(429, 'TRY_AGAIN');
    }
    const ip = request.ip;
    const ipLogins = activeIps.get(ip) ?? 0;
    if (ipLogins >= maxIpLogins || activeAccounts.has(input.username)) throw new HttpError(429, 'TRY_AGAIN');
    activeIps.set(ip, ipLogins + 1);
    activeAccounts.add(input.username);
    let matched: boolean;
    try {
      matched = await verify(user?.hash ?? dummyHash, input.password);
    } finally {
      activeAccounts.delete(input.username);
      const remaining = (activeIps.get(ip) ?? 1) - 1;
      if (remaining) activeIps.set(ip, remaining);
      else activeIps.delete(ip);
    }
    if (!user || !matched) {
      // Unknown usernames follow the same throttle without displacing real account counters.
      if (!user && !recent && unknownFailures.size >= maxUnknownUsers) {
        const oldest = unknownFailures.keys().next().value;
        if (oldest !== undefined) unknownFailures.delete(oldest);
      }
      failures.set(input.username, { count: (prior?.count ?? 0) + 1, until: prior?.until ?? at + loginWindowMs });
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    failures.delete(input.username);
    const kind = input.client === 'web' ? 'cookie' : 'bearer';
    const token = randomBytes(32).toString('base64url');
    const expires = Date.now() + lifetimes[kind] * 1000;
    db.transaction(() => {
      const expired = prune.run(Date.now()).changes;
      if (expired) audit(db, 'system', 'session.expire', { count: expired });
      insert.run(sha256(token), user.id, kind, expires);
      audit(db, user.id, 'session.create', { kind, expires });
    }).immediate();

    if (kind === 'bearer') return { token, expires, role: user.role };
    reply.setCookie(cookieName, token, {
      secure: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: lifetimes.cookie,
    });
    return { csrfToken: sha256('courtplus-csrf:' + token), expires, role: user.role };
  });

  app.get('/api/auth/session', async request => {
    const { csrf, kind, role, expires } = authenticate(request);
    return { role, expires, ...(kind === 'cookie' && { csrfToken: csrf }) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = authorize(request, roles.options, true);
    db.transaction(() => {
      remove.run(session.tokenHash);
      audit(db, session.id, 'session.revoke', { kind: session.kind });
    }).immediate();
    if (session.kind === 'cookie') {
      reply.clearCookie(cookieName, { secure: true, httpOnly: true, sameSite: 'strict', path: '/' });
    }
    return reply.code(204).send();
  });

  app.post('/api/auth/revoke-sessions', async request => {
    const admin = authorize(request, ['admin'], true);
    const input = parse(z.strictObject({ username }), request.body);
    const user = account.get(input.username);
    if (!user) throw new HttpError(404, 'ACCOUNT_NOT_FOUND');
    return db.transaction(() => {
      const revoked = revokeAll.run(user.id).changes;
      audit(db, admin.id, 'session.revoke_all', { accountId: user.id, count: revoked });
      return { revoked };
    }).immediate();
  });

  return { authenticate, authorize };
}
