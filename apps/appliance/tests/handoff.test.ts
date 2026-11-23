import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Session } from '../src/auth.js';
import { openDb, type Db } from '../src/db.js';
import { createHandoffs, handoffRoutes, type Handoffs } from '../src/handoff.js';

// Fictional ids only.
const caseId = 'c990777';
let directory: string;
let db: Db;
let clock = Date.parse('2026-11-23T12:00:00Z');
let handoffs: Handoffs;

describe.sequential('handoff versions and heartbeat', () => {
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'courtplus-handoff-test-'));
    const secret = join(directory, 'db-key');
    writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600 });
    db = openDb(join(directory, 'db.sqlite3'), secret);
    db.prepare('INSERT INTO persons (id, data) VALUES (?, ?)').run('p990777', '{}');
    db.prepare('INSERT INTO cases (id, person_id, data) VALUES (?, ?, ?)').run(caseId, 'p990777', '{}');
    handoffs = createHandoffs(db, 1000, () => clock);
  });

  afterAll(() => {
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('version grows with each state change and is carried on every event', () => {
    const { handoff } = handoffs.post({ caseId, kind: 'bail_granted', orderOn: '2026-11-22' }, 'tester');
    expect(handoff.version).toBe(1);
    expect(handoffs.post({ caseId, kind: 'bail_granted', orderOn: '2026-11-22' }, 'tester').handoff.version).toBe(1);
    clock += 2000;
    handoffs.sweep();
    expect(handoffs.list().find(item => item.id === handoff.id)?.version).toBe(2);
    expect(handoffs.ack(handoff.id, 'tester').version).toBe(3);
    expect(handoffs.ack(handoff.id, 'tester').version).toBe(3);
    const versions = handoffs.events(0).map(event => [event.type, (JSON.parse(event.data) as { version: number }).version]);
    expect(versions).toEqual([['posted', 1], ['overdue', 2], ['acknowledged', 3]]);
  });

  test('sends heartbeats on their own timer even when the sweep fails', async () => {
    const sweep = vi.fn(() => { throw new Error('fictional sweep failure'); });
    const failing: Handoffs = { ...handoffs, sweep };
    const app = Fastify();
    const session: Session = { id: 'u', role: 'superintendent', kind: 'desktop', expires: Infinity, tokenHash: '', csrf: '' };
    handoffRoutes(app, failing, () => session, 10, 25);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const response = await fetch(address + '/api/handoff/stream', { signal: AbortSignal.timeout(5000) });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let contents = '';
      while ((contents.match(/: heartbeat/g) ?? []).length < 2) {
        const next = await reader.read();
        if (next.done) throw new Error('stream ended');
        contents += decoder.decode(next.value, { stream: true });
      }
      expect(sweep).toHaveBeenCalled();
      expect(contents).toContain('event: snapshot');
      expect(contents).toContain('"version":3');
      await reader.cancel();
    } finally {
      await app.close();
    }
  });
});
