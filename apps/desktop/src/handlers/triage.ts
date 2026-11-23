import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { AdjournmentDecision, CaseMeta, CaseRecord, CauseList, CourtSettings, CourtWorkspace, CourtWorkspaceApi, Hearing,
  Person, PriorityOverride, ScreeningResult } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { appendAudit } from '../audit';
import { indiaDate } from './board';

export const courtMigration = `
  CREATE TABLE court_case_meta (
    case_id TEXT PRIMARY KEY REFERENCES cases(id), data TEXT NOT NULL CHECK (json_valid(data))
  ) STRICT;
  CREATE TABLE court_hearings (
    id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), date TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data)), source TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(decision)),
    UNIQUE (case_id, date, data, decision)
  ) STRICT;
  CREATE TABLE court_overrides (
    id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
    data TEXT NOT NULL CHECK (json_valid(data))
  ) STRICT;
  CREATE INDEX court_overrides_by_case ON court_overrides(case_id, id);
  CREATE TABLE court_cause_lists (
    date TEXT PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))
  ) STRICT;
  CREATE TABLE court_bookings (
    case_id TEXT PRIMARY KEY REFERENCES cases(id), next_on TEXT NOT NULL, decided_on TEXT NOT NULL
  ) STRICT;
`;

const date = z.iso.date();
const id = z.string().min(1).max(128);
const brief = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(2_000);
const days = z.number().int().min(0).max(3650);
const capacity = z.number().int().min(1).max(1000);
const flags = z.enum(['seniorCitizen', 'woman', 'child', 'disability', 'undertrial']);
const hearingSchema = z.strictObject({
  caseId: id, date, purpose: brief, outcome: z.enum(['heard', 'adjourned', 'disposed']),
  adjournedBy: brief.optional(), reasonText: reason.optional(), requestedDays: days.optional(), grantedDays: days.optional(),
}).refine(h => h.outcome === 'adjourned' || [h.adjournedBy, h.reasonText, h.requestedDays, h.grantedDays]
  .every(value => value === undefined), 'Enter adjournment details only for an adjourned hearing.');
const requestSchema = z.strictObject({
  caseId: id, party: brief, date, requestedDays: days, procedure: z.enum(['cpc', 'bnss', 'other']),
});
export const courtArguments: z.ZodType<Parameters<CourtWorkspaceApi['courtWorkspace']>> = z.tuple([date, z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('read') }),
  z.strictObject({ kind: z.literal('meta'), meta: z.strictObject({
    caseId: id, caseType: z.enum(['criminal', 'civil', 'family', 'MACT', 'cheque', 'other']),
    filedOn: date, stage: brief, partiesInCustody: z.boolean(), partyFlags: z.array(flags).max(5),
    nationalSecurity: z.boolean(), disposedOn: date.optional(),
  }) }),
  z.strictObject({ kind: z.literal('hearing'), hearing: hearingSchema, fromOrder: z.boolean() }),
  z.strictObject({ kind: z.literal('settings'), settings: z.strictObject({
    capacity, oldestShare: z.number().int().min(0).max(100), minimumPreparationDays: days,
  }) }),
  z.strictObject({ kind: z.literal('override'), override: z.strictObject({
    caseId: id, direction: z.enum(['up', 'down', 'clear']), reason,
  }) }),
  z.strictObject({ kind: z.literal('confirmCauseList'), capacity, entries: z.array(z.strictObject({
    caseId: id, basis: z.enum(['adjournment', 'oldest', 'priority']), score: z.number().int().min(0).max(100).optional(),
  })).max(2000) }),
  z.strictObject({ kind: z.literal('pdf') }),
  z.strictObject({ kind: z.literal('advice'), request: requestSchema }),
  z.strictObject({ kind: z.literal('decision'), decision: requestSchema.extend({ nextOn: date, purpose: brief, reason }) }),
])]);

