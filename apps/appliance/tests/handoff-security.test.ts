import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session } from '../src/auth.js';
import { handoffRoutes, type Handoffs } from '../src/handoff.js';
import { HttpError } from '../src/http.js';

let app: ReturnType<typeof Fastify> | undefined;
let controller: AbortController;

afterEach(async () => {
  controller?.abort();
  await app?.close();
  vi.restoreAllMocks();
});

async function setup(expires = Date.now() + 600_000) {
  const server = Fastify({ trustProxy: true });
  app = server;
  controller = new AbortController();
  let drain: (() => void) | undefined;
  server.addHook('onRequest', async (request, reply) => {
    if (request.headers['x-test-slow'] !== 'yes') return;
    const write = reply.raw.write.bind(reply.raw);
    vi.spyOn(reply.raw, 'write').mockImplementation((...args) => {
      const written = write(...args);
      if (drain || !String(args[0]).includes('event: posted')) return written;
      drain = () => { reply.raw.emit('drain'); };
      return false;
    });
  });
  const events: ReturnType<Handoffs['events']> = [];
  const handoffs: Handoffs = {
    list: () => [], events: vi.fn((after: number) => events.filter(event => event.id > after)),
    head: () => events.length, sweep: vi.fn(),
    post: () => { throw new Error('Unexpected post'); },
    ack: () => { throw new Error('Unexpected acknowledgement'); },
  };
  let revoked = false;
  const authorize = vi.fn((request: FastifyRequest): Session => {
    if (revoked) throw new HttpError(401, 'UNAUTHENTICATED');
    return { id: String(request.headers['x-test-account']), role: 'dlsa', kind: 'cookie', expires, tokenHash: '', csrf: '' };
  });
  const { notify } = handoffRoutes(server, handoffs, authorize, 10);
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  return {
    authorize, handoffs, notify,
    connect(account: string, ip: string, slow = false) {
      return fetch(address + '/api/handoff/stream', {
        headers: { 'x-test-account': account, 'x-forwarded-for': ip, ...(slow && { 'x-test-slow': 'yes' }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
      });
    },
    addEvents(...types: ReturnType<Handoffs['events']>[number]['type'][]) {
      for (const type of types) events.push({ id: events.length + 1, type, data: '{}' });
      notify();
    },
    resume() { drain?.(); },
    revoke() { revoked = true; },
  };
}

test('stream capacity is enforced per account and IP independently', async () => {
  const { connect } = await setup();
  expect((await connect('first', '192.0.2.10')).status).toBe(200);
  expect((await connect('first', '192.0.2.11')).status).toBe(200);
  const accountLimit = await connect('first', '192.0.2.12');
  expect(accountLimit.status).toBe(429);
  expect(await accountLimit.json()).toMatchObject({ code: 'STREAM_LIMIT' });
  expect((await connect('second', '192.0.2.10')).status).toBe(200);
  const ipLimit = await connect('third', '192.0.2.10');
  expect(ipLimit.status).toBe(429);
  expect(await ipLimit.json()).toMatchObject({ code: 'STREAM_LIMIT' });
  expect((await connect('third', '192.0.2.12')).status).toBe(200);
});

test('idle streams check session expiry in memory and reauthorize every minute', async () => {
  const start = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const { authorize, connect, handoffs, notify } = await setup(start + 120_000);
  const reader = (await connect('first', '192.0.2.10')).body!.getReader();
  expect((await reader.read()).done).toBe(false);
  await vi.waitFor(() => expect(handoffs.sweep).toHaveBeenCalled());
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(handoffs.events).not.toHaveBeenCalled();
  clock.mockReturnValue(start + 60_000);
  notify();
  expect(authorize).toHaveBeenCalledTimes(2);
  clock.mockReturnValue(start + 120_000);
  notify();
  expect((await reader.read()).done).toBe(true);
  expect(authorize).toHaveBeenCalledTimes(2);
});

test('a revoked session is closed before any new event is read', async () => {
  const { addEvents, connect, handoffs, revoke } = await setup();
  const reader = (await connect('first', '192.0.2.10')).body!.getReader();
  expect((await reader.read()).done).toBe(false);
  revoke();
  addEvents('posted');
  expect((await reader.read()).done).toBe(true);
  expect(handoffs.events).not.toHaveBeenCalled();
});

test('a slow stream waits for drain and resumes from the last written event', async () => {
  const { addEvents, connect, handoffs, notify, resume } = await setup();
  const reader = (await connect('first', '192.0.2.10', true)).body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await read()).toContain('event: snapshot');
  addEvents('posted', 'acknowledged');
  expect(await read()).toContain('event: posted');
  notify();
  expect(handoffs.events).toHaveBeenCalledTimes(1);
  resume();
  expect(await read()).toContain('event: acknowledged');
  expect(handoffs.events).toHaveBeenLastCalledWith(1);
});
