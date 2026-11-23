import { describe, expect, it } from 'vitest';
import { explain, lookupOffence, screen } from '../src/index.js';
import { fact, fir, person, record, run, source } from './fixtures.js';

describe('detention threshold golden cases', () => {
  it('counts the first custody date', () => {
    // The one-day interval is [Jan 1, Jan 2); ceil(365/3) = 122, so 121 days remain.
    expect(run('2025-01-01')).toMatchObject({ rawCustodyDays: 1, countedCustodyDays: 1, dueInDays: 121 });
  });

  it('needs one more day on day 121', () => {
    // Jan 31 + Feb 28 + Mar 31 + Apr 30 + May 1 = 121; 3 × 121 = 363 < 365.
    expect(run('2025-05-01')).toMatchObject({
      status: 'DUE_IN_N_DAYS', maxTermDays: 365, countedCustodyDays: 121, dueInDays: 1, thresholdDate: '2025-05-02'
    });
  });

  it('reaches a third on day 122', () => {
    // Jan–Apr = 120, then two May days. 3 × 122 = 366 ≥ 365.
    const result = run('2025-05-02');
    expect(result).toMatchObject({ status: 'APPLY_NOW', countedCustodyDays: 122, thresholdFraction: '1/3', thresholdDate: '2025-05-02' });
    expect(result.trace.find(step => step.id === 'threshold')?.authority?.map(a => a.section)).toContain('479(3)');
    expect(result.trace[0].operation).toContain('The arrest or first custody day counts.');
  });

  it('uses half for a prior conviction', () => {
    // Ceil(365/2) = 183; through June = 181, then July 1–2.
    expect(run('2025-07-02', {}, { priorConviction: 'yes' })).toMatchObject({
      status: 'APPLY_NOW', countedCustodyDays: 183, thresholdFraction: '1/2', thresholdDate: '2025-07-02'
    });
  });

  it('adds a calendar year across a leap day', () => {
    // Sep 1, 2023 to Sep 1, 2024 spans Feb 29 and is 366 days. The third is 122.
    const result = run('2024-09-01', {
      firstRemandOn: '2023-09-01', custody: [{ kind: 'judicial', start: '2023-09-01', ongoing: true }]
    });
    expect(result).toMatchObject({ status: 'APPLY_NOW', maxTermDays: 366, countedCustodyDays: 367,
      thresholdDate: '2023-12-31', ceilingUrgent: true });
  });

  it('clamps a leap-day anniversary', () => {
    // Feb 29, 2024 plus one year is Feb 28, 2025, a 365-day difference.
    expect(run('2024-08-01', {
      firstRemandOn: '2024-02-29', custody: [{ kind: 'judicial', start: '2024-02-29', ongoing: true }]
    })).toMatchObject({ maxTermDays: 365, countedCustodyDays: 155, thresholdDate: '2024-06-29' });
  });

  it('clamps a six-month penalty at month end', () => {
    // Aug 31 + six months = Feb 28. 1+30+31+30+31+31+27 = 181; day 61 = Oct 30.
    expect(run('2025-10-30', {
      charges: [fir('337')], firstRemandOn: '2025-08-31', custody: [{ kind: 'judicial', start: '2025-08-31', ongoing: true }]
    })).toMatchObject({ maxTermDays: 181, countedCustodyDays: 61, thresholdDate: '2025-10-30' });
  });

  it('deducts an interim-bail gap from raw and counted days', () => {
    // Through May 2 = 122 days. [Feb 1, Feb 11) removes 10, so 112 days count and 10 remain.
    const c = record();
    expect(run('2025-05-02', {
      custody: [...c.custody, { kind: 'interim_bail', start: '2025-02-01', end: '2025-02-11' }]
    })).toMatchObject({ rawCustodyDays: 112, countedCustodyDays: 112, dueInDays: 10, thresholdDate: '2025-05-12' });
  });

  it('unions overlapping detention spells', () => {
    // [Jan 1, Mar 1) overlaps [Feb 1, May 3); their union is [Jan 1, May 3), or 122 days.
    expect(run('2025-05-02', {
      custody: [{ kind: 'judicial', start: '2025-01-01', end: '2025-03-01' },
        { kind: 'judicial', start: '2025-02-01', ongoing: true }]
    })).toMatchObject({ rawCustodyDays: 122, countedCustodyDays: 122, status: 'APPLY_NOW' });
  });

  it('deducts documented overlapping accused delay once', () => {
    // Raw 122. [Jan 10, Jan 15) ∪ [Jan 12, Jan 17) is 7 days; 122 − 7 = 115.
    expect(run('2025-05-02', {
      custody: [...record().custody,
        { kind: 'accused_delay', start: '2025-01-10', end: '2025-01-15', source },
        { kind: 'accused_delay', start: '2025-01-12', end: '2025-01-17', source }]
    })).toMatchObject({ rawCustodyDays: 122, countedCustodyDays: 115, dueInDays: 7 });
  });

  it('leaves undocumented accused delay counted', () => {
    // Seven days without a documentary source do not reduce the known 122 days.
    const result = run('2025-05-02', {
      custody: [...record().custody, { kind: 'accused_delay', start: '2025-01-10', end: '2025-01-17' }]
    });
    expect(result).toMatchObject({ countedCustodyDays: 122, status: 'APPLY_NOW' });
    expect(result.trace.find(step => step.id === 'custody')?.warnings?.[0]).toContain('no documentary source');
  });

  it('deducts delay only where it overlaps actual detention', () => {
    // Gap removes Feb 1–10. Delay [Feb 5, Feb 14) then intersects detention on Feb 11–13 only.
    expect(run('2025-05-02', { custody: [...record().custody,
      { kind: 'interim_bail', start: '2025-02-01', end: '2025-02-11' },
      { kind: 'accused_delay', start: '2025-02-05', end: '2025-02-14', source }]
    })).toMatchObject({ rawCustodyDays: 112, countedCustodyDays: 109, dueInDays: 13 });
  });

  it('excludes the recorded release day', () => {
    // [Jan 1, May 2) counts through May 1 for 121 days. The release date is outside the interval.
    expect(run('2025-05-03', { releasedOn: '2025-05-02' })).toMatchObject({ status: 'OUTSIDE_SCREEN', countedCustodyDays: 121 });
  });

  it('sends open custody with no ongoing confirmation to review', () => {
    // An undated end and no ongoing flag establish no countable interval.
    expect(run('2025-05-02', { custody: [{ kind: 'judicial', start: '2025-01-01' }] }))
      .toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', countedCustodyDays: 0 });
  });

  it('rejects an invalid civil date', () => {
    // 2025 is not divisible by four, so Feb 29 is invalid.
    expect(run('2025-02-29')).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', countedCustodyDays: 0 });
  });

  it('does not include person data from a different case owner', () => {
    // There are zero matching person/case pairs.
    expect(screen(person(), [record({ personId: 'another-fictional-person' })], 'fictional-case', '2025-05-02'))
      .toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', countedCustodyDays: 0 });
  });

  it('excludes a death-eligible charge', () => {
    // IPC 302 allows death or life even after 122 custody days.
    expect(run('2025-05-02', { charges: [fir('302')] })).toMatchObject({ status: 'OUTSIDE_SCREEN', antilCategory: 'B' });
  });

  it('excludes an offence with a life alternative', () => {
    // IPC 304 Part I has a finite alternative but life remains available.
    expect(run('2025-05-02', { charges: [fir('304 Part I')] })).toMatchObject({ status: 'OUTSIDE_SCREEN' });
  });

  it('routes custody for a fine-only offence to urgent review', () => {
    // IPC 283 has a fine and zero months of imprisonment.
    const result = run('2025-05-02', { charges: [fir('283')] });
    expect(result).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', maxTermDays: 0, ceilingUrgent: true });
    expect(result.reasons).toContain('Custody is recorded for an offence with no custodial maximum.');
  });

  it('excludes convict-appellants from detention thresholds', () => {
    // Even though 122 days reaches a third of 365, an appellant is outside this screen.
    expect(run('2025-05-02', {}, { prisonerType: 'convict_appellant' })).toMatchObject({ status: 'OUTSIDE_SCREEN', countedCustodyDays: 122 });
  });

  it('preserves the ceiling flag with two pending cases', () => {
    // At Dec 31 custody is 365 days, exactly the maximum; the second pending case triggers s.479(2).
    expect(run('2025-12-31', {}, {}, [record({ id: 'fictional-other' })])).toMatchObject({
      status: 'NEEDS_LAWYER_REVIEW', ceilingUrgent: true
    });
  });

  it('routes two pending offences in one case to review', () => {
    // IPC 323 and 342 are two offences despite each having a 365-day maximum.
    const result = run('2025-05-02', { charges: [fir(), fir('342')] });
    expect(result).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', maxTermDays: 365 });
    expect(result.reasons).toContain('Pending offences or cases require review under BNSS s.479(2).');
  });

  it('deduplicates identical charges', () => {
    // The same legal provision appears twice; one offence remains, and 122 days reaches one-third.
    expect(run('2025-05-02', { charges: [fir(), fir()] }).status).toBe('APPLY_NOW');
  });

  it('routes an unseen case ID to review', () => {
    // One of the two listed cases is missing and its status cannot be determined.
    const result = run('2025-05-02', {}, { caseIds: ['fictional-case', 'fictional-unseen'] });
    expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
    expect(result.reasons).toContain('The record does not include every listed case.');
  });

  it('routes unknown conviction history to review', () => {
    // 122 days reaches a third, while the half-day threshold is 183.
    const result = run('2025-05-02', {}, { priorConviction: 'unknown' });
    expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
    expect(result.reasons).toContain('Prior conviction history is unknown.');
    expect(result.thresholdFraction).toBeUndefined();
  });

  it('routes unknown and affirmative holds to review', () => {
    // Neither values verifies that this is the only custodial hold.
    for (const [otherHolds, reason] of [
      ['unknown', 'Other holds are unknown.'], ['yes', 'Another warrant or hold is recorded.']
    ] as const) {
      const result = run('2025-05-02', {}, { otherHolds });
      expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
      expect(result.reasons).toContain(reason);
    }
  });

  it('routes a continuation order to review', () => {
    // 183 days is half rounded up, but a continuation order is evidenced.
    const result = run('2025-07-02', { evidence: { continuationOrder: fact('yes') } }, { priorConviction: 'yes' });
    expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
    expect(result.reasons).toContain('Verify the court’s continued-detention order and written reasons.');
  });

  it('does not apply an unverified framed charge over IPC 302', () => {
    // 10 years anchored on 2023-07-01 would give 1,218 days; the purported charge cannot establish that term yet.
    const result = run('2026-11-22', { firstRemandOn: '2023-07-01', charges: [
      fir('302'), { ...fir('304'), variant: 'II', stage: 'FRAMED', verified: false }
    ], custody: [{ kind: 'judicial', start: '2023-07-01', ongoing: true }] });
    expect(result).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', countedCustodyDays: 1241 });
    expect(result.reasons).toContain('Unverified framed charge requires lawyer review.');
  });

  it('uses verified IPC 304 Part II in place of IPC 302', () => {
    // 10 × 365 + 3 leap days = 3,653; ceil(3653/3) = 1,218 (Oct 30); Nov 22 is day 1,241.
    const result = run('2026-11-22', { firstRemandOn: '2023-07-01', charges: [
      fir('302'), { ...fir('304'), variant: 'Part II', stage: 'FRAMED', framedOn: '2026-09-01' }
    ], custody: [{ kind: 'judicial', start: '2023-07-01', ongoing: true }] });
    expect(result).toMatchObject({ status: 'APPLY_NOW', maxTermDays: 3653, countedCustodyDays: 1241, thresholdDate: '2026-10-30' });
  });

  it('ignores an offence framed after the retrospective date', () => {
    // July 2026 precedes the September framing, so the only effective set is the IPC 302 FIR.
    expect(run('2026-07-01', { charges: [
      fir('302'), { ...fir('304'), variant: 'II', stage: 'FRAMED', framedOn: '2026-09-01' }
    ] }).status).toBe('OUTSIDE_SCREEN');
  });

  it('applies CrPC half-only before July 2024', () => {
    // Jan 1, 2024 plus 121 days is May 1 because February has 29 days. Half of 366 is 183.
    const result = run('2024-05-01', { orderDate: '2024-05-01', firstRemandOn: '2024-01-01',
      events: [{ on: '2024-01-01', kind: 'remand' }], custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }] });
    expect(result).toMatchObject({ status: 'DUE_IN_N_DAYS', maxTermDays: 366, countedCustodyDays: 122, thresholdFraction: '1/2', dueInDays: 61 });
    expect(result.trace.find(step => step.id === 'threshold')?.authority?.[0].section).toBe('436A');
  });

  it('applies BNSS to an earlier pending IPC case', () => {
    // Jan to June of 2024 includes 182 days. Jul 1 is day 183, past the 122-day BNSS third.
    const result = run('2024-07-01', {
      orderDate: '2024-07-01', firstRemandOn: '2024-01-01', custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }]
    });
    expect(result).toMatchObject({ status: 'APPLY_NOW', maxTermDays: 366, countedCustodyDays: 183, thresholdFraction: '1/3' });
    expect(result.trace.find(step => step.id === 'governing-law')?.warnings?.[0]).toContain('BNSS s.531 savings');
  });

  it('keeps IPC 406 and BNS 316(2) terms distinct', () => {
    // Starting Jan 1, 2025, 3 calendar years contain 1095 days and 5 contain 1826.
    expect(run('2025-05-02', { charges: [fir('406')] }).maxTermDays).toBe(1095);
    expect(run('2025-05-02', { charges: [fir('316(2)', 'BNS')] }).maxTermDays).toBe(1826);
    expect(lookupOffence('IPC', '406')?.bnsEquivalent).toBe('316(2)');
  });

  it('does not choose a culpable homicide part from a bare section', () => {
    // IPC 304 contains potentially life and ten-year terms. The section alone does not select either.
    expect(lookupOffence('IPC', '304')).toBeNull();
    const result = run('2025-05-02', { charges: [fir('304')] });
    expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
    expect(result.reasons).toContain('Applicable punishment is unresolved.');
  });

  it('reviews an Arms Act charge preceding the sourced 2019 amendment', () => {
    // The cited 25(1B) version is two to five years. The offence predates it by one day.
    const result = run('2025-05-02', { charges: [{ ...fir('25(1B)', 'ARMS'), offenceOn: '2019-12-13' }] });
    expect(result.status).toBe('NEEDS_LAWYER_REVIEW');
    expect(result.maxTermDays).toBeUndefined();
    expect(result.reasons).toContain('Offence predates the sourced ARMS penalty edition.');
  });

  it('preserves known custody days when the current position is unresolved', () => {
    // The 121 completed days through May 1 are supported, while the later status has no release or ongoing record.
    expect(run('2025-05-03', { custody: [{ kind: 'judicial', start: '2025-01-01', end: '2025-05-02' }] }))
      .toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', countedCustodyDays: 121 });
  });

  it('supplies explanation keys and due-in parameters', () => {
    // 121 of 122 days means a one-day due date within the 30-day lane.
    const items = explain(run('2025-05-01'));
    expect(items).toEqual(expect.arrayContaining([
      { key: 'status.DUE_IN_N_DAYS', params: { days: 1 } }, { key: 'lane.DUE_30' }
    ]));
  });
});
