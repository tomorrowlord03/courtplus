import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Session } from './auth.js';
import { audit, type Db } from './db.js';
import { HttpError, parse, requireValue } from './http.js';
import { handoffInput, type HandoffInput } from './inputs.js';

type Handoff = HandoffInput & {
  id: string; postedAt: number; dueAt: number; escalatedAt: number | null; acknowledgedAt: number | null;
  /** Monotonic per handoff: clients drop any event whose version is lower than the one they hold. */
  version: number;
};
type Row = Omit<Handoff, 'version'>;
type Event = { id: number; type: 'posted' | 'acknowledged' | 'overdue'; data: string };
type Authorize = (request: FastifyRequest, write: boolean, role?: 'dlsa' | 'superintendent') => Session;

const handoffFields = 'id, case_id AS caseId, kind, order_on AS orderOn, posted_at AS postedAt,'
  + ' due_at AS dueAt, escalated_at AS escalatedAt, acknowledged_at AS acknowledgedAt';

// Escalation and acknowledgement are set once and never cleared, so counting them gives a
// version that only grows, without a schema change.
export function versioned(row: Row): Handoff {
  return { ...row, version: 1 + Number(row.escalatedAt !== null) + Number(row.acknowledgedAt !== null) };
}

export const HEARTBEAT_MS = 15_000;

export function createHandoffs(db: Db, dueMs: number, now: () => number) {
  const find = db.prepare<[string], Row>('SELECT ' + handoffFields + ' FROM handoffs WHERE id = ?');
  const byOrder = db.prepare<[string, HandoffInput['kind'], string], Row>(
    'SELECT ' + handoffFields + ' FROM handoffs WHERE case_id = ? AND kind = ? AND order_on = ?',
  );
  const overdue = db.prepare<[number], Row>(
    'SELECT ' + handoffFields + ' FROM handoffs WHERE due_at <= ? AND acknowledged_at IS NULL AND escalated_at IS NULL',
  );
  const list = db.prepare<[], Row>('SELECT ' + handoffFields + ' FROM handoffs ORDER BY posted_at DESC, id');
  const add = db.prepare('INSERT INTO handoffs (id, case_id, kind, order_on, posted_at, due_at) VALUES (?, ?, ?, ?, ?, ?)');
  const ack = db.prepare('UPDATE handoffs SET acknowledged_at = ? WHERE id = ?');
  const escalate = db.prepare('UPDATE handoffs SET escalated_at = ? WHERE id = ?');
  const event = db.prepare('INSERT INTO handoff_events (type, data) VALUES (?, ?)');
  const events = db.prepare<[number], Event>('SELECT * FROM handoff_events WHERE id > ? ORDER BY id LIMIT 100');
  const last = db.prepare<[], { id: number }>('SELECT coalesce(max(id), 0) AS id FROM handoff_events');
  const caseExists = db.prepare('SELECT 1 FROM cases WHERE id = ?');

  function record(type: Event['type'], row: Row, actor: string): void {
    const handoff = versioned(row);
    event.run(type, JSON.stringify(handoff));
    audit(db, actor, 'handoff.' + type, handoff);
  }

  const post = db.transaction((input: HandoffInput, actor: string) => {
    if (!caseExists.get(input.caseId)) throw new HttpError(404, 'CASE_NOT_FOUND');
    const existing = byOrder.get(input.caseId, input.kind, input.orderOn);
    if (existing) return { handoff: versioned(existing), created: false };
    const postedAt = now();
    const handoff: Row = {
      ...input, id: randomUUID(), postedAt, dueAt: postedAt + dueMs, escalatedAt: null, acknowledgedAt: null,
    };
    add.run(handoff.id, input.caseId, input.kind, input.orderOn, postedAt, handoff.dueAt);
    record('posted', handoff, actor);
    return { handoff: versioned(handoff), created: true };
  });

  function markOverdue(handoff: Row, at: number) {
    escalate.run(at, handoff.id);
    handoff.escalatedAt = at;
    record('overdue', handoff, 'system');
  }

  const acknowledge = db.transaction((id: string, actor: string) => {
    const handoff = requireValue(find.get(id), 'HANDOFF_NOT_FOUND');
    if (handoff.acknowledgedAt !== null) return versioned(handoff);
    const at = now();
    if (handoff.escalatedAt === null && at >= handoff.dueAt) markOverdue(handoff, at);
    ack.run(at, id);
    handoff.acknowledgedAt = at;
    record('acknowledged', handoff, actor);
    return versioned(handoff);
  });
  const sweep = db.transaction(() => {
    const at = now();
    for (const handoff of overdue.all(at)) markOverdue(handoff, at);
  });

  return {
    post: post.immediate, ack: acknowledge.immediate, sweep: sweep.immediate,
    list: () => list.all().map(versioned), events: (after: number) => events.all(after),
    head: () => requireValue(last.get()).id,
  };
}
export type Handoffs = ReturnType<typeof createHandoffs>;

