import type {
  CaseRecord, Charge, ISODate, Person, SourceRef, Tri
} from '@courtplus/contracts';
import { day, iso, length, subtract, union, visibleDate } from './dates.js';
import type { Interval } from './dates.js';

export interface DatedEvidence<T> {
  on: ISODate;
  value: T;
  source: SourceRef;
}

export interface EngineCharge extends Charge {
  framedOn?: ISODate;
  offenceOn?: ISODate;
}

export interface EngineCaseRecord extends CaseRecord {
  charges: EngineCharge[];
  evidence?: {
    arrestedOn?: DatedEvidence<ISODate>;
    procedure?: DatedEvidence<'BNSS' | 'CrPC'>;
    continuationOrder?: DatedEvidence<Tri>;
    bailBondsFurnished?: DatedEvidence<Tri>;
    financialBarrier?: DatedEvidence<Tri>;
    bailable?: DatedEvidence<Tri>;
    compoundable?: DatedEvidence<Tri>;
    probationCandidate?: DatedEvidence<Tri>;
    sentenceCompletedOrRemission?: DatedEvidence<Tri>;
    preventiveDetention?: DatedEvidence<Tri>;
    economicOffence?: DatedEvidence<Tri>;
    specialTwinConditions?: DatedEvidence<Tri>;
    defaultBailReviewDueOn?: DatedEvidence<ISODate>;
    magistrateTrialFirstEvidence?: DatedEvidence<ISODate>;
  };
}

export interface EnginePerson extends Person {
  evidence?: {
    jailRoster?: DatedEvidence<Tri>;
    ageYears?: DatedEvidence<number>;
    sickOrInfirm?: DatedEvidence<Tri>;
  };
}

export function evidence<T>(item: DatedEvidence<T> | undefined, asOf: number): T | undefined {
  if (!item?.source.docId.trim() || visibleDate(item.on, asOf) === undefined) return undefined;
  return item.value;
}

export function eventDay(c: CaseRecord, kind: CaseRecord['events'][number]['kind'], asOf: number): number | undefined {
  let latest: number | undefined;
  for (const event of c.events) {
    if (event.kind !== kind) continue;
    const value = visibleDate(event.on, asOf);
    if (value !== undefined && (latest === undefined || value > latest)) latest = value;
  }
  return latest;
}

export function recordDate(
  c: CaseRecord, field: 'chargesheetOn' | 'firstRemandOn' | 'bailGrantedOn' | 'releasedOn',
  kind: 'chargesheet' | 'remand' | 'bail_granted' | 'released', asOf: number
): number | undefined {
  const explicit = visibleDate(c[field], asOf);
  if (kind === 'remand' || kind === 'chargesheet') {
    if (explicit !== undefined) return explicit;
    const dates = c.events.filter(event => event.kind === kind)
      .map(event => visibleDate(event.on, asOf)).filter(value => value !== undefined);
    return dates.length ? Math.min(...dates) : undefined;
  }
  const latest = eventDay(c, kind, asOf);
  if (explicit === undefined) return latest;
  return Math.max(explicit, latest ?? explicit);
}

export function pending(c: CaseRecord, asOf: number): boolean {
  return ['investigation', 'inquiry', 'trial'].includes(c.pendingStatus)
    && eventDay(c, 'acquitted', asOf) === undefined
    && eventDay(c, 'convicted', asOf) === undefined;
}

export function activeCharges(c: EngineCaseRecord, asOf: number) {
  const framingDates = c.events.filter(event => event.kind === 'framing').map(event => day(event.on));
  const futureFramingOnly = framingDates.some(value => value !== undefined && value > asOf)
    && !framingDates.some(value => value !== undefined && value <= asOf);
  const framed = c.charges.filter(charge => charge.stage === 'FRAMED')
    .map(charge => {
      const date = day(charge.framedOn);
      const page = charge.source?.page;
      const verified = date !== undefined && charge.verified && Boolean(charge.source?.docId.trim())
        && page !== undefined && Number.isInteger(page) && page > 0;
      return { charge, date, verified };
    })
    .filter(({ charge, date }) => date === undefined ? charge.framedOn !== undefined || !futureFramingOnly : date <= asOf);
  const verified = framed.filter(entry => entry.verified);
  const latestFraming = Math.max(...verified.map(({ date }) => date!));
  const selected = verified.length
    ? verified.filter(({ date }) => date === latestFraming).map(({ charge }) => charge)
    : c.charges.filter(charge => charge.stage === 'FIR');
  const unique = new Map(selected.map(charge => [
    [charge.act, charge.section, charge.subsection, charge.variant].map(part => part?.trim().toLowerCase()).join('|'),
    charge
  ]));
  return {
    charges: [...unique.values()],
    framed: verified.length > 0,
    unverified: framed.some(entry => !entry.verified && (entry.date === undefined || entry.date >= latestFraming))
  };
}

export function custody(c: CaseRecord, asOf: number, released: number | undefined) {
  const detention: Interval[] = [];
  const gaps: Interval[] = [];
  const delays: Interval[] = [];
  const warnings: string[] = [];
  let unresolved = false;
  for (const spell of c.custody) {
    const start = day(spell.start);
    if (start !== undefined && start > asOf) continue;
    if (spell.kind === 'accused_delay' && !spell.source?.docId.trim()) {
      warnings.push('An accused-delay spell had no documentary source and was not deducted.');
      continue;
    }
    const end = spell.end === undefined ? undefined : day(spell.end);
    if (start === undefined || (spell.end !== undefined && end === undefined)
      || (end !== undefined && end < start) || (end === undefined && !spell.ongoing
        && (released === undefined || start >= released || spell.kind === 'interim_bail' || spell.kind === 'accused_delay'))) {
      unresolved = true;
      warnings.push('A custody spell has an invalid or unresolved date.');
      continue;
    }
    const detentionSpell = spell.kind === 'police' || spell.kind === 'judicial';
    const releaseEnd = detentionSpell && released !== undefined && start < released ? released : Infinity;
    const interval = { start, end: Math.min(end ?? Infinity, asOf + 1, releaseEnd) };
    if (interval.end <= interval.start) continue;
    if (detentionSpell) detention.push(interval);
    else if (spell.kind === 'interim_bail') gaps.push(interval);
    else delays.push(interval);
  }
  const raw = subtract(union(detention), gaps);
  return {
    raw, counted: subtract(raw, delays), warnings, unresolved,
    inCustody: raw.at(-1)?.end === asOf + 1, onInterimBail: gaps.some(gap => gap.end === asOf + 1),
    spellInputs: { detention: dated(detention), interimBail: dated(gaps), documentedDelay: dated(delays) }
  };
}

export function dated(intervals: Interval[]) {
  return intervals.map(interval => ({ start: iso(interval.start), endExclusive: iso(interval.end) }));
}

export function isInCustody(c: CaseRecord, person: EnginePerson, asOf: number) {
  const released = recordDate(c, 'releasedOn', 'released', asOf);
  const clock = custody(c, asOf, released);
  const roster = evidence(person.evidence?.jailRoster, asOf);
  return { released, clock, roster, inCustody: roster === undefined || roster === 'unknown' ? clock.inCustody : roster === 'yes' };
}

export function fractionReached(days: number, maximum: number | undefined, denominator: number): boolean {
  return maximum !== undefined && maximum > 0 && denominator * days >= maximum;
}

export function custodyDays(clock: ReturnType<typeof custody>) {
  return { rawCustodyDays: length(clock.raw), countedCustodyDays: length(clock.counted) };
}
