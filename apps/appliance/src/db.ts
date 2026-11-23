import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { createRequire } from 'node:module';

const canonicalize = createRequire(import.meta.url)('canonicalize') as (value: unknown) => string | undefined;

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('Value is not JSON serializable');
  return json;
}

const schema = [
  'CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, role TEXT NOT NULL) STRICT',
  'CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, expires INTEGER NOT NULL) STRICT',
  'CREATE INDEX sessions_expiry ON sessions(expires)',
  'CREATE TABLE persons (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT',
  'CREATE TABLE cases (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id), data TEXT NOT NULL CHECK (json_valid(data))) STRICT',
  'CREATE INDEX cases_person ON cases(person_id)',
  'CREATE TABLE card_patches (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT',
  'CREATE TABLE filings (case_id TEXT PRIMARY KEY REFERENCES cases(id), filed_on TEXT NOT NULL) STRICT',
  'CREATE TABLE handoffs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), kind TEXT NOT NULL, order_on TEXT NOT NULL, posted_at INTEGER NOT NULL, due_at INTEGER NOT NULL, escalated_at INTEGER, acknowledged_at INTEGER, UNIQUE(case_id, kind, order_on)) STRICT',
  'CREATE INDEX handoffs_due ON handoffs(due_at) WHERE acknowledged_at IS NULL AND escalated_at IS NULL',
  'CREATE TABLE handoff_events (id INTEGER PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data))) STRICT',
  'CREATE TABLE issuers (key_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, office TEXT NOT NULL) STRICT',
  'CREATE TABLE receipts (id TEXT PRIMARY KEY, key_id TEXT NOT NULL REFERENCES issuers(key_id), receipt TEXT NOT NULL, manifest TEXT NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0) STRICT',
  'CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL) STRICT',
  "CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END",
  "CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END",
];

export const evidenceSchema = [
  'CREATE TABLE evidence (id TEXT PRIMARY KEY, case_ref TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN (\'identified\', \'anonymous\')), filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, received_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN (\'received\', \'seen\', \'taken_on_record\', \'shared_with_parties\')), submitter_name TEXT, submitter_phone TEXT, submitter_email TEXT, status_code_hash TEXT, receipt TEXT NOT NULL, receipt_signature TEXT NOT NULL, prev_hash TEXT NOT NULL, entry_hash TEXT NOT NULL, parent_id TEXT REFERENCES evidence(id), court TEXT, file_path TEXT NOT NULL) STRICT',
  'CREATE INDEX evidence_case_ref ON evidence(case_ref)',
  'CREATE INDEX evidence_mode ON evidence(mode)',
  'CREATE INDEX evidence_status_code_hash ON evidence(status_code_hash)',
  "CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END",
  'CREATE TABLE evidence_log (id INTEGER PRIMARY KEY, evidence_id TEXT NOT NULL, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL) STRICT',
  "CREATE TRIGGER evidence_log_no_update BEFORE UPDATE ON evidence_log BEGIN SELECT RAISE(ABORT, 'evidence log is append-only'); END",
  "CREATE TRIGGER evidence_log_no_delete BEFORE DELETE ON evidence_log BEGIN SELECT RAISE(ABORT, 'evidence log is append-only'); END",
  'CREATE TABLE evidence_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_id TEXT NOT NULL REFERENCES evidence(id), action TEXT NOT NULL, actor TEXT NOT NULL, ts TEXT NOT NULL, note TEXT) STRICT',
];

export type Db = Database.Database;

export function openDb(path: string, secretPath: string): Db {
  const key = readFileSync(secretPath, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('SQLCipher secret must contain 32 hex-encoded bytes');
  const db = new Database(path);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.pragma('key = "x\'' + key + '\'"');
    db.pragma('foreign_keys=ON');
    db.pragma('recursive_triggers=ON');
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true });
      if (version === 2) return;
      if (version === 0) {
        for (const sql of schema) db.exec(sql);
        for (const sql of evidenceSchema) db.exec(sql);
        db.pragma('user_version=2');
        return;
      }
      if (version === 1) {
        for (const sql of evidenceSchema) db.exec(sql);
        db.pragma('user_version=2');
        return;
      }
      throw new Error('Unsupported CourtPlus Cloud database version');
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

type AuditDetails = { ts: string; actor: string; action: string; payload_hash: string; prev_hash: string };
type AuditRow = AuditDetails & { id: number; hash: string };
export const genesis = '0'.repeat(64);

export function audit(db: Db, actor: string, action: string, payload: unknown): void {
  if (!db.inTransaction) throw new Error('Audit entries must share the write transaction');
  const tail = db.prepare<[], Pick<AuditRow, 'id' | 'hash'>>('SELECT id, hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  const details: AuditDetails = {
    ts: new Date().toISOString(), actor, action,
    payload_hash: sha256(canonical(payload)), prev_hash: tail?.hash ?? genesis,
  };
  const id = (tail?.id ?? 0) + 1;
  db.prepare('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, details.ts, actor, action, details.payload_hash, details.prev_hash, sha256(canonical({ id, ...details })));
}

export function verifyAudit(db: Db): { valid: boolean; entries: number; head: string } {
  let previous = genesis;
  let entries = 0;
  const rows = db.prepare<[], AuditRow>('SELECT * FROM audit_log ORDER BY id').iterate();
  for (const { hash, ...fields } of rows) {
    if (fields.id !== entries + 1 || fields.prev_hash !== previous || hash !== sha256(canonical(fields))) {
      return { valid: false, entries, head: previous };
    }
    entries += 1;
    previous = hash;
  }
  return { valid: true, entries, head: previous };
}

export function verifyEvidenceLog(db: Db): { valid: boolean; entries: number; head: string } {
  let previous = genesis;
  let entries = 0;
  const rows = db.prepare<[], { id: number; evidence_id: string; ts: string; actor: string; action: string; payload_hash: string; prev_hash: string; hash: string }>('SELECT * FROM evidence_log ORDER BY id').iterate();
  for (const { hash, ...fields } of rows) {
    if (fields.id !== entries + 1 || fields.prev_hash !== previous || hash !== sha256(canonical(fields))) {
      return { valid: false, entries, head: previous };
    }
    entries += 1;
    previous = hash;
  }
  return { valid: true, entries, head: previous };
}

