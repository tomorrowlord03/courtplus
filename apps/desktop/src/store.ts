import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CaseRecord, CourtPlusApi, DashboardActivity, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import Database from 'better-sqlite3-multiple-ciphers';
import { appendAudit, type AuditEntry } from './audit';
import { roleSchema } from './validation';
import type { CardPatch } from './handlers/board';
import { courtMigration, courtStore } from './handlers/triage';

const databaseFile = 'courtplus.sqlite3';
const keyFile = 'database.key.dpapi';

const migrations = [`
  CREATE TABLE persons (
    id TEXT PRIMARY KEY NOT NULL,
    profile_json TEXT NOT NULL CHECK (json_valid(profile_json))
  ) STRICT;
  CREATE TABLE cases (
    id TEXT PRIMARY KEY NOT NULL,
    person_id TEXT NOT NULL REFERENCES persons(id),
    details_json TEXT NOT NULL CHECK (json_valid(details_json)),
    charges_json TEXT NOT NULL CHECK (json_valid(charges_json)),
    custody_json TEXT NOT NULL CHECK (json_valid(custody_json)),
    events_json TEXT NOT NULL CHECK (json_valid(events_json))
  ) STRICT;
  CREATE INDEX cases_by_person ON cases(person_id, id);
  CREATE TABLE documents (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT REFERENCES cases(id),
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')
  ) STRICT;
  CREATE TABLE cards (
    id TEXT PRIMARY KEY NOT NULL,
    person_id TEXT NOT NULL REFERENCES persons(id),
    case_id TEXT NOT NULL REFERENCES cases(id),
    card_json TEXT NOT NULL CHECK (json_valid(card_json))
  ) STRICT;
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
  INSERT INTO settings (key, value) VALUES ('role', 'legal_aid');
`, `
  ALTER TABLE cases ADD COLUMN saved_at TEXT;
  ALTER TABLE cards ADD COLUMN closed_at TEXT;
`, courtMigration];

type KeyStorage = Pick<typeof import('electron').safeStorage,
  'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync'>;

