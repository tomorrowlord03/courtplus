import type { Card, CaseRecord, ISODate, Lane, Person } from '@courtplus/contracts';
import { explain, screen } from '@courtplus/engine';
import { audit, canonical, type Db } from './db.js';
import { HttpError, requireValue } from './http.js';
import type { Handoffs } from './handoff.js';
import { forbidden, type HandoffInput, type Role } from './inputs.js';

type Actor = { id: string; role: Role };
type CardPatch = Pick<Partial<Card>, 'state' | 'owner' | 'dueOn'>;
const laneTitle: Record<Lane, string> = {
  APPLY_NOW: 'Apply now', DUE_30: 'Due in 30 days', LAWYER_REVIEW: 'Lawyer review',
  BAIL_NOT_RELEASED: 'Bail granted, still in jail', COURT_JAIL_MISMATCH: 'Court and jail records disagree',
  NO_UPDATE_180: 'No court update for 180 days',
};
const handoffTitle = {
  release_order: 'Release order', bail_granted: 'Bail grant', acquitted: 'Acquittal',
};
const kolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export function indiaDate(now = Date.now()): ISODate {
  return kolkata.format(now);
}

function releaseFacts(record: CaseRecord | undefined): HandoffInput[] {
  if (!record) return [];
  const facts: HandoffInput[] = [];
  const { id: caseId } = record;
  if (record.bailGrantedOn) facts.push({ caseId, kind: 'bail_granted', orderOn: record.bailGrantedOn });
  if (record.releasedOn) facts.push({ caseId, kind: 'release_order', orderOn: record.releasedOn });
  for (const { on: orderOn, kind } of record.events) {
    if (kind === 'released') facts.push({ caseId, kind: 'release_order', orderOn });
    if (kind === 'acquitted' || kind === 'bail_granted') facts.push({ caseId, kind, orderOn });
  }
  return [...new Map(facts.map(fact => [fact.kind + ':' + fact.orderOn, fact])).values()]
    .sort((a, b) => a.orderOn.localeCompare(b.orderOn) || a.kind.localeCompare(b.kind));
}

