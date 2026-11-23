import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Card, CaseRecord, CourtPlusApi, ISODate, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { z } from 'zod';
import type { Store } from '../store';
import { argumentSchemas } from '../validation';
import { indiaDate, type CardPatch } from './board';
import { cloudCase } from './cloud-data';

const roles = z.enum(['superintendent', 'dlsa', 'legal_aid', 'utrc_member', 'admin']);
const loginResponse = z.object({ token: z.string().regex(/^[\w-]{43}$/), role: roles, expires: z.number().int() });
const handoffSchema = z.object({
  id: z.uuidv4(), caseId: z.string(), kind: z.enum(['release_order', 'bail_granted', 'acquitted']),
  orderOn: z.iso.date(), dueAt: z.number(), escalatedAt: z.number().nullable(), acknowledgedAt: z.number().nullable(),
  // Older appliances send no version; mergeHandoff then falls back to the one-way timestamps.
  version: z.number().int().positive().optional(),
});
export type Handoff = z.infer<typeof handoffSchema>;
export type StreamEvent = { id?: number; type: string; data: unknown };
type CloudRole = z.infer<typeof roles>;
type Session = z.infer<typeof loginResponse> & { origin: string; stop: AbortController };
type Pair = Parameters<CourtPlusApi['saveCase']>;
type Envelopes = { receipt: string; manifest: string };
const labels: Record<Handoff['kind'], string> = {
  release_order: 'Release order', bail_granted: 'Bail grant', acquitted: 'Acquittal',
};
const releaseEvents = new Set(['released', 'bail_granted', 'acquitted']);
const checksum = (value: string) => createHash('sha256').update(value).digest('hex');
const readOnlyRoles: readonly CloudRole[] = ['admin', 'utrc_member'];

class CloudError extends Error {
  constructor(readonly status: number, detail: string) {
    super('CourtPlus Cloud ' + status + ': ' + detail);
  }
}

/** The appliance sends a heartbeat every 15 s; three missed beats mean a dead stream. */
export const STREAM_IDLE_MS = 45_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/** Exponential backoff with equal jitter, so many desktops do not reconnect in lockstep. */
export function reconnectDelay(failures: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(failures, 10));
  return Math.round(ceiling / 2 + random() * ceiling / 2);
}

/**
 * Keeps the newer of two copies of a handoff. Escalation and acknowledgement are one-way on the
 * server, so a replayed or out-of-order event must never clear them.
 */
export function mergeHandoff(existing: Handoff | undefined, incoming: Handoff): Handoff {
  if (!existing) return incoming;
  if (existing.version !== undefined && incoming.version !== undefined) {
    return incoming.version >= existing.version ? incoming : existing;
  }
  const regresses = (existing.acknowledgedAt !== null && incoming.acknowledgedAt === null)
    || (existing.escalatedAt !== null && incoming.escalatedAt === null);
  return regresses ? existing : incoming;
}

async function request(origin: string, path: string, options: {
  token?: string; body?: unknown; signal: AbortSignal; method?: 'POST'; lastEventId?: number;
}): Promise<Response> {
  const response = await fetch(origin + path, {
    redirect: 'error', signal: options.signal,
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.token && { authorization: 'Bearer ' + options.token }),
      ...(options.lastEventId !== undefined && { 'last-event-id': String(options.lastEventId) }),
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const detail = z.object({ error: z.string().regex(/^[A-Z_]{1,60}$/) }).safeParse(data);
    throw new CloudError(response.status, detail.success ? detail.data.error : 'Request failed');
  }
  return response;
}

