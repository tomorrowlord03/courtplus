import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CourtPlusApi } from '@courtplus/contracts';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { authRoutes, type Session } from './auth.js';
import { createCases, indiaDate } from './cases.js';
import type { Db } from './db.js';
import { createHandoffs, handoffRoutes } from './handoff.js';
import { HttpError, missingFeature, page, parse } from './http.js';
import { apiInputs, date, digest, envelopes, id, maxVerifyBase64, roles, type Role } from './inputs.js';
import { createReceipts, receiptRoutes } from './receipts.js';
import { exportRoutes } from './exports.js';
import { registerEvidenceRoutes } from './evidence.js';
import { registerHearingRoutes } from './hearings.js';

const all = roles.options;
const editors = ['superintendent', 'dlsa', 'legal_aid'] as const;
const reporters = [...editors, 'utrc_member'] as const;
const handoffReaders = all;

type ApiMethod = keyof CourtPlusApi;
type ApiHandlers = {
  [K in ApiMethod]: (user: Session, ...args: Parameters<CourtPlusApi[K]>) =>
    Awaited<ReturnType<CourtPlusApi[K]>> | ReturnType<CourtPlusApi[K]>;
};
const access: Record<ApiMethod, { roles: readonly Role[]; write?: boolean; bodyLimit?: number; rate?: number }> = {
  listPersons: { roles: all },
  listCases: { roles: all },
  importOrder: { roles: editors, write: true },
  saveCase: { roles: editors, write: true },
  screen: { roles: all },
  board: { roles: all },
  updateCard: { roles: editors, write: true },
  exportDraft: { roles: editors, write: true, rate: 6 },
  exportScReturn: { roles: reporters, write: true, rate: 6 },
  verify: { roles: all, bodyLimit: maxVerifyBase64 + 16 * 1024, rate: 6 },
  stats: { roles: all },
  role: { roles: all },
  judgeDashboard: { roles: all },
};

