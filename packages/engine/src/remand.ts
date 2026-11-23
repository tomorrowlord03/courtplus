import type { Alert, CaseRecord, PoliceCustodyCheckFn, TraceStep } from '@courtplus/contracts';
import { ravindran, statute, tenYearCases, wadhawan } from './authority.js';
import { BNSS_START, day, iso, length, union, visibleDate } from './dates.js';
import { activeCharges, custody, evidence, recordDate } from './facts.js';
import type { EngineCaseRecord } from './facts.js';
import { resolveCharges, specialReviewActs } from './offences.js';
import type { ResolvedCharges } from './offences.js';

type Limit = '60' | '90' | 'disputed' | 'unknown';

export function investigationLimit(charges: ResolvedCharges): Limit {
  if (charges.some(({ row }) => row && (row.death || row.life || row.minYears >= 10))) return '90';
  if (charges.some(({ row }) => row && (row.maxMonths ?? 0) >= 120)) return 'disputed';
  return charges.length && charges.every(({ row }) => row) ? '60' : 'unknown';
}

export function usesCrPCProcedure(c: EngineCaseRecord, firstRemand: number | undefined, asOf: number): boolean {
  return asOf < BNSS_START
    || (evidence(c.evidence?.procedure, asOf) ?? (firstRemand !== undefined && firstRemand < BNSS_START ? 'CrPC' : 'BNSS')) === 'CrPC';
}

const dispute = '60 or 90 days is disputed for this offence: lawyer to check';
const oldProcedureReview = 'Review the CrPC procedure and BNSS savings with a lawyer.';
const specialProcedureReview = 'Review the special Act, any authorised extension, and the applicable time limit with a lawyer.';

export function defaultBailCheck(c: EngineCaseRecord, charges: ResolvedCharges, asOf: number, pending: boolean) {
  const firstRemand = recordDate(c, 'firstRemandOn', 'remand', asOf);
  const chargesheet = recordDate(c, 'chargesheetOn', 'chargesheet', asOf);
  const applied = visibleDate(c.defaultBailAppliedOn, asOf);
  const ready = c.readyToFurnishBail ?? 'unknown';
  const limit = investigationLimit(charges);
  const old = usesCrPCProcedure(c, firstRemand, asOf);
  const special = charges.some(({ charge }) => specialReviewActs.has(charge.act) || charge.act === 'EXCISE');
  const verifiedSpecialDue = special ? visibleDate(evidence(c.evidence?.defaultBailReviewDueOn, asOf), asOf) : undefined;
  const nominalLimits = limit === 'disputed' ? [60, 90] : limit === 'unknown' ? [] : [Number(limit)];
  const dates = firstRemand === undefined || old || special ? [] : nominalLimits.map(days => firstRemand + days);
  const due = verifiedSpecialDue ?? (dates.length === 1 ? dates[0] : undefined);
  const authority = [old ? statute.crpc167_2 : statute.bnss187_3, wadhawan, ravindran, ...(limit === 'disputed' ? tenYearCases.filter((_, index) => asOf >= day(index ? '2025-02-10' : '2024-12-13')!) : [])];
  const review: string[] = [];
  const sameDayFiling = applied !== undefined && applied === chargesheet;
  const timelyApplication = due !== undefined && applied !== undefined && applied >= due
    && (chargesheet === undefined || applied < chargesheet);
  const elapsedWithNoKnownReport = due !== undefined && asOf >= due
    && (chargesheet === undefined || chargesheet >= due);
  const ordinaryCheck = dates.length === 1 && (elapsedWithNoKnownReport || timelyApplication);
  if (pending) {
    if (old) review.push(oldProcedureReview);
    if (special) review.push(specialProcedureReview);
    if (limit === 'disputed') {
      review.push(dispute + '.');
      if (dates.length === 2) review.push('The 60-day period expires on ' + iso(dates[0])
        + ' and the 90-day period expires on ' + iso(dates[1]) + '.');
    }
    if (firstRemand === undefined) review.push('First remand date is unknown.');
    if (limit === 'unknown' && !special && !old) review.push('Verify the applicable offence and period.');
    if (due !== undefined && ordinaryCheck) {
      if (chargesheet === undefined) review.push('Verify whether a legally sufficient charge sheet was filed.');
      else if (timelyApplication) review.push('Application was made after the period expired and before the later charge sheet.');
      else if (applied !== undefined && applied < due) review.push('The recorded application predates expiry. Verify whether a fresh application was made in time.');
      else if (applied !== undefined && applied > chargesheet) review.push('Late charge sheet preceded the recorded application. Review whether the right was availed of before filing.');
      else if (!sameDayFiling) review.push('Late charge sheet recorded. Verify whether the accused applied before filing.');
    }
    if (sameDayFiling) review.push('Application and charge sheet share a date. Verify filing times and sequence.');
    if (review.length) review.push('Readiness to furnish bail: ' + ready + '.');
  }
  const alert: Alert | undefined = review.length ? {
    kind: 'DEFAULT_BAIL_CHECK', message: review.join(' '), ...(due !== undefined && { dueOn: iso(due) }), authority
  } : undefined;
  const reviewDates = verifiedSpecialDue === undefined ? dates : [verifiedSpecialDue];
  const reviewDue = pending && ready === 'yes' && reviewDates.some(date => asOf >= date
    && (chargesheet === undefined ? c.pendingStatus === 'investigation'
      : applied !== undefined && applied >= date && applied <= chargesheet));
  const trace: TraceStep = {
    id: 'default-bail', label: 'Default-bail review',
    inputs: {
      firstRemand: firstRemand === undefined ? null : iso(firstRemand),
      chargesheet: chargesheet === undefined ? null : iso(chargesheet),
      application: applied === undefined ? null : iso(applied), readyToFurnishBail: ready,
      firstReviewDates: dates.map(iso), timelyApplication
    },
    operation: 'Include the first remand day. Compare expiry and the application against the charge sheet filing date.',
    result: alert?.message ?? 'No default-bail review alert on the recorded dates.',
    authority
  };
  return { alert, trace, reviewDue };
}