export async function* streamEvents(response: Response, idleMs = STREAM_IDLE_MS): AsyncGenerator<StreamEvent> {
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('Cloud returned an invalid handoff stream.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let idle: ReturnType<typeof setTimeout> | undefined;
  // A half-open TCP connection never ends or errors, so silence itself must fail the stream.
  const read = () => new Promise<ReadableStreamReadResult<string>>((resolve, reject) => {
    idle = setTimeout(() => reject(new Error('Cloud handoff stream went quiet.')), idleMs);
    reader.read().then(resolve, reject);
  }).finally(() => clearTimeout(idle));
  try {
    for (;;) {
      const { done, value } = await read();
      if (done) break;
      buffer += value;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const lines = buffer.slice(0, boundary).split('\n');
        buffer = buffer.slice(boundary + 2);
        const type = lines.find(line => line.startsWith('event: '))?.slice(7);
        const id = lines.find(line => /^id: \d{1,15}$/.test(line))?.slice(4);
        const data = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (type && data) yield { id: id === undefined ? undefined : Number(id), type, data: JSON.parse(data) as unknown };
        boundary = buffer.indexOf('\n\n');
      }
      if (buffer.length > 4 * 1024 * 1024) throw new Error('Cloud handoff event is too large.');
    }
  } finally {
    clearTimeout(idle);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createCloud(store: Store, changed: () => void) {
  let session: Session | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setInterval> | undefined;
  let syncing: Session | undefined;
  let syncAgain = false;
  let handoffs = new Map<string, Handoff>();
  let remote = new Map<string, Pair>();
  let syncError = '';
  let connectionRequest = 0;

  const status = () => ({
    role: session?.role, expires: session?.expires, error: syncError,
  });
  const backend = () => store.readSetting('backendUrl') ?? '';
  const audit = (action: string, active: Session) =>
    store.audit(action, { origin: active.origin, role: active.role });

  function disconnect() {
    connectionRequest += 1;
    const active = session;
    if (active) audit('cloud.disconnect', active);
    session = undefined;
    clearTimeout(expiry);
    clearInterval(retry);
    active?.stop.abort();
    handoffs = new Map();
    remote = new Map();
    syncError = '';
    changed();
    return active;
  }

  async function call(active: Session, path: string, body?: unknown, method?: 'POST') {
    try {
      const response = await request(active.origin, path, {
        body, method, token: active.token, signal: AbortSignal.any([active.stop.signal, AbortSignal.timeout(8000)]),
      });
      return response.status === 204 ? undefined : await response.json() as unknown;
    } catch (error) {
      if (error instanceof CloudError && error.status === 401 && active === session) disconnect();
      throw error;
    }
  }

  function settingPrefix(origin: string) {
    return 'cloud:' + checksum(origin) + ':';
  }

  function localPairs(): Pair[] {
    const origin = backend();
    if (!origin) return [];
    const key = settingPrefix(origin) + 'pseudonym-key';
    const secret = store.readSetting(key);
    if (!secret) return [];
    const people = new Map(store.listPersons().map(person => [person.id, person]));
    return store.listCases().flatMap(record => {
      const person = people.get(record.personId);
      const pair = person && cloudCase(person, record, secret);
      return pair ? [pair] : [];
    });
  }

  function linkedCases(): Map<string, string> {
    const origin = backend();
    const secret = origin && store.readSetting(settingPrefix(origin) + 'pseudonym-key');
    if (!secret) return new Map();
    const people = new Map(store.listPersons().map(person => [person.id, person]));
    return new Map(store.listCases().flatMap(record => {
      const person = people.get(record.personId);
      const pair = person && cloudCase(person, record, secret);
      return pair ? [[pair[1].id, record.id] as const] : [];
    }));
  }

  async function refreshRemote(active: Session, cloudCases?: unknown) {
    const [records, people] = await Promise.all([
      cloudCases ?? call(active, '/api/listCases', []), call(active, '/api/listPersons', []),
    ]);
    if (!Array.isArray(records) || !Array.isArray(people)) throw new Error('Invalid cloud case list.');
    const peopleById = new Map((people as Person[]).map(person => [person.id, person]));
    const next = new Map<string, Pair>();
    for (const record of records as CaseRecord[]) {
      const parsed = argumentSchemas.saveCase.safeParse([peopleById.get(record.personId), record]);
      if (parsed.success) next.set(record.id, parsed.data);
    }
    return next;
  }

  async function watch(active: Session) {
    let failures = 0;
    let lastEventId: number | undefined;
    while (!active.stop.signal.aborted) {
      try {
        const response = await request(active.origin, '/api/handoff/stream', {
          token: active.token, signal: active.stop.signal, lastEventId,
        });
        for await (const { id, type, data } of streamEvents(response)) {
          if (active !== session) return;
          failures = 0;
          // Server event ids only grow; anything at or below the last one seen is a replay.
          if (type !== 'snapshot' && id !== undefined && lastEventId !== undefined && id <= lastEventId) continue;
          if (id !== undefined) lastEventId = id;
          const next = type === 'snapshot'
            ? new Map(z.array(handoffSchema).parse(data).map(handoff => [handoff.id, mergeHandoff(handoffs.get(handoff.id), handoff)]))
            : new Map(handoffs);
          if (['posted', 'overdue', 'acknowledged'].includes(type)) {
            const handoff = handoffSchema.parse(data);
            next.set(handoff.id, mergeHandoff(next.get(handoff.id), handoff));
          }
          const linked = linkedCases();
          if ([...next.values()].some(handoff => !linked.has(handoff.caseId) && !remote.has(handoff.caseId))) {
            const records = await refreshRemote(active);
            if (active !== session) return;
            remote = records;
          }
          const fingerprint = checksum(JSON.stringify([...next].sort(([a], [b]) => a.localeCompare(b))));
          store.writeSettings({ [settingPrefix(active.origin) + 'handoffs']: fingerprint },
            'cloud.handoff', { event: type, digest: fingerprint });
          handoffs = next;
          changed();
        }
      } catch (error) {
        if (active !== session) return;
        if (error instanceof CloudError && error.status === 401) {
          disconnect();
          return;
        }
        syncError = 'Handoff connection interrupted. Reconnecting.';
        changed();
      }
      await delay(reconnectDelay(failures++), undefined, { signal: active.stop.signal }).catch(() => undefined);
    }
  }

  async function flush(active: Session) {
    if (readOnlyRoles.includes(active.role)) return;
    const prefix = settingPrefix(active.origin);
    const saved = await call(active, '/api/listCases', []);
    if (!Array.isArray(saved)) throw new Error('Invalid cloud case list.');
    const byId = new Map((saved as CaseRecord[]).map(record => [record.id, record]));
    const links = linkedCases();
    const patches = store.readCards();
    for (const [person, record] of localPairs()) {
      if (active !== session) return;
      const previous = byId.get(record.id);
      if (active.role !== 'dlsa') {
        record.bailGrantedOn = previous?.bailGrantedOn;
        record.releasedOn = previous?.releasedOn;
        record.events = [...record.events.filter(event => !releaseEvents.has(event.kind)),
          ...(previous?.events.filter(event => releaseEvents.has(event.kind)) ?? [])];
      }
      const caseKey = prefix + 'case:' + record.id;
      const digest = checksum(JSON.stringify([person, record]));
      if (store.readSetting(caseKey) !== digest || !previous) {
        await call(active, '/api/saveCase', [person, record]);
        if (active !== session) return;
        store.writeSettings({ [caseKey]: digest }, 'cloud.case.push', { id: record.id, digest });
      }
    }
    for (const [remoteId, localId] of links) {
      for (const [id, patch] of patches) {
        if (id.slice(id.indexOf(':') + 1) !== localId || id.startsWith('handoff:')) continue;
        const cloudId = id.slice(0, id.length - localId.length) + remoteId;
        const allowed: CardPatch = {
          dueOn: patch.dueOn,
          state: patch.state === 'jail_acknowledged' && active.role !== 'superintendent' ? undefined : patch.state,
          owner: roles.safeParse(patch.owner).success ? patch.owner : undefined,
        };
        const json = JSON.stringify(allowed);
        const key = prefix + 'card:' + cloudId;
        if (json === '{}' || store.readSetting(key) === json) continue;
        if (active !== session) return;
        try {
          await call(active, '/api/updateCard', [cloudId, allowed]);
          if (active !== session) return;
          store.writeSettings({ [key]: json }, 'cloud.card.push', { id: cloudId, patch: allowed });
        } catch (error) {
          if (!(error instanceof CloudError) || error.status !== 404) throw error;
        }
      }
    }
  }

  function schedule() {
    const active = session;
    if (!active) return;
    if (syncing === active) {
      syncAgain = true;
      return;
    }
    syncing = active;
    void flush(active).then(() => {
      if (active === session) syncError = '';
    }, error => {
      if (active === session) syncError = error instanceof CloudError ? error.message : 'Cloud sync interrupted.';
    }).finally(() => {
      if (syncing !== active) return;
      syncing = undefined;
      const again = syncAgain;
      syncAgain = false;
      if (active !== session) return;
      changed();
      if (again) schedule();
    });
  }

  async function login(username: string, password: string) {
    const origin = backend();
    if (!origin) throw new Error('Save a backend URL before signing in.');
    const attempt = ++connectionRequest;
    const response = await request(origin, '/api/auth/login', {
      body: { username, password, client: 'desktop' }, signal: AbortSignal.timeout(8000),
    });
    const result = loginResponse.parse(await response.json());
    if (backend() !== origin || attempt !== connectionRequest) throw new Error('Cloud settings changed. Sign in again.');
    disconnect();
    const key = settingPrefix(origin) + 'pseudonym-key';
    if (!store.readSetting(key)) {
      store.writeSettings({ [key]: randomBytes(32).toString('hex') }, 'cloud.pseudonyms.create', { origin });
    }
    const active = { ...result, origin, stop: new AbortController() };
    audit('cloud.login', active);
    session = active;
    expiry = setTimeout(() => {
      if (session === active) disconnect();
    }, Math.max(0, Math.min(result.expires - Date.now(), 15 * 60_000)));
    retry = setInterval(schedule, 30_000).unref();
    void watch(active);
    schedule();
    return status();
  }

  async function signOut() {
    const active = disconnect();
    if (!active) return;
    await request(active.origin, '/api/auth/logout', {
      token: active.token, method: 'POST', signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }

  function records(): Pair[] {
    const linked = linkedCases();
    return [...new Set([...handoffs.values()].map(handoff => handoff.caseId))]
      .flatMap(id => !linked.has(id) && remote.has(id) ? [remote.get(id)!] : []);
  }

  function cards(asOf: ISODate, people: Person[], cases: CaseRecord[]): Card[] {
    const links = linkedCases();
    const casesById = new Map(cases.map(record => [record.id, record]));
    const peopleById = new Map(people.map(person => [person.id, person]));
    return [...handoffs.values()].flatMap(handoff => {
      const record = casesById.get(links.get(handoff.caseId) ?? handoff.caseId);
      const person = record && peopleById.get(record.personId);
      if (!record || !person || handoff.orderOn > asOf) return [];
      const label = labels[handoff.kind];
      const tags = [label, 'CourtPlus Cloud'];
      if (handoff.escalatedAt !== null && handoff.acknowledgedAt === null) tags.push('Overdue · escalated');
      return [{
        id: 'handoff:' + handoff.id, caseId: record.id, personId: person.id, lane: 'COURT_JAIL_MISMATCH',
        title: person.alias + ' · ' + label, owner: 'superintendent', tags,
        state: handoff.acknowledgedAt === null ? 'order_verified' : 'jail_acknowledged',
        dueOn: indiaDate(new Date(handoff.dueAt)),
      }];
    });
  }

  async function updateHandoff(card: Card, patch: CardPatch) {
    const active = session;
    if (!active || active.role !== 'superintendent') throw new Error('Sign in as superintendent to update this handoff.');
    const next = { order_verified: 'jail_acknowledged', jail_acknowledged: 'holds_checked', holds_checked: 'closed' };
    if (Object.keys(patch).length !== 1 || !patch.state
      || next[card.state as keyof typeof next] !== patch.state) throw new Error('Choose the next handoff step.');
    await call(active, '/api/updateCard', [card.id, patch]);
    if (active === session) {
      store.writeSettings({ [settingPrefix(active.origin) + 'handoff-card:' + card.id]: patch.state },
        'cloud.handoff.update', { id: card.id, state: patch.state });
      changed();
    }
    return { ...card, ...patch };
  }

  function handoffState(card: Card): Card {
    if (!session || card.state !== 'jail_acknowledged') return card;
    const state = store.readSetting(settingPrefix(session.origin) + 'handoff-card:' + card.id);
    return state === 'holds_checked' || state === 'closed' ? { ...card, state } : card;
  }

  async function publish(origin: string, envelopes: Envelopes) {
    const active = session;
    if (!active || active.origin !== origin) throw new Error('Sign in to publish this draft’s public QR receipt.');
    await call(active, '/api/receipts', envelopes);
    audit('cloud.receipt.publish', active);
  }

  async function verifyDigest(input: Envelopes & { pdfDigest: string }) {
    if (!session) return undefined;
    const schema = z.object({
      signature: z.enum(['valid', 'invalid', 'unknown_signer']), pdf: z.enum(['unchanged', 'changed']),
      chain: z.literal('not_checked'),
    });
    const response = await call(session, '/api/verify-digest', input).catch(() => undefined);
    return schema.safeParse(response).data;
  }

  return { login, signOut, disconnect, status, schedule, records, cards, handoffState, updateHandoff, publish, verifyDigest };
}
