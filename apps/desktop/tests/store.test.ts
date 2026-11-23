import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card, CaseRecord, Person, Profile } from '@courtplus/contracts';
import { type AuditEntry, verifyAuditChain } from '../src/audit';
import { clearProfile, readProfile, writeProfile } from '../src/handlers/settings';
import { openEncryptedDatabase, openStore } from '../src/store';

const testKeyStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plaintext: string) => Buffer.from(plaintext),
  decryptStringAsync: async (wrapped: Buffer) => ({
    result: wrapped.toString(),
    shouldReEncrypt: false,
  }),
};

const person: Person = {
  id: 'fictional-person',
  alias: 'Fictional test alias',
  prisonerType: 'undertrial',
  priorConviction: 'unknown',
  otherHolds: 'no',
  caseIds: [],
};

const record: CaseRecord = {
  id: 'fictional-case',
  personId: person.id,
  charges: [],
  custody: [{ kind: 'judicial', start: '2024-02-29' }],
  events: [],
  pendingStatus: 'trial',
};

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'courtplus-test-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

it('saves, loads and clears a fictional profile in encrypted settings', async () => {
  const profile: Profile = {
    fullName: 'Fictional Test Officer', role: 'judge', office: 'Fictional office', district: 'Raipur',
    designation: 'Test clerk', language: 'hi', employeeId: 'fictional-id', email: 'fictional@example.invalid',
  };
  const first = await openStore(directory, testKeyStorage);
  try {
    expect(readProfile(first)).toBeNull();
    writeProfile(first, profile);
  } finally { first.close(); }
  const reopened = await openStore(directory, testKeyStorage);
  try {
    expect(readProfile(reopened)).toEqual(profile);
    expect(reopened.role()).toBe('legal_aid');
    clearProfile(reopened);
    expect(readProfile(reopened)).toBeNull();
    expect(reopened.auditEntries().map(entry => entry.action)).toEqual(['profile.save', 'profile.clear']);
  } finally { reopened.close(); }
});

it('keeps first-save and closure dates across edits in the local dashboard activity', async () => {
  const store = await openStore(directory, testKeyStorage);
  const card: Card = {
    id: 'fictional-card', caseId: record.id, personId: person.id, title: 'Fictional card',
    lane: 'LAWYER_REVIEW', state: 'holds_checked', tags: [],
  };
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T19:00:00Z'));
    store.saveCase(person, record);
    vi.setSystemTime(new Date('2026-11-09T19:00:00Z'));
    const closed = store.updateCard(card, { state: 'closed' });
    vi.setSystemTime(new Date('2026-11-16T19:00:00Z'));
    store.saveCase(person, { ...record, pendingStatus: 'appeal' });
    store.updateCard(closed, { owner: 'Fictional staff' });
    expect(store.dashboardActivity()).toEqual({
      savedCases: [{ caseId: record.id, on: '2026-11-02' }],
      closedCards: [{ cardId: card.id, caseId: record.id, on: '2026-11-10' }],
    });
  } finally {
    vi.useRealTimers();
    store.close();
  }
});

it('reopens persisted cases, derives membership, and appends one audit entry per save', async () => {
  const store = await openStore(directory, testKeyStorage);
  try {
    expect(store.role()).toBe('legal_aid');
    store.saveCase(person, record);
    store.saveCase(person, { ...record, pendingStatus: 'appeal' });
  } finally {
    store.close();
  }
  const reopened = await openStore(directory, testKeyStorage);
  try {
    expect(reopened.listPersons()).toEqual([{ ...person, caseIds: [record.id] }]);
    expect(reopened.listCases()).toEqual([{ ...record, pendingStatus: 'appeal' }]);
  } finally {
    reopened.close();
  }
  const db = await openEncryptedDatabase(directory, testKeyStorage);
  try {
    const entries = db.prepare<[], AuditEntry>('SELECT * FROM audit_log ORDER BY id').all();
    expect(entries).toHaveLength(2);
    expect(verifyAuditChain(entries)).toBe(true);
    expect(() => db.prepare("UPDATE audit_log SET action = 'edited'").run()).toThrow('append-only');
  } finally {
    db.close();
  }
});

it('keeps SQLite temporary files in memory so no plaintext spills to disk', async () => {
  const db = await openEncryptedDatabase(directory, testKeyStorage);
  try {
    expect(db.pragma('temp_store', { simple: true })).toBe(2);
  } finally {
    db.close();
  }
});

it('rolls back a save when its audit entry cannot be written', async () => {
  const db = await openEncryptedDatabase(directory, testKeyStorage);
  try {
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'test'); END");
  } finally {
    db.close();
  }
  const store = await openStore(directory, testKeyStorage);
  try {
    expect(() => store.saveCase(person, record)).toThrow('test');
    expect(store.listPersons()).toEqual([]);
    expect(store.listCases()).toEqual([]);
  } finally {
    store.close();
  }
});
