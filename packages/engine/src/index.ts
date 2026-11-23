import type { Lane, ScreeningResult, ScreenFn, TraceStep } from '@courtplus/contracts';
import { antil, aug2024, juvenile, mentalHealth, nov2024, section479, statute } from './authority.js';
import { BNSS_START, DAY_CONVENTION, day, iso, nthDay } from './dates.js';
import { activeCharges, custodyDays, dated, eventDay, evidence, fractionReached, isInCustody, pending, recordDate } from './facts.js';
import type { EngineCaseRecord, EnginePerson } from './facts.js';
import { followUp, nalsaCategories } from './follow-up.js';
import { antilCategory, maxDaysFrom, resolveCharges, sourceUrl, specialReviewActs } from './offences.js';
import { defaultBailCheck, investigationLimit, policeCheck } from './remand.js';

export { lookupOffence } from './offences.js';
export { policeCustodyCheck } from './remand.js';
export type { DatedEvidence, EngineCaseRecord, EngineCharge, EnginePerson } from './facts.js';
export const RULE_VERSION = 'rules-2026-11-23.2';

const RETROSPECTIVE_ORDER = day('2024-08-23')!;
const orderDateMismatch = 'Screening date differs from the recorded order date.';

export const screen: ScreenFn = (inputPerson, cases, caseId, asOf) => {
  const c: EngineCaseRecord | undefined = cases.find(record => record.id === caseId && record.personId === inputPerson.id);
  const today = day(asOf);
  const mismatchedOrder = c?.orderDate !== undefined && c.orderDate !== asOf;
  const convention: TraceStep = {
    id: 'day-convention', label: 'Day convention', inputs: { asOf, orderDate: c?.orderDate ?? null },
    operation: DAY_CONVENTION, result: 'Civil date supplied by the caller.',
    ...(mismatchedOrder && { warnings: [orderDateMismatch] })
  };
  const result: ScreeningResult = {
    personId: inputPerson.id, caseId, asOf, ruleVersion: RULE_VERSION, dayConvention: DAY_CONVENTION,
    status: 'NEEDS_LAWYER_REVIEW', rawCustodyDays: 0, countedCustodyDays: 0, ceilingUrgent: false,
    reasons: [], alerts: [], nalsaCategories: [], trace: [convention]
  };
  if (today === undefined || !c) {
    result.reasons.push(today === undefined ? 'Screening date is invalid.' : 'Case is missing for the selected person.');
    result.trace.push({
      id: 'record-validation', label: 'Screening inputs', inputs: { caseId, personId: inputPerson.id },
      operation: 'Validate the civil date and case ownership.', result: result.reasons[0]
    });
    return result;
  }

  const otherCases = cases.filter(record => record.personId === inputPerson.id && record.id !== c.id);
  const convictionCases = otherCases.filter(record => record.pendingStatus === 'appeal'
    || eventDay(record, 'convicted', today) !== undefined).map(record => record.id);
  const person: EnginePerson = convictionCases.length ? { ...inputPerson, priorConviction: 'yes' } : inputPerson;
  const undertrial = person.prisonerType === 'undertrial' && pending(c, today);
  const bnss = today >= BNSS_START;
  const section = bnss ? 'BNSS s.479' : 'CrPC s.436A';
  const authority = bnss ? [...section479, ...(today >= RETROSPECTIVE_ORDER ? [aug2024] : [])] : [statute.crpc436A];
  const { released, clock, roster, inCustody } = isInCustody(c, person, today);
  const first = clock.raw[0]?.start;
  const firstRemand = recordDate(c, 'firstRemandOn', 'remand', today);
  const firstKnownCustody = Math.min(first ?? today, firstRemand ?? today);
  const inTransition = bnss && today < RETROSPECTIVE_ORDER && firstKnownCustody < BNSS_START;
  result.trace.push({
    id: 'governing-law', label: 'Governing detention rule',
    inputs: { pendingStatus: c.pendingStatus, prisonerType: person.prisonerType },
    operation: 'Select the detention rule on the screening date and keep the substantive offences as charged.',
    result: section, authority: inTransition ? [...authority, statute.bnss531] : authority,
    ...(inTransition && {
      warnings: ['Verify BNSS s.531 savings for this pre-1 July case. The Supreme Court clarified s.479 coverage on 23 August 2024.']
    })
  });

  const selected = activeCharges(c, today);
  const resolved = resolveCharges(selected.charges, firstKnownCustody, person.priorConviction);
  const unlisted = resolved.filter(({ row }) => !row);
  const penaltyIssues = [...new Set(resolved.flatMap(({ issue }) => issue ? [issue] : []))];
  const hasDeathOrLife = resolved.some(({ row }) => row?.death || row?.life);
  const offenceCount = new Set(resolved.map(({ charge, row }) => row ?? charge)).size;
  result.trace.push({
    id: 'charges', label: 'Charges as recorded',
    inputs: {
      charges: resolved.map(({ charge, row }) => ({
        act: charge.act, section: charge.section, subsection: charge.subsection, variant: charge.variant,
        source: charge.source, framedOn: charge.framedOn, offenceOn: charge.offenceOn, minYears: row?.minYears, maxMonths: row?.maxMonths,
        death: row?.death, life: row?.life, statute: row && sourceUrl(row), notes: row?.notes
      })),
      unverifiedFramedCharge: selected.unverified
    },
    operation: 'Use verified framed charges when available. Look up penal terms under the charged statute.',
    result: selected.framed ? 'Verified framed charges selected.' : 'FIR sections used provisionally. Confirm the framing order.',
    authority: today >= day('2024-11-19')! ? [nov2024] : [],
    warnings: [
      ...(selected.unverified ? ['An unverified framed charge requires review.'] : []),
      ...penaltyIssues,
      ...unlisted.map(({ charge }) => 'Missing applicable penalty for ' + charge.act + ' s.' + charge.section + '.')
    ]
  });

  Object.assign(result, custodyDays(clock));
  const maximum = maxDaysFrom(resolved, first);
  if (maximum !== undefined) result.maxTermDays = maximum;
  result.trace.push({
    id: 'custody', label: 'Custody accounting',
    inputs: { ...clock.spellInputs, firstCustody: first === undefined ? null : iso(first), maxTermDays: maximum ?? null },
    operation: 'Union detention, subtract interim-bail gaps, then subtract documented accused delay.',
    result: result.rawCustodyDays + ' raw days and ' + result.countedCustodyDays + ' counted days.',
    authority: [bnss ? statute.bnss479_1 : statute.crpc436A], warnings: clock.warnings,
  });

  const otherPending = [...new Set(otherCases.filter(record => pending(record, today)).map(record => record.id))];
  const missingCases = [...new Set(person.caseIds)].filter(id => id !== c.id && !otherCases.some(record => record.id === id));
  const otherHolds = person.otherHolds !== 'no' || otherPending.length > 0 || missingCases.length > 0 || convictionCases.length > 0;
  const continuation = evidence(c.evidence?.continuationOrder, today);
  const defaultBail = defaultBailCheck(c, resolved, today, undertrial && inCustody);
  const police = policeCheck(c, today, investigationLimit(resolved));
  const bail = followUp(c, person, resolved, today, inCustody, clock.inCustody, first, otherHolds, undertrial);
  const tags = nalsaCategories(c, person, resolved, today, result.countedCustodyDays, maximum,
    undertrial, inCustody, clock.raw, bail, defaultBail.reviewDue);
  result.alerts.push(...(defaultBail.alert ? [defaultBail.alert] : []), ...police.alerts, ...bail.alerts);
  result.nalsaCategories = tags.categories;
  const antilTag = antilCategory(resolved,
    evidence(c.evidence?.specialTwinConditions, today) === 'yes',
    evidence(c.evidence?.economicOffence, today) === 'yes');
  if (antilTag) result.antilCategory = antilTag;
  result.trace.push(defaultBail.trace, police.trace, bail.trace, tags.trace, {
    id: 'antil', label: 'Antil information tag', inputs: { selectedOffences: offenceCount },
    operation: 'Classify the recorded offences for information.', result: antilTag ?? 'No tag established.',
    authority: [antil]
  });

  const review: string[] = [];
  if (mismatchedOrder) review.push(orderDateMismatch);
  if (selected.unverified) review.push('Unverified framed charge requires lawyer review.');
  review.push(...penaltyIssues);
  if (unlisted.length > 0 || !resolved.length) review.push('Applicable punishment is unresolved.');
  const custodyKnown = inCustody || released !== undefined || clock.onInterimBail || roster === 'no';
  if (clock.unresolved || first === undefined || !custodyKnown || inCustody !== clock.inCustody) {
    review.push('Custody dates or current detention require verification.');
  }
  if (bnss && person.priorConviction === 'unknown') review.push('Prior conviction history is unknown.');
  if (convictionCases.length) review.push('Another case records a conviction or appeal. Verify the current hold.');
  if (person.otherHolds !== 'no') review.push(person.otherHolds === 'yes' ? 'Another warrant or hold is recorded.' : 'Other holds are unknown.');
  if (otherPending.length || bnss && offenceCount > 1) review.push(bnss
    ? 'Pending offences or cases require review under BNSS s.479(2).'
    : 'Other pending cases require review of the applicable custody and release position.');
  if (missingCases.length) review.push('The record does not include every listed case.');
  if (!person.caseIds.includes(c.id)) review.push('The selected case is absent from the person’s case list.');
  if (continuation === 'yes' || continuation === 'unknown') review.push('Verify the court’s continued-detention order and written reasons.');
  if (resolved.some(({ charge }) => specialReviewActs.has(charge.act))) review.push('Special-law charge requires lawyer review.');
  if (person.juvenileClaim === 'yes') review.push('Juvenile claim requires lawyer review.');
  if (person.mentalIllness === 'yes') review.push('Mental-health claim requires lawyer review.');
  if (police.review) review.push('Police-custody procedure or dates require lawyer review.');
  if (bail.outstanding) review.push('Bail was granted. Verify the current release conditions and holds.');
  if (!selected.framed) result.reasons.push('FIR sections used provisionally. Confirm the framing order.');

  const denominator = !bnss || person.priorConviction === 'yes' ? 2 : person.priorConviction === 'no' ? 3 : undefined;
  const finiteScreen = undertrial && !hasDeathOrLife && maximum !== undefined && maximum > 0;
  const reached = finiteScreen && denominator !== undefined && fractionReached(result.countedCustodyDays, maximum, denominator);
  const fineOnlyCustody = maximum === 0 && inCustody;
  if (fineOnlyCustody) review.push('Custody is recorded for an offence with no custodial maximum.');
  result.ceilingUrgent = fineOnlyCustody || undertrial && fractionReached(result.rawCustodyDays, maximum, 1);
  if (result.ceilingUrgent) {
    result.reasons.push('CEILING_URGENT_REVIEW: custody reached the applicable maximum.');
    if (!reached && maximum !== 0) review.push('Verify detention at the maximum despite the counted-day threshold.');
  }
  result.reasons.push(...review);
  if (finiteScreen) {
    if (denominator !== undefined) {
      result.thresholdFraction = denominator === 3 ? '1/3' : '1/2';
      const requiredDays = Math.ceil(maximum / denominator);
      const reachedOn = nthDay(clock.counted, requiredDays);
      if (reachedOn !== undefined) result.thresholdDate = iso(reachedOn);
      else if (!review.length && inCustody) {
        result.dueInDays = requiredDays - result.countedCustodyDays;
        result.thresholdDate = iso(today + result.dueInDays);
      }
    }
  }

  if (!undertrial && !mismatchedOrder && !fineOnlyCustody) {
    result.status = 'OUTSIDE_SCREEN';
    result.reasons.push('The selected case is outside the pending-undertrial screen.');
  } else if (!review.length && hasDeathOrLife) {
    result.status = 'OUTSIDE_SCREEN';
    result.reasons.push('The applicable charge allows death or life imprisonment.');
  } else if (!review.length && maximum === 0) {
    result.status = 'OUTSIDE_SCREEN';
    result.reasons.push('The applicable offence has no custodial maximum.');
  } else if (!review.length && !inCustody) {
    result.status = 'OUTSIDE_SCREEN';
    result.reasons.push(released === undefined ? 'No current custody is recorded for this case.' : 'Release is recorded for this case.');
  } else if (!review.length && reached) {
    result.status = 'APPLY_NOW';
    result.reasons.push(bnss
      ? 'Threshold reached. Superintendent to make a written application forthwith under s.479(3).'
      : 'Half-maximum threshold reached. Put the case before the court under CrPC s.436A.');
  } else if (result.dueInDays !== undefined) {
    result.status = 'DUE_IN_N_DAYS';
    result.reasons.push('Projected threshold assumes uninterrupted countable detention from the next day.');
  }

  result.trace.push({
    id: 'threshold', label: section + ' threshold and ceiling',
    inputs: {
      priorConviction: person.priorConviction, reportedPriorConviction: inputPerson.priorConviction,
      rawCustodyDays: result.rawCustodyDays, countedCustodyDays: result.countedCustodyDays, denominator: denominator ?? null,
      maxTermDays: maximum ?? null, countedIntervals: dated(clock.counted), offenceCount,
      otherPending, convictionCases, otherHolds, missingCases, continuationOrder: continuation ?? 'no record'
    },
    operation: 'Compare k × counted custody days for the fraction and raw custody days for the maximum.',
    result: result.status + (result.thresholdDate ? ' · ' + result.thresholdDate : ''),
    authority: [...authority, ...(person.juvenileClaim === 'yes' ? [juvenile] : []), ...(person.mentalIllness === 'yes' ? [mentalHealth] : [])],
    warnings: [
      ...review,
      ...(person.juvenileClaim === 'unknown' ? ['Juvenile claim not checked.'] : []),
      ...(person.mentalIllness === 'unknown' ? ['Mental-health claim not checked.'] : []),
      ...(bnss ? ['The court may continue detention after hearing the prosecutor and recording written reasons. Filing, decision and release are separate.'] : [])
    ]
  });
  return result;
};