function lastRecordedDay(c: CaseRecord): number | undefined {
  const order = day(c.orderDate);
  if (order !== undefined) return order;
  const days = [
    ...c.custody.map(spell => {
      const end = day(spell.end);
      return end === undefined ? day(spell.start) : end - 1;
    }),
    ...c.events.map(event => day(event.on)),
    day(c.firstRemandOn)
  ].filter(value => value !== undefined);
  return days.length ? Math.max(...days) : undefined;
}

export function policeCheck(c: EngineCaseRecord, asOf: number, limit: Limit, datedSnapshot = true) {
  const first = recordDate(c, 'firstRemandOn', 'remand', asOf);
  const old = usesCrPCProcedure(c, first, asOf);
  const authority = old ? [statute.crpc167_2] : [statute.bnss187_2, statute.bnss187_3];
  const windowDays = limit === '90' || limit === 'disputed' ? 60 : 40;
  const possibleEnds = limit === 'unknown' || limit === 'disputed' ? [40, 60] : [windowDays];
  let incomplete = false;
  const intervals = union(c.custody.flatMap(spell => {
    if (spell.kind !== 'police') return [];
    const start = day(spell.start);
    if (start !== undefined && start > asOf) return [];
    const end = spell.end === undefined && spell.ongoing && datedSnapshot ? asOf + 1 : day(spell.end);
    if (start === undefined || end === undefined || end < start) {
      incomplete = true;
      return [];
    }
    return [{ start, end: Math.min(asOf + 1, end) }];
  }));
  const policeDays = length(intervals);
  const beforeRemand = first !== undefined && intervals.some(interval => interval.start < first - 1);
  const beyond = (days: number) => first !== undefined && intervals.some(interval => interval.end > first + days);
  const outside = beforeRemand || beyond(Math.max(...possibleEnds));
  const ambiguous = !outside && beyond(Math.min(...possibleEnds));
  const alerts: Alert[] = [];
  if (policeDays > 15) alerts.push({
    kind: 'POLICE_CUSTODY_OVER_15', message: 'Recorded police custody exceeds 15 days in this investigation. Verify the remand orders.', authority
  });
  if (!old && outside) alerts.push({
    kind: 'POLICE_CUSTODY_OUTSIDE_WINDOW', message: 'Recorded police custody falls outside the applicable window from first remand. Verify the orders.', authority
  });
  const review = (policeDays > 0 || incomplete) && (old || first === undefined || incomplete || ambiguous || limit === 'unknown');
  const warnings = [
    ...(old ? [oldProcedureReview] : []),
    ...(first === undefined && policeDays ? ['First remand date is unavailable.'] : []),
    ...(incomplete ? ['A police-custody spell has unresolved dates.'] : []),
    ...(limit === 'disputed' ? [dispute] : []),
    ...(limit === 'unknown' && policeDays ? ['Verify the applicable remand window.'] : [])
  ];
  const withinWindow = !old && !incomplete && !outside && !ambiguous && (policeDays === 0 || first !== undefined && limit !== 'unknown');
  const trace: TraceStep = {
    id: 'police-custody', label: 'Police-custody duration and window',
    inputs: { firstRemand: first === undefined ? null : iso(first), policeDays, possibleWindows: old ? [] : possibleEnds },
    operation: 'Union police custody days. Compare against 15 days and the applicable half-open window, allowing the day before first remand.',
    result: alerts.map(alert => alert.message).join(' ') || (review ? 'The remand window requires review.' : 'No recorded police-custody breach.'),
    authority, warnings
  };
  return { policeDays, windowDays, withinWindow, alerts, trace, review } as const;
}

export const policeCustodyCheck: PoliceCustodyCheckFn = (c, maxTermDays) => {
  const asOf = lastRecordedDay(c);
  if (asOf === undefined) return { policeDays: 0, windowDays: maxTermDays >= 3650 ? 60 : 40, withinWindow: false, alerts: [] };
  const released = recordDate(c, 'releasedOn', 'released', asOf);
  const firstCustody = custody(c, asOf, released).raw[0]?.start;
  const firstRemand = recordDate(c, 'firstRemandOn', 'remand', asOf);
  const recorded = resolveCharges(activeCharges(c, asOf).charges, Math.min(firstCustody ?? asOf, firstRemand ?? asOf));
  const known = investigationLimit(recorded);
  const limit = known === 'unknown' && Number.isFinite(maxTermDays) && maxTermDays >= 0
    ? maxTermDays >= 3650 ? '90' : '60' : known;
  const { policeDays, windowDays, withinWindow, alerts } = policeCheck(c, asOf, limit, day(c.orderDate) !== undefined);
  return { policeDays, windowDays, withinWindow, alerts };
};