export function courtStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS court_screenings (
    id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), as_of TEXT NOT NULL,
    facts_hash TEXT NOT NULL, result TEXT NOT NULL CHECK (json_valid(result)),
    UNIQUE (case_id, as_of, facts_hash)
  ) STRICT`);
  function rows<T>(table: string, order: string): T[] {
    return db.prepare<[], { data: string }>(`SELECT data FROM ${table} ORDER BY ${order}`)
      .all().map(row => JSON.parse(row.data) as T);
  }
  const writeCaseMeta = db.prepare('INSERT OR REPLACE INTO court_case_meta VALUES (?, ?)');
  const writeOverride = db.prepare('INSERT INTO court_overrides (case_id, data) VALUES (?, ?)');
  const currentOverrides = db.prepare<[], { data: string }>(`
    SELECT data FROM court_overrides WHERE id IN (SELECT max(id) FROM court_overrides GROUP BY case_id)
  `);
  const writeList = db.prepare('INSERT OR REPLACE INTO court_cause_lists VALUES (?, ?)');
  const upcomingLists = db.prepare<[string], { data: string }>('SELECT data FROM court_cause_lists WHERE date >= ? ORDER BY date');
  const writeHearing = db.prepare('INSERT OR IGNORE INTO court_hearings (case_id, date, data, source, decision) VALUES (?, ?, ?, ?, ?)');
  const writeBooking = db.prepare(`
    INSERT INTO court_bookings VALUES (?, ?, ?) ON CONFLICT (case_id) DO UPDATE
    SET next_on = excluded.next_on, decided_on = excluded.decided_on
    WHERE excluded.decided_on >= court_bookings.decided_on
  `);
  const readBookings = db.prepare<[], { case_id: string; next_on: string; decided_on: string }>(
    'SELECT * FROM court_bookings ORDER BY case_id',
  );
  const writeSettings = db.prepare("INSERT OR REPLACE INTO settings VALUES ('judgeCourtSettings', ?)");
  const readSettings = db.prepare<[], { value: string }>("SELECT value FROM settings WHERE key = 'judgeCourtSettings'");
  const readScreening = db.prepare<[string, string, string], { result: string }>(
    'SELECT result FROM court_screenings WHERE case_id = ? AND as_of = ? AND facts_hash = ? ORDER BY id DESC LIMIT 1',
  );
  const writeScreening = db.prepare<[string, string, string, string]>(
    'INSERT OR IGNORE INTO court_screenings (case_id, as_of, facts_hash, result) VALUES (?, ?, ?, ?)',
  );
  const audit = (action: string, payload: unknown) => appendAudit(db, 'judge', 'court.' + action, payload);
  const addHearing = (hearing: Hearing, source: string, decision: unknown = {}) =>
    writeHearing.run(hearing.caseId, hearing.date, JSON.stringify(hearing), source, JSON.stringify(decision)).changes > 0;
  return {
    screening: (caseId: string, asOf: string, factsHash: string) => {
      const row = readScreening.get(caseId, asOf, factsHash);
      return row ? JSON.parse(row.result) as ScreeningResult : undefined;
    },
    saveScreening: (result: ScreeningResult, factsHash: string) =>
      writeScreening.run(result.caseId, result.asOf, factsHash, JSON.stringify(result)),
    meta: () => rows<CaseMeta>('court_case_meta', 'case_id'),
    hearings: () => rows<Hearing>('court_hearings', 'date, id'),
    overrides: () => currentOverrides.all().map(row => JSON.parse(row.data) as PriorityOverride),
    lists: () => rows<CauseList>('court_cause_lists', 'date'),
    bookings: () => readBookings.all(),
    settings: () => JSON.parse(readSettings.get()?.value ?? 'null') as CourtSettings | null,
    saveMeta: db.transaction((meta: CaseMeta) => {
      writeCaseMeta.run(meta.caseId, JSON.stringify(meta));
      audit('caseMeta', meta);
    }).immediate,
    saveHearing: db.transaction((hearing: Hearing, fromOrder: boolean) => {
      const source = fromOrder ? 'confirmed order' : 'manual';
      if (addHearing(hearing, source)) audit('hearing', { hearing, source });
    }).immediate,
    saveOverride: db.transaction((override: PriorityOverride) => {
      writeOverride.run(override.caseId, JSON.stringify(override));
      audit('priorityOverride', override);
    }).immediate,
    saveSettings: db.transaction((settings: CourtSettings) => {
      writeSettings.run(JSON.stringify(settings));
      audit('settings', settings);
    }).immediate,
    saveList: db.transaction((list: CauseList) => {
      const confirmed = { ...list, confirmed: true };
      writeList.run(list.date, JSON.stringify(confirmed));
      audit('confirmCauseList', confirmed);
    }).immediate,
    saveDecision: db.transaction((hearing: Hearing, decision: AdjournmentDecision, today: string) => {
      if (!addHearing(hearing, 'judge decision', decision)) return;
      if (writeBooking.run(decision.caseId, decision.nextOn, decision.date).changes) {
        for (const row of upcomingLists.all(today)) {
          const list = JSON.parse(row.data) as CauseList;
          if (list.date <= decision.date) continue;
          const index = list.entries.findIndex(item => item.caseId === decision.caseId);
          if (list.date === decision.nextOn) {
            const booked = { caseId: decision.caseId, basis: 'adjournment' as const };
            if (index === -1) list.entries.push(booked);
            else list.entries[index] = booked;
            writeList.run(list.date, JSON.stringify(list));
          } else if (index !== -1) {
            list.entries.splice(index, 1);
            writeList.run(list.date, JSON.stringify(list));
          }
        }
      }
      audit('adjournmentDecision', decision);
    }).immediate,
  };
}

const civilDay = (value: string) => Date.parse(value + 'T00:00:00Z') / 86_400_000;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function confirmedOrderDates(record: CaseRecord): string[] {
  const orderDates = new Set(record.events
    .filter(e => e.kind === 'hearing' && e.source?.verifiedBy)
    .map(e => e.on));
  if (record.orderDate) orderDates.add(record.orderDate);
  return [...orderDates];
}

function hasConfirmedFacts(record: CaseRecord): boolean {
  const facts = [...record.charges, ...record.custody, ...record.events];
  return facts.length > 0 && facts.every(fact => fact.source?.verifiedBy?.trim())
    && record.charges.every(charge => charge.verified);
}

function describeCases(records: CaseRecord[]): CourtWorkspace['cases'] {
  const datesByCnr = new Map<string, Set<string>>();
  const cnr = (record: CaseRecord) => record.cnr?.trim().toUpperCase();
  for (const record of records) {
    const key = cnr(record);
    if (!key) continue;
    const dates = datesByCnr.get(key) ?? new Set<string>();
    for (const date of confirmedOrderDates(record)) dates.add(date);
    datesByCnr.set(key, dates);
  }
  return records.map(record => ({
    id: record.id, label: record.caseNo || record.cnr || record.id,
    orderDates: [...(datesByCnr.get(cnr(record) ?? '') ?? confirmedOrderDates(record))].sort(),
    disposed: record.pendingStatus === 'disposed', adjournments: [],
  }));
}

export function createCourtHandler(store: { court: ReturnType<typeof courtStore>; listCases(): CaseRecord[]; listPersons(): Person[] },
  engine: typeof import('@courtplus/engine', { with: { 'resolution-mode': 'import' } }),
  ports: { savePath(name: string): Promise<string | undefined>; print(html: string): Promise<Uint8Array> },
  isJudge: () => boolean,
): CourtWorkspaceApi['courtWorkspace'] {
  const { court } = store;
  const workspaceHandler: CourtWorkspaceApi['courtWorkspace'] = async (date, action) => {
    if (!isJudge()) throw new Error('Select the Judge role in your desktop profile.');
    const today = indiaDate();
    const savedCases = store.listCases();
    const cases = describeCases(savedCases);
    const byId = new Map(cases.map(item => [item.id, item]));
    const requireCase = (caseId: string) => {
      const record = byId.get(caseId);
      if (!record) throw new Error('Choose a case saved on this computer.');
      return record;
    };
    const requireDate = (on: string, maximum: string, message: string) => {
      if (on > maximum) throw new Error(message);
    };
    switch (action.kind) {
      case 'meta': {
        requireCase(action.meta.caseId);
        const { filedOn, disposedOn } = action.meta;
        requireDate(filedOn, today, 'The filing date must be today or earlier.');
        if (disposedOn && (disposedOn < filedOn || disposedOn > today)) throw new Error('Enter a disposal date between filing and today.');
        const dates = court.hearings().filter(h => h.caseId === action.meta.caseId);
        if (dates.some(h => h.date < filedOn)) throw new Error('The filing date is later than a recorded hearing.');
        court.saveMeta(action.meta);
        break;
      }
      case 'hearing': {
        const { hearing, fromOrder } = action;
        const record = requireCase(hearing.caseId);
        requireDate(hearing.date, today, 'The hearing date must be today or earlier.');
        if (fromOrder && !record.orderDates.includes(hearing.date)) throw new Error('Select a date from a saved order.');
        const meta = court.meta().find(item => item.caseId === hearing.caseId);
        if (meta && hearing.date < meta.filedOn) throw new Error('The hearing is earlier than the filing date.');
        court.saveHearing(hearing, fromOrder);
        break;
      }
      case 'override':
        requireCase(action.override.caseId);
        court.saveOverride(action.override);
        break;
      case 'settings':
        court.saveSettings(action.settings);
        break;
    }
    const hearings = court.hearings();
    const disposedFromHearing = new Map(hearings.filter(h => h.outcome === 'disposed').map(h => [h.caseId, h.date]));
    const metadata = court.meta().map(meta =>
      ({ ...meta, disposedOn: meta.disposedOn ?? disposedFromHearing.get(meta.caseId) }));
    const metaById = new Map(metadata.map(meta => [meta.caseId, meta]));
    const closed = new Set(cases.filter(item => item.disposed || metaById.get(item.id)?.disposedOn ||
      disposedFromHearing.has(item.id)).map(item => item.id));
    const byCase = new Map<string, Hearing[]>();
    for (const hearing of hearings) {
      const group = byCase.get(hearing.caseId);
      if (group) group.push(hearing);
      else byCase.set(hearing.caseId, [hearing]);
    }
    for (const item of cases) {
      item.disposed = closed.has(item.id);
      item.adjournments = engine.adjournmentHistory(byCase.get(item.id) ?? [], item.id, today);
    }
    const settings = court.settings() ?? engine.defaultCourtSettings;
    const people = new Map(store.listPersons().map(person => [person.id, person]));
    const confirmedCases = savedCases.filter(hasConfirmedFacts);
    const confirmedIds = new Set(confirmedCases.map(record => record.id));
    const statutory = new Map<string, { status: ScreeningResult['status']; asOf: string;
      dueInDays?: number; ceilingUrgent?: boolean }>();
    for (const record of savedCases) {
      if (closed.has(record.id) || !confirmedIds.has(record.id) || !metaById.has(record.id)) continue;
      const person = people.get(record.personId);
      if (!person) continue;
      const personCases = confirmedCases.filter(item => item.personId === person.id);
      const factsHash = createHash('sha256').update(JSON.stringify({ ruleVersion: engine.RULE_VERSION,
        person, personCases })).digest('hex');
      let result = court.screening(record.id, today, factsHash);
      if (!result) {
        result = engine.screen(person, confirmedCases, record.id, today);
        court.saveScreening(result, factsHash);
      }
      statutory.set(record.id, { status: result.status, asOf: result.asOf,
        dueInDays: result.dueInDays, ceilingUrgent: result.ceilingUrgent });
    }
    const ranked = engine.rankCases(metadata.filter(meta => !closed.has(meta.caseId)), hearings, court.overrides(), today, statutory);

    if (action.kind === 'decision') {
      const decision = action.decision;
      requireCase(decision.caseId);
      requireDate(decision.date, today, 'The request date must be today or earlier.');
      const filed = metaById.get(decision.caseId)?.filedOn;
      if (closed.has(decision.caseId) || (filed && decision.date < filed)) throw new Error('Choose a request date for a pending case.');
      if (decision.nextOn <= decision.date || decision.nextOn < today) throw new Error('Choose a future listing date after the request.');
      if (court.bookings().some(item => item.case_id === decision.caseId && item.decided_on > decision.date)) {
        throw new Error('A later decision already exists. Record earlier adjournments in the hearing history.');
      }
      const hearing: Hearing = { caseId: decision.caseId, date: decision.date, purpose: decision.purpose,
        outcome: 'adjourned', adjournedBy: decision.party, reasonText: decision.reason,
        requestedDays: decision.requestedDays, grantedDays: civilDay(decision.nextOn) - civilDay(decision.date) };
      court.saveDecision(hearing, decision, today);
      return workspaceHandler(date, { kind: 'read' });
    }

    const activeBookings = new Map(court.bookings().filter(item => item.next_on >= today && !closed.has(item.case_id))
      .map(item => [item.case_id, item.next_on]));
    let lists = court.lists().map(list => list.date < today ? list :
      { ...list, entries: list.entries.filter(item => !closed.has(item.caseId)) });
    let causeList = lists.find(list => list.date === date);
    const suggested = () => engine.suggestCauseList(date, ranked, settings, activeBookings);
    if (action.kind === 'confirmCauseList') {
      if (date < today) throw new Error('Choose today or a future date.');
      if (causeList) throw new Error('This cause list is already confirmed.');
      const plan = suggested();
      if (plan.capacity !== action.capacity || plan.entries.length !== action.entries.length ||
        plan.entries.some(({ caseId, basis, score }, i) => caseId !== action.entries[i].caseId ||
          basis !== action.entries[i].basis || score !== action.entries[i].score)) {
        throw new Error('The suggestion changed. Reload and review the current list before confirming.');
      }
      court.saveList(plan);
      causeList = { ...plan, confirmed: true };
      lists = [...lists, causeList];
    }
    causeList ??= suggested();
    const dispositions = [...disposedFromHearing].filter(([caseId]) => !metaById.has(caseId))
      .map(([caseId, disposedOn]) => ({ caseId, disposedOn }));
    const workspace: CourtWorkspace = { settings, cases, metadata, hearings, ranked, causeList,
      backlog: engine.courtBacklog([...metadata, ...dispositions], today, closed) };
    if (action.kind === 'advice') {
      const { request } = action;
      requireCase(request.caseId);
      requireDate(request.date, today, 'The request date must be today or earlier.');
      const workload = lists.filter(list => list.date >= today).map(list => ({ date: list.date,
        available: Math.max(0, list.capacity - list.entries.filter(item => item.caseId !== request.caseId).length) }));
      workspace.advice = engine.adviseAdjournment(request, hearings, settings.minimumPreparationDays, workload);
    }
    if (action.kind === 'pdf') {
      if (!causeList.confirmed) throw new Error('Confirm the cause list before exporting.');
      const path = await ports.savePath(`cause-list-${date}.pdf`);
      if (path) {
        const rows = causeList.entries.map(entry => `<tr><td>${escapeHtml(byId.get(entry.caseId)?.label ?? entry.caseId)}</td>
          <td>${entry.basis}</td><td>${entry.score ?? ''}</td></tr>`).join('');
        const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cause list</title>
          <style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}
          th,td{padding:8px;text-align:left;border-bottom:1px solid #aaa}tr{break-inside:avoid}</style>
          <h1>Cause list for ${date}</h1><p>Confirmed local list. ${causeList.entries.length} matters · Capacity ${causeList.capacity}.</p>
          <table><thead><tr><th>Case</th><th>Listing basis</th><th>Priority hint</th></tr></thead><tbody>${rows}</tbody></table></html>`;
        await writeFile(path, await ports.print(html));
        workspace.exported = basename(path);
      }
    }
    return workspace;
  };
  return workspaceHandler;
}
