import { describe, expect, it } from 'vitest';
import type { AdjournmentRequest, Hearing } from '@courtplus/contracts';
import { adjournmentHistory, adviseAdjournment } from '../src/adjournment';

const request: AdjournmentRequest = { caseId: 'Fictional-A', party: 'Fictional Claimant',
  date: '2026-11-01', requestedDays: 21, procedure: 'cpc' };
const hearing: Hearing = { caseId: request.caseId, date: '2026-10-10', purpose: 'Fictional hearing',
  outcome: 'adjourned', adjournedBy: request.party, grantedDays: 7 };
const hearings: Hearing[] = [hearing, { ...hearing, date: '2026-10-17', adjournedBy: ' fictional   claimant ', grantedDays: undefined },
  { ...hearing, date: '2026-10-22', adjournedBy: undefined, grantedDays: 0 },
  { ...hearing, caseId: 'Fictional-B' }, { ...hearing, date: '2026-11-02' }, { ...hearing, outcome: 'heard' }];
const calendar = [
  { date: '2026-11-30', available: 5 }, { date: '2026-11-15', available: 1 },
  { date: '2026-11-08', available: 0 }, { date: '2026-11-02', available: 5 },
];

describe('adjournment analyzer', () => {
  it('groups confirmed grants by party and distinguishes zero days from missing duration', () => {
    expect(adjournmentHistory(hearings, request.caseId, request.date)).toEqual([
      { count: 3, daysLost: 7, unknownDays: 1 },
      { party: request.party, count: 2, daysLost: 7, unknownDays: 1 },
      { party: 'Unattributed', count: 1, daysLost: 0, unknownDays: 0 },
    ]);
  });

  it('suggests the earliest date with capacity within the preparation and request window', () => {
    const advice = adviseAdjournment(request, hearings, 7, calendar);
    expect(advice.pattern).toMatch(/^3rd adjournment/);
    expect(advice.authority?.section).toBe('Order XVII Rule 1(1)');
    expect(advice.suggestion).toEqual({ date: '2026-11-15', days: 14 });
    expect(adviseAdjournment({ ...request, requestedDays: 14 }, hearings, 14, calendar).suggestion)
      .toEqual(advice.suggestion);
  });

  it('explains when the cap, preparation minimum, or capacity prevents a suggested date', () => {
    expect(adviseAdjournment({ ...request, requestedDays: 13 }, hearings, 7, calendar).suggestion).toBeUndefined();
    const advice = adviseAdjournment({ ...request, requestedDays: 6, procedure: 'bnss' }, hearings, 7, calendar);
    expect(advice.authority?.section).toBe('346');
    expect(advice.reason).toContain('7-day preparation minimum');
    expect(adviseAdjournment(request, hearings, 7, []).reason).toContain('No confirmed cause-list date');
  });
});