export interface Options {
  db: Db;
  origin: string;
  handoffDueMs?: number;
  tickMs?: number;
  now?: () => number;
  uiDir?: string;
  statsDir?: string;
  signingKeyFile?: string;
  office?: string;
  prison?: string;
  district?: string;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: Options) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const web = fileURLToPath(new URL('../web/', import.meta.url));
  const { db, origin, now = Date.now } = options;
  const app = Fastify({
    logger: options.logger ? {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
      // Privacy: never log client IPs (the anonymous channel promises none are kept) or anonymous receipt codes.
      serializers: {
        req: (req: { method?: string; url?: string; id?: string }) => ({
          id: req.id, method: req.method, url: String(req.url ?? '').replace(/^\/evidence\/status\/[^/?#]+/, '/evidence/status/[code]'),
        }),
      },
      ...typeof options.logger === 'object' && options.logger,
    } : false,
    bodyLimit: 256 * 1024,
    trustProxy: (_, hop) => hop === 0,
    requestTimeout: 30_000,
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { frameSrc: ["'self'"], imgSrc: ["'self'", 'data:'] } },
  });
  await app.register(cookie);
  await app.register(cors, { origin, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'] });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  app.addContentTypeParser('multipart/form-data', (_req, _payload, done) => {
    done(null);
  });
  app.addHook('onRequest', async (_, reply) => { reply.header('cache-control', 'no-store'); });
  app.setErrorHandler((error, _, reply) => {
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.code });
    const status = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'REQUEST_REJECTED' });
    app.log.error({ err: error }, 'CourtPlus Cloud request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  const { authenticate, authorize } = await authRoutes(app, db, origin);
  const handoffs = createHandoffs(db, options.handoffDueMs ?? 60 * 60_000, now);
  const { notify } = handoffRoutes(app, handoffs, (request, write, role) =>
    authorize(request, role ? [role] : handoffReaders, write), options.tickMs ?? 1000);
  const cases = createCases(db, handoffs, now);
  const receipts = createReceipts(db);
  receiptRoutes(app, receipts, origin, (request, action) =>
    authorize(request, action === 'withdraw' ? ['admin'] : editors, true));
  app.post('/api/verify-digest', { bodyLimit: 12 * 1024, config: { rateLimit: { max: 30 } } }, async request => {
    authorize(request, all);
    return receipts.verifyDigest(parse(envelopes.extend({ pdfDigest: digest, pdfSha3_256: digest.optional() }), request.body));
  });
  const exports = await exportRoutes(app, options, cases, receipts, authenticate);
  registerEvidenceRoutes(app, db, options, authenticate, authorize);
  registerHearingRoutes(app, db, authorize);
  const statsPath = options.statsDir ?? join(root, 'data', 'stats');
  const figures = ['india.json', 'chhattisgarh.json'].flatMap(file => {
    const path = join(statsPath, file);
    if (!existsSync(path)) return [];
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const schema = z.object({ figures: z.array(z.object({
      label: z.string(), value: z.number(), source: z.string(), date: z.string(),
      geography: z.string(), verified: z.boolean(),
    }).passthrough()) });
    return schema.parse(data).figures.filter(figure => figure.verified)
      .map(figure => ({ ...figure, label: figure.geography + ' · ' + figure.label }));
  });

  const handlers: ApiHandlers = {
    listPersons: () => cases.listPersons(),
    listCases: () => cases.listCases(),
    // Raw orders and the intake model run on the desktop. Reject before parsing the upload.
    importOrder: () => missingFeature('IMPORT_ORDER_ON_DESKTOP'),
    saveCase(user, person, record) {
      cases.save(person, record, user);
      notify();
    },
    screen: (_, caseId, asOf) => cases.screening(caseId, asOf),
    board: (_, asOf) => {
      handoffs.sweep();
      return cases.board(asOf);
    },
    updateCard(user, id, patch) {
      const card = cases.update(id, patch, user);
      notify();
      return card;
    },
    exportDraft: exports.draft,
    exportScReturn: exports.return,
    verify: (_, bundle) => receipts.verifyBundle(bundle),
    stats: () => ({ peopleCount: cases.listPersons().length, caseCount: cases.listCases().length, figures }),
    role: ({ role }) => ['utrc_member', 'admin', 'judge'].includes(role) ? 'utrc'
      : role as Awaited<ReturnType<CourtPlusApi['role']>>,
    judgeDashboard: async (_, asOf, judgeName) => {
      const { computeJudgePerformance } = await import('@courtplus/engine');
      return computeJudgePerformance(cases.listCases(), asOf ?? indiaDate(), judgeName);
    },
  };

  const schemas: { [K in ApiMethod]: z.ZodType<Parameters<CourtPlusApi[K]>> } = apiInputs;
  function register<K extends ApiMethod>(method: K) {
    const config = access[method];
    app.post('/api/' + method, {
      bodyLimit: config.bodyLimit,
      config: config.rate === undefined ? undefined : { rateLimit: { max: config.rate } },
      // Rate limiting runs first, and unauthorized requests still skip body parsing.
      preParsing: async request => {
        authorize(request, config.roles, config.write);
        if (method === 'importOrder') missingFeature('IMPORT_ORDER_ON_DESKTOP');
      },
    }, async (request, reply) => {
      const result = await handlers[method](authenticate(request), ...parse(schemas[method], request.body));
      if (result === undefined) return reply.code(204).send();
      if (typeof result === 'string') return reply.type('application/json').send(JSON.stringify(result));
      return result;
    });
  }
  for (const method of Object.keys(handlers) as ApiMethod[]) register(method);
  app.post('/api/cases/:caseId/application-filed', async (request, reply) => {
    const user = authorize(request, ['superintendent'], true);
    const { caseId } = parse(z.object({ caseId: id }), request.params);
    const { filedOn } = parse(z.strictObject({ filedOn: date }), request.body);
    cases.file(caseId, filedOn, user);
    return reply.code(204).send();
  });

  app.get('/health', async () => {
    db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
    return { status: 'ok' };
  });
  for (const [name, type] of [['cloud.js', 'text/javascript'], ['cloud.css', 'text/css']]) {
    app.get('/' + name, async (_, reply) => reply.type(type).send(readFileSync(join(web, name))));
  }
  app.get('/cloud-hi.json', async (_, reply) =>
    reply.type('application/json').send(readFileSync(join(root, 'data', 'ui', 'hi.json'))));
  app.get('/login', async (_, reply) => page(reply, 'Sign in', [
    '<form id="sign-in">',
    '<label>Account<input name="username" autocomplete="username" required></label>',
    '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>',
    '<button type="submit">Sign in</button><p role="status"></p></form>',
  ].join(''), 'login'));

  app.get('/handoffs', async (request, reply) => {
    try {
      authorize(request, handoffReaders);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) return reply.redirect('/login');
      throw error;
    }
    return page(reply, 'Jail and DLSA handoffs', [
      '<nav><a href="/">CourtPlus</a> <button type="button" id="sign-out">Sign out</button></nav>',
      '<form id="new-handoff" hidden>',
      '<label>Case <select name="caseId" required></select></label>',
      '<label>Order <select name="kind"><option value="release_order">Release order</option>',
      '<option value="bail_granted">Bail grant</option><option value="acquitted">Acquittal</option></select></label>',
      '<label>Order date<input type="date" name="orderOn" required></label><button>Send to jail</button></form>',
      '<form id="application-filed" hidden><label>Case <select name="caseId" required></select></label>',
      '<label>Application filed on<input type="date" name="filedOn" required></label><button>Record s.479(3) filing</button></form>',
      '<p id="handoff-status" role="status">Connecting…</p><ul id="handoff-list"></ul>',
    ].join(''), 'handoffs');
  });

  const uiDir = options.uiDir ?? join(root, 'apps', 'ui', 'dist');
  const indexPath = join(uiDir, 'index.html');
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8').replace(/<head(?:\s[^>]*)?>/i, element =>
    element + '<base href="/"><script src="/cloud.js" data-page="app"></script>') : undefined;
  for (const directory of ['assets', 'data/i18n']) {
    const path = join(uiDir, directory);
    if (existsSync(path)) {
      await app.register(staticFiles, { root: path, prefix: `/${directory}/`, cacheControl: false, decorateReply: false });
    }
  }
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== 'GET' || !/^\/(?:$|(?:board|cases?|persons?|person|import|drafts|return|sc-return|verify|stats|about|safeguards|evidence|submit-proof|file-evidence|track|settlement-guide)(?:\/[^.]+)?\/?$)/.test(request.url.split('?')[0])) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    try {
      authenticate(request);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) return reply.redirect('/login');
      throw error;
    }
    if (index) return reply.type('text/html; charset=utf-8').send(index);
    return page(reply, 'CourtPlus Cloud',
      '<p><a href="/handoffs">Open the jail and DLSA handoff board</a></p><p>The case UI becomes available when apps/ui is built.</p>' +
      '<button type="button" id="sign-out">Sign out</button>', 'home');
  });

  return app;
}