async function writeWrappedKey(path: string, key: string, storage: KeyStorage): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, await storage.encryptStringAsync(key), {
      flag: 'wx', mode: 0o600, flush: true,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function openEncryptedDatabase(
  directory: string, keyStorage: KeyStorage,
): Promise<Database.Database> {
  const path = join(directory, databaseFile);
  const keyPath = join(directory, keyFile);
  if (!await keyStorage.isAsyncEncryptionAvailable()) throw new Error('OS key encryption is unavailable');

  if (!existsSync(keyPath)) {
    if (existsSync(path)) throw new Error('The encrypted database key is missing');
    await writeWrappedKey(keyPath, randomBytes(32).toString('hex'), keyStorage);
  }
  const { result: key, shouldReEncrypt } = await keyStorage.decryptStringAsync(readFileSync(keyPath));
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('The encrypted database key is invalid');
  if (shouldReEncrypt) await writeWrappedKey(keyPath, key, keyStorage);

  const db = new Database(path);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.pragma(`key = "x'${key}'"`);
    // SQLite spill files (large sorts, temp indexes) are not covered by the page cipher.
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = ON');
    db.pragma('recursive_triggers = ON');
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number;
      if (version > migrations.length) throw new Error('The database requires a newer CourtPlus version');
      for (let index = version; index < migrations.length; index += 1) {
        db.exec(migrations[index]);
        db.pragma(`user_version = ${index + 1}`);
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

type Role = Awaited<ReturnType<CourtPlusApi['role']>>;
const civilDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

export async function openStore(directory: string, keyStorage: KeyStorage) {
  const db = await openEncryptedDatabase(directory, keyStorage);
  const persons = db.prepare<[], { id: string; profile_json: string; case_ids: string }>(`
    SELECT persons.*, (
      SELECT json_group_array(id ORDER BY id) FROM cases WHERE cases.person_id = persons.id
    ) AS case_ids
    FROM persons ORDER BY id
  `);
  const cases = db.prepare<[], {
    id: string; person_id: string; details_json: string;
    charges_json: string; custody_json: string; events_json: string;
  }>('SELECT * FROM cases ORDER BY id');
  const readRole = db.prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'role'");
  const role = (): Role => roleSchema.parse(readRole.get()?.value);
  const writePerson = db.prepare(`
    INSERT INTO persons (id, profile_json) VALUES (?, ?)
    ON CONFLICT (id) DO UPDATE SET profile_json = excluded.profile_json
  `);
  const writeCase = db.prepare(`
    INSERT INTO cases (id, person_id, details_json, charges_json, custody_json, events_json, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET person_id = excluded.person_id, details_json = excluded.details_json,
      charges_json = excluded.charges_json, custody_json = excluded.custody_json,
      events_json = excluded.events_json
  `);
  const save = db.transaction((person: Person, record: CaseRecord) => {
    const { id: personId, caseIds: _caseIds, ...profile } = person;
    const { id, personId: ownerId, charges, custody, events, ...details } = record;
    if (ownerId !== personId) throw new Error('Case must belong to the supplied person');
    writePerson.run(personId, JSON.stringify(profile));
    writeCase.run(id, ownerId, JSON.stringify(details), JSON.stringify(charges),
      JSON.stringify(custody), JSON.stringify(events), new Date().toISOString());
    appendAudit(db, role(), 'case.save', { person: { id: personId, ...profile }, case: record });
  });

  const setting = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const writeSetting = db.prepare<[string, string]>(
    'INSERT INTO settings VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const audit = (action: string, payload: unknown) => appendAudit(db, role(), action, payload);
  const writeSettings = db.transaction((
    changes: Record<string, string>, action: string, payload: unknown,
  ) => {
    const changed = Object.entries(changes).filter(([key, value]) => setting.get(key)?.value !== value);
    if (!changed.length) return;
    for (const [key, value] of changed) writeSetting.run(key, value);
    audit(action, payload ?? Object.fromEntries(changed));
  });
  const deleteSetting = db.prepare<[string]>('DELETE FROM settings WHERE key = ?');
  const clearSetting = db.transaction((key: string, action: string) => {
    if (deleteSetting.run(key).changes) audit(action, {});
  });
  const readCards = db.prepare<[], { id: string; card_json: string }>('SELECT id, card_json FROM cards');
  const readCard = db.prepare<[string], { card_json: string; closed_at: string | null }>(
    'SELECT card_json, closed_at FROM cards WHERE id = ?',
  );
  const writeCard = db.prepare(
    'INSERT INTO cards (id, person_id, case_id, card_json, closed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET ' +
      'person_id = excluded.person_id, case_id = excluded.case_id, card_json = excluded.card_json, closed_at = excluded.closed_at',
  );
  const updateCard = db.transaction((card: Card, patch: CardPatch) => {
    const previous = readCard.get(card.id);
    const prior = previous ? JSON.parse(previous.card_json) as CardPatch : {};
    if (Object.entries(patch).every(([key, value]) => card[key as keyof CardPatch] === value)) return card;
    const closedAt = patch.state === 'closed' && card.state !== 'closed'
      ? new Date().toISOString()
      : patch.state && patch.state !== 'closed' ? null : previous?.closed_at ?? null;
    writeCard.run(card.id, card.personId, card.caseId, JSON.stringify({ ...prior, ...patch }), closedAt);
    audit('card.update', { id: card.id, patch });
    return { ...card, ...patch };
  });
  const recordDocument = db.transaction((
    doc: { docId: string; pages: number; ocr: boolean }, suggestedFields: string[],
  ) => {
    const insert = db.prepare('INSERT OR IGNORE INTO documents VALUES (?, NULL, ?, ?)');
    if (insert.run(doc.docId, JSON.stringify({ pages: doc.pages, ocr: doc.ocr, suggestedFields }), doc.docId).changes) {
      audit('order.import', { docId: doc.docId, pages: doc.pages, ocr: doc.ocr });
    }
  });
  const document = db.prepare<[string], { metadata_json: string }>('SELECT metadata_json FROM documents WHERE id = ?');
  const auditEntries = db.prepare<[], AuditEntry>('SELECT * FROM audit_log ORDER BY id');
  const savedCases = db.prepare<[], { caseId: string; saved_at: string }>(
    'SELECT id AS caseId, saved_at FROM cases WHERE saved_at IS NOT NULL',
  );
  const closedCards = db.prepare<[], { cardId: string; caseId: string; closed_at: string | null }>(
    "SELECT id AS cardId, case_id AS caseId, closed_at FROM cards WHERE json_extract(card_json, '$.state') = 'closed'",
  );

  return {
    court: courtStore(db),
    readSetting: (key: string): string | undefined => setting.get(key)?.value,
    writeSettings: (changes: Record<string, string>, action = 'settings.update', payload?: unknown) =>
      writeSettings.immediate(changes, action, payload),
    clearSetting: clearSetting.immediate,
    dashboardActivity: (): DashboardActivity => ({
      savedCases: savedCases.all().map(({ caseId, saved_at }) => ({ caseId, on: civilDate.format(new Date(saved_at)) })),
      closedCards: closedCards.all().map(({ cardId, caseId, closed_at }) => ({
        cardId, caseId, on: closed_at ? civilDate.format(new Date(closed_at)) : undefined,
      })),
    }),
    readCards: () => new Map(readCards.all().map(row => [row.id, JSON.parse(row.card_json) as CardPatch])),
    updateCard: updateCard.immediate,
    recordDocument: recordDocument.immediate,
    document: (id: string): { suggestedFields: string[] } | undefined => {
      const row = document.get(id);
      return row ? JSON.parse(row.metadata_json) as { suggestedFields: string[] } : undefined;
    },
    audit,
    auditEntries: (): AuditEntry[] => auditEntries.all(),
    listPersons: (): Person[] => persons.all().map(row => ({
      ...JSON.parse(row.profile_json) as Omit<Person, 'id' | 'caseIds'>,
      id: row.id,
      caseIds: JSON.parse(row.case_ids) as string[],
    })),
    listCases: (): CaseRecord[] => cases.all().map(row => ({
      ...JSON.parse(row.details_json) as Omit<CaseRecord, 'id' | 'personId' | 'charges' | 'custody' | 'events'>,
      id: row.id,
      personId: row.person_id,
      charges: JSON.parse(row.charges_json) as CaseRecord['charges'],
      custody: JSON.parse(row.custody_json) as CaseRecord['custody'],
      events: JSON.parse(row.events_json) as CaseRecord['events'],
    })),
    saveCase: (person: Person, record: CaseRecord): void => save.immediate(person, record),
    role,
    close: (): void => { db.close(); },
  };
}

export type Store = Awaited<ReturnType<typeof openStore>>;