type Explanation = {
  key: `status.${ScreeningResult['status']}` | `alert.${ScreeningResult['alerts'][number]['kind']}` | `lane.${Lane}`;
  params?: Record<string, string | number>;
};

export function explain(result: ScreeningResult): Explanation[] {
  const items: Explanation[] = [{
    key: `status.${result.status}`,
    ...(result.dueInDays !== undefined && { params: { days: result.dueInDays } })
  }];
  const lanes = new Set<Lane>();
  if (result.status === 'APPLY_NOW') lanes.add('APPLY_NOW');
  if (result.status === 'DUE_IN_N_DAYS' && (result.dueInDays ?? Infinity) <= 30) lanes.add('DUE_30');
  if (result.status === 'NEEDS_LAWYER_REVIEW' || result.ceilingUrgent) lanes.add('LAWYER_REVIEW');
  for (const alert of result.alerts) {
    items.push({ key: `alert.${alert.kind}`, ...(alert.dueOn && { params: { dueOn: alert.dueOn } }) });
    if (alert.kind === 'DEFAULT_BAIL_CHECK' || alert.kind === 'S478_INDIGENCE'
      || alert.kind === 'POLICE_CUSTODY_OVER_15' || alert.kind === 'POLICE_CUSTODY_OUTSIDE_WINDOW') lanes.add('LAWYER_REVIEW');
    if (alert.kind === 'POST_BAIL_7_DAYS' || alert.kind === 'POST_BAIL_1_MONTH') lanes.add('BAIL_NOT_RELEASED');
    if (alert.kind === 'COURT_JAIL_MISMATCH') lanes.add('COURT_JAIL_MISMATCH');
    if (alert.kind === 'NO_COURT_UPDATE_180') lanes.add('NO_UPDATE_180');
  }
  return items.concat([...lanes].map(lane => ({ key: `lane.${lane}` })));
}