export function handoffRoutes(
  app: FastifyInstance, handoffs: Handoffs, authorize: Authorize, tickMs: number, heartbeatMs = HEARTBEAT_MS,
) {
  const subscribers = new Set<{ account: string; ip: string; flush(head: number): void; heartbeat(): void; close(): void }>();
  const notify = () => {
    if (!subscribers.size) return;
    const head = handoffs.head();
    for (const subscriber of subscribers) subscriber.flush(head);
  };
  function sweep() {
    try {
      handoffs.sweep();
      notify();
    } catch (error) {
      app.log.error({ err: error }, 'Handoff polling failed');
    }
  }
  const timer = setInterval(sweep, tickMs).unref();
  // Separate from the sweep so a failing sweep cannot silence the stream: desktop clients treat
  // a stream with no bytes for a few heartbeat periods as dead and reconnect.
  const pulse = setInterval(() => {
    for (const subscriber of subscribers) subscriber.heartbeat();
  }, heartbeatMs).unref();
  app.addHook('preClose', async () => {
    clearInterval(timer);
    clearInterval(pulse);
    for (const subscriber of subscribers) subscriber.close();
  });

  app.get('/api/handoff', async request => {
    authorize(request, false);
    handoffs.sweep();
    return handoffs.list();
  });
  app.post('/api/handoff', async (request, reply) => {
    const user = authorize(request, true, 'dlsa');
    const { handoff, created } = handoffs.post(parse(handoffInput, request.body), user.id);
    notify();
    return reply.code(created ? 201 : 200).send(handoff);
  });
  app.post('/api/handoff/:id/ack', async request => {
    const user = authorize(request, true, 'superintendent');
    const { id } = parse(z.object({ id: z.uuidv4() }), request.params);
    const handoff = handoffs.ack(id, user.id);
    notify();
    return handoff;
  });

  function stream(request: FastifyRequest, reply: FastifyReply) {
    const session = authorize(request, false);
    let accountStreams = 0;
    let ipStreams = 0;
    for (const subscriber of subscribers) {
      if (subscriber.account === session.id) accountStreams += 1;
      if (subscriber.ip === request.ip) ipStreams += 1;
    }
    if (accountStreams >= 2 || ipStreams >= 2) throw new HttpError(429, 'STREAM_LIMIT');
    if (subscribers.size >= 64) throw new HttpError(503, 'STREAM_CAPACITY');
    const lastEventId = request.headers['last-event-id'];
    const head = handoffs.head();
    const lastId = typeof lastEventId === 'string' && /^\d{1,16}$/.test(lastEventId) ? Number(lastEventId) : NaN;
    const replay = Number.isSafeInteger(lastId) && lastId <= head && lastId >= Math.max(0, head - 500);
    let cursor = replay ? lastId : head;
    let lastChecked = Date.now();
    let paused = false;
    const response = reply.raw;

    function resume() {
      paused = false;
      try {
        subscriber.flush(handoffs.head());
      } catch {
        subscriber.close();
      }
    }

    function write(chunk: string): boolean {
      if (response.write(chunk)) return true;
      paused = true;
      response.once('drain', resume);
      return false;
    }

    function release() {
      response.off('drain', resume);
      subscribers.delete(subscriber);
    }

    function checkSession(sendingEvents = false) {
      const at = Date.now();
      if (session.expires <= at) throw new HttpError(401, 'UNAUTHENTICATED');
      if (sendingEvents || at - lastChecked >= 60_000) {
        authorize(request, false);
        lastChecked = at;
      }
    }

    const subscriber = {
      account: session.id,
      ip: request.ip,
      close() {
        release();
        response.end();
      },
      flush(head: number) {
        try {
          const sendingEvents = !paused && cursor < head;
          checkSession(sendingEvents);
          if (!sendingEvents) return;
          for (const { id, type, data } of handoffs.events(cursor)) {
            cursor = id;
            if (!write('id: ' + id + '\nevent: ' + type + '\ndata: ' + data + '\n\n')) return;
          }
        } catch {
          subscriber.close();
        }
      },
      heartbeat() {
        try {
          checkSession();
          if (!paused) write(': heartbeat\n\n');
        } catch {
          subscriber.close();
        }
      },
    };
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)) response.setHeader(name, value);
    }
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-store');
    response.setHeader('x-accel-buffering', 'no');
    response.writeHead(200);
    response.once('close', release);
    subscribers.add(subscriber);
    const initial = replay ? ': connected\n\n'
      : 'id: ' + head + '\nevent: snapshot\ndata: ' + JSON.stringify(handoffs.list()) + '\n\n';
    if (write(initial)) subscriber.flush(head);
  }
  app.get('/api/handoff/stream', { config: { rateLimit: { max: 12 } } }, stream);
  return { notify };
}
