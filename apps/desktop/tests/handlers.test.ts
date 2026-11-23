import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CaseRecord, Person } from '@courtplus/contracts';
import * as engine from '@courtplus/engine';
import { describe, expect, it } from 'vitest';
import { buildBoard } from '../src/handlers/board';
import { cloudCase } from '../src/handlers/cloud-data';
import { loadFigures } from '../src/handlers/documents';
import { createHandlers } from '../src/handlers';
import { appendAudit, verifyAuditChain } from '../src/audit';
import { openEncryptedDatabase, openStore, type Store } from '../src/store';

const asOf = '2026-11-23';
const person = (id: string, prisonerType: Person['prisonerType'] = 'undertrial'): Person => ({
  id, alias: 'Fictional ' + id, caseIds: [], priorConviction: 'unknown', otherHolds: 'unknown', prisonerType,
});
const record = (owner: Person, on: string): CaseRecord => ({
  id: 'case-' + owner.id, personId: owner.id, charges: [],
  custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }],
  events: [{ kind: 'hearing', on }], pendingStatus: 'trial',
});
const keyStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plaintext: string) => Buffer.from(plaintext),
  decryptStringAsync: async (wrapped: Buffer) => ({ result: wrapped.toString(), shouldReEncrypt: false }),
};

describe('desktop CourtPlus API', () => {
  it('ranks the stale queue, applies cap and reports days to clear for the full queue', () => {
    const owners = [person('older'), person('newer'), person('appellant', 'convict_appellant')];
    const cases = owners.map((owner, index) => record(owner, '2025-01-0' + (index + 1)));
    const boards = buildBoard(engine, owners, cases, asOf, new Map(), 2);
    const stale = boards.visible.filter(card => card.lane === 'NO_UPDATE_180');
    expect(stale.map(card => card.personId)).toEqual(['appellant', 'older']);
    expect(stale[0].tags).toContain('3 remaining · 2 days to clear');
    expect(boards.all.filter(card => card.lane === 'NO_UPDATE_180')).toHaveLength(3);
    expect(boards.visible).toEqual(expect.arrayContaining([expect.objectContaining({ lane: 'LAWYER_REVIEW' })]));
    const advanced = buildBoard(engine, owners, cases, asOf, new Map([[stale[0].id, { state: 'closed' }]]), 1);
    expect(advanced.visible.find(card => card.lane === 'NO_UPDATE_180')?.personId).toBe('older');
  });

  it('loads both sourced data files and labels unverified rows', () => {
    const figures = loadFigures(resolve(import.meta.dirname, '../../../data/stats'));
    expect(figures.map(figure => figure.geography)).toEqual(expect.arrayContaining(['India', 'Chhattisgarh']));
    expect(figures.some(figure => !figure.verified && figure.label.endsWith('Unverified'))).toBe(true);
  });

  it('whitelists cloud facts, changes local identifiers and excludes protected cases', () => {
    const owner = person('fictional-private-person');
    const item = { ...record(owner, '2025-01-01'), cnr: 'fictional-private-cnr', court: 'fictional-private-court' };
    item.events[0].note = 'fictional-private-note';
    item.events[0].source = { docId: 'fictional-private-doc', quote: 'fictional-private-quote' };
    const payload = cloudCase(owner, item, 'test-only');
    expect(JSON.stringify(payload)).not.toContain('fictional-private');
    expect(payload?.[1].events[0].source?.docId).toMatch(/^[a-f0-9-]{36}$/);
    expect(cloudCase({ ...owner, juvenileClaim: 'yes' }, item, 'test-only')).toBeUndefined();
  });

  it('persists card workflow, writes a signed draft and verifies the selected files', async () => {
    await withHandlers(async ({ handlers, directory }) => {
      const owner = person('fixture');
      const item = record(owner, '2024-01-02');
      await handlers.saveCase(owner, item);
      const card = (await handlers.board(asOf)).find(card => card.lane === 'NO_UPDATE_180')!;
      expect((await handlers.updateCard(card.id, { state: 'assigned' })).state).toBe('assigned');
      expect((await handlers.board(asOf)).find(row => row.id === card.id)?.state).toBe('assigned');
      const paths = await handlers.exportDraft('RIGHTS_CARD', item.id, 'en');
      expect(paths.pdfPath.startsWith(directory)).toBe(true);
      const bundle = {
        pdf: await readFile(paths.pdfPath), receipt: await readFile(paths.receiptPath, 'utf8'),
        manifest: await readFile(paths.manifestPath, 'utf8'),
      };
      expect(await handlers.verify(bundle)).toEqual({ signature: 'valid', pdf: 'unchanged', chain: 'not_checked' });
      expect((await handlers.verify({ ...bundle, pdf: Buffer.from('changed') })).pdf).toBe('changed');
      await expect(handlers.exportScReturn(asOf, 'csv')).resolves.toMatch(/\.csv$/);
      await expect(handlers.stats()).resolves.toMatchObject({ peopleCount: 1, caseCount: 1 });
    });
  });

  it('refuses a s.479(3) application unless the engine says APPLY_NOW', async () => {
    await withHandlers(async ({ handlers, printed }) => {
      const review = person('review');
      const reviewCase = record(review, '2024-01-02');
      await handlers.saveCase(review, reviewCase);
      expect((await handlers.screen(reviewCase.id, asOf)).status).not.toBe('APPLY_NOW');
      await expect(handlers.exportDraft('S479_3_APPLICATION', reviewCase.id, 'en')).rejects.toThrow(/not APPLY_NOW/);
      expect(printed).toHaveLength(0);

      const eligible = { ...person('eligible'), priorConviction: 'no', otherHolds: 'no' } satisfies Person;
      await handlers.saveCase(eligible, eligibleCase(eligible));
      await expect(handlers.exportDraft('S479_3_APPLICATION', 'case-eligible', 'en')).resolves.toHaveProperty('pdfPath');
      expect(printed[0]).toContain('479(3)');
    });
  });

  it('exports offline with the local receipt QR when a backend is configured but not signed in', async () => {
    await withHandlers(async ({ handlers, db, printed }) => {
      db.writeSettings({ backendUrl: 'https://fictional-cloud.invalid' });
      const owner = person('offline');
      await handlers.saveCase(owner, record(owner, '2024-01-02'));
      await expect(handlers.exportDraft('RIGHTS_CARD', 'case-offline', 'en')).resolves.toHaveProperty('receiptPath');
      expect(printed[0]).toContain('data:image/png;base64,');
      expect(printed[0]).not.toContain('fictional-cloud.invalid');
    });
  });

  it('prints the audit head on the DLSA handoff sheet and detects a rewritten log', async () => {
    await withHandlers(async ({ handlers, anchor, db, directory, printed }) => {
      const owner = person('anchored');
      await handlers.saveCase(owner, record(owner, '2024-01-02'));
      const saved = await anchor.exportHandoff('en');
      expect(saved?.head).toMatch(/^[0-9a-f]{64}$/);
      expect(printed.at(-1)).toContain(saved!.head);
      // Later entries are expected; the printed anchor must still be inside the verified chain.
      await handlers.saveCase(owner, { ...record(owner, '2024-01-02'), pendingStatus: 'appeal' });
      expect(anchor.checkAnchor(saved!.head)).toMatchObject({ chain: 'intact' });
      expect(anchor.checkAnchor('f'.repeat(64))).toMatchObject({ chain: 'mismatch' });

      // An insider with the database key drops the trigger and rehashes history from entry 1.
      const raw = await openEncryptedDatabase(directory, keyStorage);
      try {
        raw.exec('DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete; DELETE FROM audit_log;');
        appendAudit(raw, 'legal_aid', 'case.save', { rewritten: true });
      } finally {
        raw.close();
      }
      expect(verifyAuditChain(db.auditEntries())).toBe(true);
      expect(anchor.checkAnchor(saved!.head)).toMatchObject({ chain: 'mismatch' });
    });
  });
});

