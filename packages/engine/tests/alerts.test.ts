import { describe, expect, it } from 'vitest';
import { explain, lookupOffence, policeCustodyCheck } from '../src/index.js';
import { alert, fact, fir, record, run } from './fixtures.js';

describe('review alerts golden cases', () => {
  it('starts a 60-day default-bail review on day 61', () => {
    // Jan 1–Mar 1 inclusive is 60 days. Mar 2 is first after expiry, still short of the 122-day section 479 mark.
    expect(alert(run('2025-03-01'), 'DEFAULT_BAIL_CHECK')).toBeUndefined();
    const result = run('2025-03-02', { pendingStatus: 'investigation', readyToFurnishBail: 'yes' });
    expect(result.status).toBe('DUE_IN_N_DAYS');
    expect(alert(result, 'DEFAULT_BAIL_CHECK')).toMatchObject({ dueOn: '2025-03-02', message: expect.stringContaining('yes') });
    expect(result.nalsaCategories).toContain(8);
    expect(explain(result)).toContainEqual({ key: 'lane.LAWYER_REVIEW' });
  });

  it('uses 90 days for a death or life charge', () => {
    // Jan 31 + Feb 28 + Mar 31 = 90. Apr 1 is day 91.
    const result = run('2025-04-01', { charges: [fir('302')] });
    expect(result.status).toBe('OUTSIDE_SCREEN');
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.dueOn).toBe('2025-04-01');
  });

  it('records both disputed expiry dates for a ten-year maximum and no minimum', () => {
    // IPC 306 has max ten and no statutory minimum. Jan 1 + 60 = Mar 2; Jan 1 + 90 = Apr 1.
    const result = run('2025-03-04', { charges: [fir('306')] });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')).toMatchObject({
      message: expect.stringContaining('60 or 90 days is disputed'), authority: expect.arrayContaining([
        expect.objectContaining({ section: expect.stringContaining('33526/2024'), url: expect.stringContaining('stateNm=Karnataka') }),
        expect.objectContaining({ section: expect.stringContaining('2025:KER:10727'), url: expect.stringContaining('stateNm=Kerala') })
      ])
    });
    const disputedAlert = alert(result, 'DEFAULT_BAIL_CHECK');
    expect(disputedAlert?.message).toContain('The 60-day period expires on 2025-03-02 and the 90-day period expires on 2025-04-01.');
    expect(disputedAlert?.dueOn).toBeUndefined();
    expect(result.trace.find(step => step.id === 'default-bail')?.inputs.firstReviewDates).toEqual(['2025-03-02', '2025-04-01']);
  });

  it('records a late charge sheet filed before the application', () => {
    // Expiry is Mar 2. Mar 4 report is late, and the Mar 5 application follows the report by one day.
    const result = run('2025-03-10', { chargesheetOn: '2025-03-04', defaultBailAppliedOn: '2025-03-05' });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.message).toContain('preceded the recorded application');
    expect(result.nalsaCategories).not.toContain(8);
  });

  it('records a default-bail application made before a late charge sheet', () => {
    // Expiry Mar 2 ≤ Mar 3 application < Mar 4 report.
    const result = run('2025-03-10', { chargesheetOn: '2025-03-04', defaultBailAppliedOn: '2025-03-03', readyToFurnishBail: 'yes' });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.message).toContain('before the later charge sheet');
    expect(result.nalsaCategories).toContain(8);
  });

  it('requires review of same-day filing sequence', () => {
    // Both events are Mar 4; civil dates cannot establish which filing was first.
    expect(alert(run('2025-03-10', { chargesheetOn: '2025-03-04', defaultBailAppliedOn: '2025-03-04' }), 'DEFAULT_BAIL_CHECK')?.message)
      .toContain('share a date');
  });

  it('flags disputed same-day filings as a NALSA review', () => {
    const result = run('2025-04-02', {
      charges: [fir('306')], chargesheetOn: '2025-04-01', defaultBailAppliedOn: '2025-04-01', readyToFurnishBail: 'yes'
    });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.message).toContain('Application and charge sheet share a date.');
    expect(result.trace.find(step => step.id === 'default-bail')?.inputs.timelyApplication).toBe(false);
    expect(result.nalsaCategories).toContain(8);
  });

  it('does not emit a 60-day alert for a timely charge sheet', () => {
    // Mar 1 is day 60, so the report was present before first review date Mar 2.
    expect(alert(run('2025-03-05', { chargesheetOn: '2025-03-01' }), 'DEFAULT_BAIL_CHECK')).toBeUndefined();
  });

  it('keeps a future charge sheet out of an earlier screen', () => {
    // At Mar 2 the Mar 3 charge sheet is outside the dated record.
    const result = run('2025-03-02', { chargesheetOn: '2025-03-03' });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.message).toContain('Verify whether a legally sufficient charge sheet');
    expect(result.trace.find(step => step.id === 'default-bail')?.inputs.chargesheet).toBeNull();
  });

  it('uses the earliest remand event when the field is absent', () => {
    // The Jan 1 remand is earlier than Jan 4; Jan 1 plus 60 is Mar 2.
    const result = run('2025-03-02', { firstRemandOn: undefined,
      events: [{ on: '2025-01-04', kind: 'remand' }, { on: '2025-01-01', kind: 'remand' }] });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.dueOn).toBe('2025-03-02');
  });

  it('keeps unknown remand and readiness visible', () => {
    // With no first remand there are zero calculable expiry dates, even though the custody clock has 61 days.
    const result = run('2025-03-02', { firstRemandOn: undefined, events: [] });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.message).toContain('Readiness to furnish bail: unknown');
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.dueOn).toBeUndefined();
  });

  it('routes CrPC default bail to review without asserting a BNSS deadline', () => {
    // Jan 1, 2024 plus 60 is Mar 1, but the first remand precedes the BNSS start.
    const result = run('2024-08-01', { firstRemandOn: '2024-01-01',
      custody: [{ kind: 'judicial', start: '2024-01-01', ongoing: true }] });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')).toMatchObject({ message: expect.stringContaining('CrPC') });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.dueOn).toBeUndefined();
  });

  it('routes commercial NDPS to the special-law check', () => {
    // Section 22(c) is ten to twenty years; Jan 1 + 180 days = Jun 30, evidenced for this fixture.
    const result = run('2025-06-30', { charges: [fir('22(c)', 'NDPS')], pendingStatus: 'investigation', readyToFurnishBail: 'yes',
      evidence: { defaultBailReviewDueOn: fact('2025-06-30') } });
    expect(result).toMatchObject({ status: 'NEEDS_LAWYER_REVIEW', antilCategory: 'C' });
    expect(alert(result, 'DEFAULT_BAIL_CHECK')?.dueOn).toBe('2025-06-30');
    expect(result.nalsaCategories).toContain(8);
  });

  it('does not use pre-application default-bail readiness to infer post-grant terms', () => {
    // Feb 28 is one calendar month from Jan 31, but readiness is distinct from furnishing a court bond.
    const result = run('2025-02-28', { bailGrantedOn: '2025-01-31', readyToFurnishBail: 'no' });
    expect(alert(result, 'POST_BAIL_1_MONTH')).toBeUndefined();
  });

  it('alerts on seven days from bail grant', () => {
    // Jan 31 plus seven elapsed days is Feb 7; Feb 6 is still one day short.
    expect(alert(run('2025-02-06', { bailGrantedOn: '2025-01-31' }), 'POST_BAIL_7_DAYS')).toBeUndefined();
    const result = run('2025-02-07', { bailGrantedOn: '2025-01-31' });
    expect(alert(result, 'POST_BAIL_7_DAYS')?.dueOn).toBe('2025-02-07');
    expect(explain(result)).toContainEqual({ key: 'lane.BAIL_NOT_RELEASED' });
  });

  it('clamps the one-month follow-up date at February month end', () => {
    // Jan 31 plus one month is Feb 28. Feb 27 is one day short even though the seven-day action is due.
    const input = { bailGrantedOn: '2025-01-31', evidence: { bailBondsFurnished: fact<'no'>('no', '2025-02-01') } };
    expect(alert(run('2025-02-27', input), 'POST_BAIL_1_MONTH')).toBeUndefined();
    expect(alert(run('2025-02-28', input), 'POST_BAIL_1_MONTH')).toMatchObject({
      dueOn: '2025-02-28', authority: expect.arrayContaining([expect.objectContaining({ section: '483' }), expect.objectContaining({ section: '484' })])
    });
  });

  it('stops outstanding-bail alerts on documented release', () => {
    // Jan 31 plus seven days is Feb 7. Release on Feb 5 closes the outstanding-bail check.
    const result = run('2025-02-28', { bailGrantedOn: '2025-01-31', releasedOn: '2025-02-05', evidence: { bailBondsFurnished: fact('no') } });
    expect(alert(result, 'POST_BAIL_7_DAYS')).toBeUndefined();
    expect(alert(result, 'POST_BAIL_1_MONTH')).toBeUndefined();
  });

  it('checks section 478 at one week from arrest rather than remand', () => {
    // Jan 1 arrest + 7 = Jan 8. Jan 3 remand + 7 would incorrectly wait until Jan 10.
    const input = { firstRemandOn: '2025-01-03', evidence: { arrestedOn: fact('2025-01-01'), bailBondsFurnished: fact<'no'>('no') } };
    expect(alert(run('2025-01-07', input), 'S478_INDIGENCE')).toBeUndefined();
    expect(alert(run('2025-01-08', input), 'S478_INDIGENCE')?.dueOn).toBe('2025-01-08');
  });

  it('keeps the non-bailable theft limb of house-trespass out of section 478', () => {
    // Jan 1 plus seven is Jan 8, but IPC 451 with theft intended is expressly non-bailable in the First Schedule.
    const result = run('2025-01-08', { charges: [{ ...fir('451'), variant: 'theft' }],
      evidence: { arrestedOn: fact('2025-01-01'), bailBondsFurnished: fact('no') } });
    expect(alert(result, 'S478_INDIGENCE')).toBeUndefined();
    expect(result.nalsaCategories).not.toContain(5);
  });

  it('requires an arrest date for the indigence presumption', () => {
    // A week after remand supplies seven elapsed days, but supplies no dated arrest.
    expect(alert(run('2025-01-08', { evidence: { bailBondsFurnished: fact('no') } }), 'S478_INDIGENCE')).toBeUndefined();
  });

  it('flags sixteen distinct police-custody days', () => {
    // [Jan 1, Jan 11) ∪ [Jan 9, Jan 17) = [Jan 1, Jan 17) = 16 days.
    const result = policeCustodyCheck(record({ custody: [
      { kind: 'police', start: '2025-01-01', end: '2025-01-11' },
      { kind: 'police', start: '2025-01-09', end: '2025-01-17' }
    ] }), 365);
    expect(result).toMatchObject({ policeDays: 16, windowDays: 40, withinWindow: true });
    expect(result.alerts.map(a => a.kind)).toContain('POLICE_CUSTODY_OVER_15');
  });

  it('permits the fifteenth police-custody day', () => {
    // Jan 16 exclusive minus Jan 1 inclusive is exactly 15.
    const result = policeCustodyCheck(record({ custody: [{ kind: 'police', start: '2025-01-01', end: '2025-01-16' }] }), 365);
    expect(result).toMatchObject({ policeDays: 15, windowDays: 40, withinWindow: true, alerts: [] });
  });

  it('flags police custody on day 41 in a 40-day window', () => {
    // Jan 1 is day 1. Feb 9 is day 40, and [Feb 10, Feb 11) is outside the window.
    const result = policeCustodyCheck(record({ custody: [{ kind: 'police', start: '2025-02-10', end: '2025-02-11' }] }), 365);
    expect(result).toMatchObject({ policeDays: 1, windowDays: 40, withinWindow: false });
    expect(result.alerts.map(a => a.kind)).toContain('POLICE_CUSTODY_OUTSIDE_WINDOW');
  });

  it('counts police custody on day 60 in the 90-day classification', () => {
    // Jan 31 + Feb 28 = 59, so Mar 1 is day 60; [Mar 1, Mar 2) is the last permitted day.
    const result = policeCustodyCheck(record({ charges: [fir('302')], custody: [
      { kind: 'police', start: '2025-03-01', end: '2025-03-02' }
    ] }), Infinity);
    expect(result).toMatchObject({ policeDays: 1, windowDays: 60, withinWindow: true, alerts: [] });
  });

  it('does not apply the expanded BNSS remand window to an old case', () => {
    // Jan 20 is day 20 from Jan 1, 2024, but a BNSS window comparison cannot establish legality.
    const c = record({ firstRemandOn: '2024-01-01', orderDate: '2024-03-01',
      custody: [{ kind: 'police', start: '2024-01-20', end: '2024-01-21' }] });
    expect(policeCustodyCheck(c, 365)).toMatchObject({ policeDays: 1, withinWindow: false, alerts: [] });
    expect(run('2024-01-20', c).status).toBe('NEEDS_LAWYER_REVIEW');
  });

  it('flags a court-side acquittal against verified jail roster evidence', () => {
    // Jan 30 is one day after the Jan 29 acquittal, and the Jan 30 roster still places the appellant in jail.
    const result = run('2025-01-30', { pendingStatus: 'disposed', custody: [], events: [{ on: '2025-01-29', kind: 'acquitted' }] },
      { prisonerType: 'convict_appellant', evidence: { jailRoster: fact('yes', '2025-01-30') } });
    expect(result.status).toBe('OUTSIDE_SCREEN');
    expect(alert(result, 'COURT_JAIL_MISMATCH')?.message).toContain('identity');
  });

  it('fires stale court status at 180 days', () => {
    // Jan 1 to Jun 29 = 179 elapsed days; Jan 1 to Jun 30 = 180.
    expect(alert(run('2025-06-29'), 'NO_COURT_UPDATE_180')).toBeUndefined();
    expect(alert(run('2025-06-30'), 'NO_COURT_UPDATE_180')?.dueOn).toBe('2025-06-30');
  });

  it('suppresses the stale flag when the record contains a new update', () => {
    // A Jun 29 hearing is one day old on Jun 30, well inside the 180-day interval.
    const result = run('2025-06-30', { events: [...record().events, { on: '2025-06-29', kind: 'hearing' }] });
    expect(alert(result, 'NO_COURT_UPDATE_180')).toBeUndefined();
  });

  it('refers a documented financial barrier with no other hold', () => {
    // Jan 31 to Feb 7, 2026 is seven days; verified unfurnished bonds are the sole known barrier.
    const result = run('2026-02-07', { bailGrantedOn: '2026-01-31',
      evidence: { bailBondsFurnished: fact('no', '2026-02-07'), financialBarrier: fact('yes', '2026-02-07') } });
    expect(alert(result, 'POOR_PRISONERS_REFERRAL')?.authority?.[0].text).toMatch(/^Summary of the SOP\./);
  });

  it('suppresses referral for the hard exclusion tier', () => {
    // The financial and custody facts are otherwise sufficient, but NDPS is one of the four named Acts.
    const result = run('2026-02-07', { charges: [fir('22(a)', 'NDPS')], bailGrantedOn: '2026-01-31',
      evidence: { bailBondsFurnished: fact('no'), financialBarrier: fact('yes') } });
    expect(alert(result, 'POOR_PRISONERS_EXCLUDED')).toBeDefined();
    expect(alert(result, 'POOR_PRISONERS_REFERRAL')).toBeUndefined();
  });

  it('keeps committee discretion visible for dowry death', () => {
    // IPC 304B is in the heinous-offence tier, despite the minimum of seven years and a life maximum.
    const result = run('2026-02-07', { charges: [fir('304B')], bailGrantedOn: '2026-01-31',
      evidence: { bailBondsFurnished: fact('no'), financialBarrier: fact('yes') } });
    expect(alert(result, 'POOR_PRISONERS_DISCRETION')?.message).toContain('Committee discretion');
    expect(alert(result, 'POOR_PRISONERS_EXCLUDED')).toBeUndefined();
  });

  it('does not infer finance or holds from silence', () => {
    // Seven days establish an overdue follow-up, but a recorded hold blocks the financial referral.
    const result = run('2026-02-07', { bailGrantedOn: '2026-01-31', evidence: { bailBondsFurnished: fact('no') } }, { otherHolds: 'unknown' });
    expect(alert(result, 'POST_BAIL_7_DAYS')?.message).toContain('holds');
    expect(alert(result, 'POOR_PRISONERS_REFERRAL')).toBeUndefined();
  });

  it('looks up quantity, subsection and local offence variants', () => {
    // NDPS 22(c) is 10–20 years, Arms 25(1B) is 2–5 and CG s.34(2) first is 1–3.
    expect(lookupOffence('NDPS', '22(c)')).toMatchObject({ minYears: 10, maxText: '20 years' });
    expect(lookupOffence('ARMS', '25', '(1B)')).toMatchObject({ minYears: 2, maxText: '5 years' });
    expect(lookupOffence('EXCISE', '34', '(2) first')).toMatchObject({ minYears: 1, maxText: '3 years' });
  });
});
