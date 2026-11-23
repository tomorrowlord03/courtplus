import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type Database from 'better-sqlite3-multiple-ciphers';

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

function hashJson(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('Audit value must be JSON serializable');
  return createHash('sha256').update(json).digest('hex');
}

export function makeAuditEntry(
  previous: AuditEntry | undefined,
  input: { ts: string; actor: string; action: string; payload: unknown },
): AuditEntry {
  const entry = {
    id: (previous?.id ?? 0) + 1,
    ts: input.ts,
    actor: input.actor,
    action: input.action,
    payload_hash: hashJson(input.payload),
    prev_hash: previous?.hash ?? GENESIS_HASH,
  };
  return { ...entry, hash: hashJson(entry) };
}

export function appendAudit(
  db: Database.Database,
  actor: string,
  action: string,
  payload: unknown,
): AuditEntry {
  return db.transaction(() => {
    const previous = db.prepare<[], AuditEntry>(
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT 1',
    ).get();
    const entry = makeAuditEntry(previous, { ts: new Date().toISOString(), actor, action, payload });
    db.prepare(`
      INSERT INTO audit_log (id, ts, actor, action, payload_hash, prev_hash, hash)
      VALUES (@id, @ts, @actor, @action, @payload_hash, @prev_hash, @hash)
    `).run(entry);
    return entry;
  }).immediate();
}

export function verifyAuditChain(entries: Iterable<AuditEntry>, expectedHead?: string): boolean {
  let id = 1;
  let previous = GENESIS_HASH;
  for (const { hash, ...entry } of entries) {
    if (entry.id !== id || entry.prev_hash !== previous || hashJson(entry) !== hash) return false;
    id += 1;
    previous = hash;
  }
  return expectedHead === undefined || expectedHead === previous;
}

/**
 * A printed anchor is an earlier chain head, so later entries are expected. The anchor proves the
 * history up to it is unchanged only if the whole chain still verifies and still contains it.
 */
export function chainIncludesAnchor(entries: readonly AuditEntry[], anchor: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(anchor) || !verifyAuditChain(entries)) return false;
  return anchor === GENESIS_HASH || entries.some(entry => entry.hash === anchor);
}