function eligibleCase(owner: Person): CaseRecord {
  // Fictional IPC 323 case: 122 days of custody reaches one-third of the one-year maximum.
  const source = { docId: 'fictional-order', page: 1 };
  return {
    id: 'case-' + owner.id, personId: owner.id, orderDate: '2025-05-02', firstRemandOn: '2025-01-01',
    charges: [{ act: 'IPC', section: '323', stage: 'FIR', verified: true, source }],
    custody: [{ kind: 'judicial', start: '2025-01-01', ongoing: true }],
    events: [{ on: '2025-01-01', kind: 'remand', source }], pendingStatus: 'trial',
  };
}

async function withHandlers(run: (context: {
  handlers: Awaited<ReturnType<typeof createHandlers>>['handlers'];
  anchor: Awaited<ReturnType<typeof createHandlers>>['anchor'];
  db: Store; directory: string; printed: string[];
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-handler-test-'));
  const db = await openStore(directory, keyStorage);
  const printed: string[] = [];
  try {
    const { handlers, anchor } = await createHandlers(db, {
      boardChanged: () => undefined,
      resourceDirectory: resolve(import.meta.dirname, '../../..'),
      folder: async () => directory,
      print: async html => { printed.push(html); return Buffer.from('%PDF-1.7 fictional printer bytes'); },
      savePath: async name => join(directory, name),
    });
    await run({ handlers, anchor, db, directory, printed });
  } finally {
    db.close();
    await rm(directory, { force: true, recursive: true });
  }
}