export function createCases(db: Db, handoffs: Handoffs, now: () => number) {
  const allPeople = db.prepare<[], { data: string }>('SELECT data FROM persons ORDER BY id');
  const allCases = db.prepare<[], { data: string }>('SELECT data FROM cases ORDER BY id');
  const oneCase = db.prepare<[string], { data: string }>('SELECT data FROM cases WHERE id = ?');
  const storedCards = db.prepare<[], { id: string; data: string }>('SELECT id, data FROM card_patches');
  const filings = db.prepare<[], { case_id: string; filed_on: string }>('SELECT * FROM filings');
  const savePerson = db.prepare('INSERT INTO persons VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
  const saveCase = db.prepare('INSERT INTO cases VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
  const saveCard = db.prepare('INSERT INTO card_patches VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
  const saveFiling = db.prepare('INSERT INTO filings VALUES (?, ?) ON CONFLICT(case_id) DO UPDATE SET filed_on = excluded.filed_on');

  function listCases(): CaseRecord[] {
    return allCases.all().map(({ data }) => JSON.parse(data) as CaseRecord);
  }

  function listPersons(cases = listCases()): Person[] {
    const caseIds = new Map<string, string[]>();
    for (const record of cases) {
      const ids = caseIds.get(record.personId) ?? [];
      ids.push(record.id);
      caseIds.set(record.personId, ids);
    }
    return allPeople.all().map(({ data }) => {
      const person = JSON.parse(data) as Person;
      return { ...person, caseIds: [...new Set([...person.caseIds, ...(caseIds.get(person.id) ?? [])])].sort() };
    });
  }

  const save = db.transaction((person: Person, record: CaseRecord, actor: Actor) => {
    const previous = oneCase.get(record.id);
    const existing = previous ? JSON.parse(previous.data) as CaseRecord : undefined;
    if (existing && existing.personId !== person.id) throw new HttpError(409, 'CASE_OWNER_CONFLICT');
    const before = releaseFacts(existing);
    const after = releaseFacts(record);
    const reviewFacts = (item: CaseRecord | undefined) => ({
      releasedOn: item?.releasedOn ?? null, bailGrantedOn: item?.bailGrantedOn ?? null,
      events: item?.events.filter(event => ['released', 'acquitted', 'bail_granted'].includes(event.kind)) ?? [],
    });
    if (actor.role !== 'dlsa' && canonical(reviewFacts(existing)) !== canonical(reviewFacts(record))) forbidden();
    savePerson.run(person.id, JSON.stringify(person));
    saveCase.run(record.id, person.id, JSON.stringify(record));
    audit(db, actor.id, 'case.save', { person, record });
    const known = new Set(before.map(fact => fact.kind + ':' + fact.orderOn));
    for (const fact of after) if (!known.has(fact.kind + ':' + fact.orderOn)) handoffs.post(fact, actor.id);
  });

  function context(caseId: string) {
    const cases = listCases();
    const record = requireValue(cases.find(item => item.id === caseId), 'CASE_NOT_FOUND');
    const person = requireValue(listPersons(cases).find(item => item.id === record.personId));
    return { record, person, cases };
  }

  function screening(caseId: string, asOf: ISODate) {
    const { person, cases } = context(caseId);
    return screen(person, cases, caseId, asOf);
  }

  function board(asOf: ISODate): Card[] {
    const records = listCases();
    const people = new Map(listPersons(records).map(person => [person.id, person]));
    const patches = new Map(storedCards.all().map(row => [row.id, JSON.parse(row.data) as CardPatch]));
    const filed = new Map(filings.all().map(row => [row.case_id, row.filed_on]));
    const cards: Card[] = [];
    for (const record of records) {
      const person = requireValue(people.get(record.personId));
      const result = screen(person, records, record.id, asOf);
      for (const step of explain(result)) {
        if (!step.key.startsWith('lane.')) continue;
        const lane = step.key.slice(5) as Lane;
        const id = lane + ':' + record.id;
        const filedOn = filed.get(record.id);
        const tags = result.nalsaCategories.map(value => 'NALSA ' + value);
        if (result.antilCategory) tags.push('Antil ' + result.antilCategory);
        if (lane === 'APPLY_NOW' && filedOn && filedOn <= asOf) tags.push('s.479(3) filed ' + filedOn);
        cards.push({
          id, lane, personId: person.id, caseId: record.id, title: person.alias + ' · ' + laneTitle[lane],
          state: 'open', tags, ...(lane === 'DUE_30' && { dueOn: result.thresholdDate }), ...patches.get(id),
        });
      }
    }
    const byId = new Map(records.map(record => [record.id, record]));
    for (const handoff of handoffs.list()) {
      if (handoff.orderOn > asOf) continue;
      const record = requireValue(byId.get(handoff.caseId));
      const person = requireValue(people.get(record.personId));
      const tags = [handoffTitle[handoff.kind]];
      if (handoff.escalatedAt !== null && handoff.acknowledgedAt === null) tags.push('Overdue · escalated');
      const id = 'handoff:' + handoff.id;
      cards.push({
        id, lane: 'COURT_JAIL_MISMATCH', personId: person.id,
        caseId: record.id, title: person.alias + ' · ' + handoffTitle[handoff.kind], owner: 'superintendent',
        state: handoff.acknowledgedAt === null ? 'order_verified' : patches.get(id)?.state ?? 'jail_acknowledged',
        dueOn: indiaDate(handoff.dueAt), tags,
      });
    }
    return cards;
  }

  const update = db.transaction((id: string, patch: CardPatch, actor: Actor): Card => {
    const today = indiaDate(now());
    const current = requireValue(board(today).find(card => card.id === id), 'CARD_NOT_FOUND');
    if (id.startsWith('handoff:')) {
      if (actor.role !== 'superintendent') forbidden();
      const next = { order_verified: 'jail_acknowledged', jail_acknowledged: 'holds_checked', holds_checked: 'closed' } as const;
      const state = patch.state;
      if (!state || Object.keys(patch).length !== 1) throw new HttpError(400, 'INVALID_HANDOFF_STEP');
      if (state === current.state) return current;
      if (!(current.state in next) || state !== next[current.state as keyof typeof next]) {
        throw new HttpError(409, 'INVALID_HANDOFF_STEP');
      }
      if (state === 'jail_acknowledged') {
        handoffs.ack(id.slice('handoff:'.length), actor.id);
        return requireValue(board(today).find(card => card.id === id));
      }
      saveCard.run(id, JSON.stringify({ state }));
      audit(db, actor.id, 'card.update', { id, patch });
      return { ...current, state };
    }
    if (patch.state === 'jail_acknowledged' && actor.role !== 'superintendent') forbidden();
    const previous = storedCards.all().find(row => row.id === id);
    const stored: CardPatch = previous ? JSON.parse(previous.data) as CardPatch : {};
    saveCard.run(id, JSON.stringify({ ...stored, ...patch }));
    audit(db, actor.id, 'card.update', { id, patch });
    return { ...current, ...patch };
  });

  const file = db.transaction((caseId: string, filedOn: ISODate, actor: Actor) => {
    if (!oneCase.get(caseId)) throw new HttpError(404, 'CASE_NOT_FOUND');
    if (filedOn > indiaDate(now())) throw new HttpError(400, 'FILING_DATE_IN_FUTURE');
    if (filings.all().some(row => row.case_id === caseId && row.filed_on === filedOn)) return;
    saveFiling.run(caseId, filedOn);
    audit(db, actor.id, 'application.file', { caseId, filedOn });
  });

  return { listCases, listPersons, screening, context, board, filings: () => filings.all(),
    save: save.immediate, update: update.immediate, file: file.immediate };
}
export type Cases = ReturnType<typeof createCases>;
