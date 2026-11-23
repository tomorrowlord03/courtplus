import { createHmac } from 'node:crypto';
import type { CaseRecord, CourtPlusApi, Person } from '@courtplus/contracts' with { 'resolution-mode': 'import' };

type Source = NonNullable<CaseRecord['charges'][number]['source']>;
const section = /^\d+[a-z]{0,2}(?:\([a-z\d.-]{1,8}\)){0,2}$/i;
const subsection = /^(?:\d{1,6}[a-z]?|[a-z]|[ivxlcdm]{1,6})$/i;

export function opaqueId(secret: string, namespace: string, id: string): string {
  const hex = createHmac('sha256', secret).update(namespace).update('\0').update(id).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

export function cloudCase(person: Person, record: CaseRecord, secret: string): Parameters<CourtPlusApi['saveCase']> | undefined {
  if (person.juvenileClaim === 'yes' || record.charges.some(charge =>
    charge.act === 'POCSO'
    || charge.act === 'IPC' && /^(?:228a|375|376[a-z]{0,2}|377)\b/i.test(charge.section)
    || charge.act === 'BNS' && /^(?:6[3-9]|7[0-3])\b/i.test(charge.section))) return;
  const id = opaqueId(secret, 'case', record.id);
  const personId = opaqueId(secret, 'person', person.id);
  const source = (ref: Source | undefined) => ref && ({
    docId: opaqueId(secret, 'document', ref.docId),
    page: ref.page,
    verifiedAt: ref.verifiedAt && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(ref.verifiedAt) ? ref.verifiedAt : undefined,
  });
  return [{
    id: personId, alias: 'Accused-' + Number.parseInt(personId.slice(0, 8), 16),
    prisonerType: person.prisonerType, priorConviction: person.priorConviction, otherHolds: person.otherHolds,
    ageOver70: person.ageOver70, woman: person.woman, mentalIllness: person.mentalIllness,
    caseIds: [id],
  }, {
    id, personId, orderDate: record.orderDate, pendingStatus: record.pendingStatus,
    firstRemandOn: record.firstRemandOn, chargesheetOn: record.chargesheetOn,
    defaultBailAppliedOn: record.defaultBailAppliedOn, readyToFurnishBail: record.readyToFurnishBail,
    bailGrantedOn: record.bailGrantedOn, releasedOn: record.releasedOn,
    charges: record.charges.map(charge => ({
      act: charge.act, section: section.test(charge.section) ? charge.section : 'unknown',
      subsection: charge.subsection && subsection.test(charge.subsection) ? charge.subsection : undefined,
      stage: charge.stage, verified: charge.verified, source: source(charge.source),
    })),
    custody: record.custody.map(spell => ({
      kind: spell.kind, start: spell.start, end: spell.end, ongoing: spell.ongoing, source: source(spell.source),
    })),
    events: record.events.map(event => ({ on: event.on, kind: event.kind, source: source(event.source) })),
  }];
}
