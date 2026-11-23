import type { CaseRecord, Charge, CourtEvent, FieldSuggestion, SourceRef } from '@courtplus/contracts';

/** Form fields an officer reviews. Intake suggestions map onto these via `suggestionTarget`. */
export const reviewFields = {
  court: 'Court', caseNo: 'Case reference', cnr: 'CNR', policeStation: 'Police station',
  orderDate: 'Order date', firstRemandOn: 'First remand date', chargesheetOn: 'Chargesheet date',
  judicialStart: 'Judicial custody start', bailOutcome: 'Bail outcome in this order',
  bailGrantedOn: 'Bail grant date', releasedOn: 'Release date', section: 'Charges',
} as const;
export type Field = keyof typeof reviewFields;
export type Facts = Partial<Record<Field, string>>;

export const bailOutcomes = { granted: 'Bail granted', rejected: 'Bail rejected' } as const;
export const otherEvents = { acquitted: 'Acquitted', convicted: 'Convicted' } as const;
export type OtherEvent = keyof typeof otherEvents;

const aliases: Record<string, Field> = { custodySince: 'judicialStart', arrestedOn: 'judicialStart' };

export function suggestionTarget(suggestion: FieldSuggestion): Field | undefined {
  if (suggestion.field === 'bailOutcome') return Object.hasOwn(bailOutcomes, suggestion.value) ? 'bailOutcome' : undefined;
  const field = aliases[suggestion.field] ?? suggestion.field;
  return Object.hasOwn(reviewFields, field) ? field as Field : undefined;
}

/** Copies a suggestion into the review form. A granted outcome dates the grant to the order unless a date is already set. */
export function applySuggestion(facts: Facts, suggestion: FieldSuggestion): Facts {
  const field = suggestionTarget(suggestion);
  if (!field) return facts;
  if (field === 'section') return { ...facts, section: facts.section ? facts.section + '\n' + suggestion.value : suggestion.value };
  const next = { ...facts, [field]: suggestion.value };
  if (field === 'bailOutcome' && suggestion.value === 'granted' && !next.bailGrantedOn && next.orderDate) {
    next.bailGrantedOn = next.orderDate;
  }
  return next;
}

export function confirmedCharges(text: string, stage: Charge['stage'], source: SourceRef): Charge[] {
  return text.split(/[\n,]/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^(IPC|BNS|NDPS|UAPA|PMLA|POCSO|PC_ACT|ARMS|EXCISE|OTHER)\s+([0-9]+[a-z]?)(?:\(([^)]+)\))?(?:\(([^)]+)\))?$/i.exec(line);
    if (!match) throw new Error('Enter charges with their statute, for example IPC 379. Put each charge on its own line.');
    const [, act, section, subsection, variant] = match;
    return { act: act.toUpperCase() as Charge['act'], section, subsection, variant, stage, verified: true, source };
  });
}

export interface CaseInput {
  id: string; personId: string; docId: string; confirmedBy: string; confirmedAt: string;
  facts: Facts; stage: Charge['stage']; pendingStatus: CaseRecord['pendingStatus'];
  judicialEnd?: string; ongoing: boolean; otherEvent?: { kind: OtherEvent; on?: string };
}

export function buildCaseRecord(input: CaseInput): CaseRecord {
  const confirmedBy = input.confirmedBy.trim();
  if (!confirmedBy) throw new Error('Enter the name of the person confirming these facts.');
  const source: SourceRef = { docId: input.docId, verifiedBy: confirmedBy, verifiedAt: input.confirmedAt };
  const value = (field: Field) => input.facts[field]?.trim() || undefined;
  const start = value('judicialStart');
  const { judicialEnd: end, ongoing } = input;
  if (start && (!end && !ongoing || end && (ongoing || end < start))) {
    throw new Error('Enter a judicial custody end date or confirm that custody is ongoing.');
  }
  const orderDate = value('orderDate');
  const outcome = value('bailOutcome');
  const bailGrantedOn = value('bailGrantedOn') ?? (outcome === 'granted' ? orderDate : undefined);
  if (outcome === 'granted' && !bailGrantedOn) throw new Error('Enter the bail grant date or the order date.');
  if (outcome === 'rejected' && !orderDate) throw new Error('Enter the order date for the bail rejection.');
  const other = input.otherEvent;
  if (other && !other.on) throw new Error('Enter the date of the ' + otherEvents[other.kind].toLowerCase() + ' event.');
  const firstRemandOn = value('firstRemandOn');
  const chargesheetOn = value('chargesheetOn');
  const releasedOn = value('releasedOn');
  const event = (kind: CourtEvent['kind'], on: string | undefined): CourtEvent[] => on ? [{ kind, on, source }] : [];
  return {
    id: input.id, personId: input.personId, court: value('court'), caseNo: value('caseNo'),
    cnr: value('cnr'), policeStation: value('policeStation'), firstRemandOn, chargesheetOn,
    orderDate, bailGrantedOn, releasedOn, pendingStatus: input.pendingStatus,
    charges: confirmedCharges(value('section') ?? '', input.stage, source),
    custody: start ? [{ kind: 'judicial', start, end, ongoing, source }] : [],
    events: [
      ...event('remand', firstRemandOn),
      ...event('chargesheet', chargesheetOn),
      ...event('bail_granted', bailGrantedOn),
      ...event('bail_rejected', outcome === 'rejected' ? orderDate : undefined),
      ...(other ? event(other.kind, other.on) : []),
      ...event('released', releasedOn),
    ],
  };
}
