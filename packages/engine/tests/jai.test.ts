import { describe, expect, it } from 'vitest';
import type { CaseMeta, Hearing } from '@courtplus/contracts';
import { courtBacklog, defaultCourtSettings, rankCases, scoreCase, suggestCauseList } from '../src/jai';

const today = '2026-11-23';
const matter = (caseId: string, filedOn: string, fields: Partial<CaseMeta> = {}): CaseMeta => ({
  caseId, filedOn, caseType: 'civil', stage: 'Fictional hearing', partiesInCustody: false,
  partyFlags: [], nationalSecurity: false, ...fields,
});
const adjournment: Hearing = { caseId: 'Fictional-A', date: today, purpose: 'Fictional hearing', outcome: 'adjourned' };

describe('Justice Acceleration Index', () => {
  it('shows every weight and reason, and caps an all-factor case at 100', () => {
    const meta = matter('Fictional-A', '2015-01-31', { caseType: 'cheque', partiesInCustody: true, nationalSecurity: true,
      partyFlags: ['seniorCitizen', 'woman', 'child', 'disability', 'undertrial'] });
    const ranked = scoreCase(meta, Array.from({ length: 6 }, () => adjournment), today);
    expect(ranked.score).toBe(100);
    expect(ranked.factors.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
    expect(ranked.factors.every(row => row.reason && row.sources.length)).toBe(true);
    expect(ranked.factors[0].sources.map(source => source.section)).toEqual(['Article 21', '479']);
    expect(scoreCase(matter('Fictional-none', today), [], today).score).toBe(0);
  });

  it('uses calendar months for the cheque endeavour date and counts only recorded adjournments through today', () => {
    const meta = matter('Fictional-A', '2025-08-31', { caseType: 'cheque' });
    const hearings = [
      { ...adjournment, date: '2026-02-27' },
      { ...adjournment, date: '2026-03-02' },
      { ...adjournment, date: '2026-02-27', outcome: 'heard' as const },
      { ...adjournment, date: '2026-02-27', caseId: 'Fictional-B' },
    ];
    expect(scoreCase(meta, hearings, '2026-02-27').score).toBe(2);
    expect(scoreCase(meta, hearings, '2026-02-28').score).toBe(12);
  });

  it('applies overrides without changing scores and reserves room for the oldest eligible case', () => {
    const ranked = rankCases([
      matter('Fictional-oldest', '2010-01-01'), matter('Fictional-pinned', '2026-01-01'),
      matter('Fictional-priority', '2026-01-01', { partiesInCustody: true }),
      matter('Fictional-down', '2000-01-01'), matter('Fictional-booked', '2010-01-01'),
      matter('Fictional-other-day', '2010-01-01'), matter('Fictional-disposed', '2010-01-01', { disposedOn: today }),
    ], [], [
      { caseId: 'Fictional-pinned', direction: 'up', reason: 'Fictional scheduling instruction' },
      { caseId: 'Fictional-down', direction: 'down', reason: 'Fictional scheduling instruction' },
    ], today);
    expect(ranked[0]).toMatchObject({ meta: { caseId: 'Fictional-pinned' }, score: 0 });
    expect(ranked.at(-1)?.meta.caseId).toBe('Fictional-down');
    const plan = suggestCauseList('2026-11-24', ranked, { ...defaultCourtSettings, capacity: 4 },
      new Map([['Fictional-booked', '2026-11-24'], ['Fictional-other-day', '2026-11-25']]));
    expect(plan.entries.map(row => [row.caseId, row.basis])).toEqual([
      ['Fictional-booked', 'adjournment'], ['Fictional-oldest', 'oldest'],
      ['Fictional-pinned', 'priority'], ['Fictional-priority', 'priority'],
    ]);
  });

  it('sorts by pin, tier, score, and then oldest filing date', () => {
    const ranked = rankCases([
      matter('Fictional-tier-3', today, { partiesInCustody: true }),
      matter('Fictional-tier-2-new', '2026-10-01', { partyFlags: ['seniorCitizen'] }),
      matter('Fictional-tier-2-old', '2026-09-01', { partyFlags: ['seniorCitizen'] }),
      matter('Fictional-tier-2-high-score', '2026-10-01', { partyFlags: ['disability', 'woman'] }),
      matter('Fictional-tier-1', today, { nationalSecurity: true }),
      matter('Fictional-pin-down', today, { nationalSecurity: true }),
      matter('Fictional-pin-up', today),
    ], [], [
      { caseId: 'Fictional-pin-down', direction: 'down', reason: 'Fictional scheduling instruction' },
      { caseId: 'Fictional-pin-up', direction: 'up', reason: 'Fictional scheduling instruction' },
    ], today);
    expect(ranked.map(({ meta, tier, score }) => [meta.caseId, tier.level, score])).toEqual([
      ['Fictional-pin-up', 3, 0], ['Fictional-tier-1', 1, 5], ['Fictional-tier-2-high-score', 2, 10],
      ['Fictional-tier-2-old', 2, 7], ['Fictional-tier-2-new', 2, 7], ['Fictional-tier-3', 3, 25],
      ['Fictional-pin-down', 1, 5],
    ]);
  });

  it('uses actual filing and disposal weeks and calendar anniversaries for pending age', () => {
    const backlog = courtBacklog([
      matter('Fictional-new', today), matter('Fictional-disposed', '2026-11-20', { disposedOn: today }),
      ...['2025-11-23', '2023-11-23', '2021-11-23', '2016-11-23', '2016-11-22']
        .map((on, index) => matter(`Fictional-aged-${index}`, on)),
      matter('Fictional-unknown-disposal', '2000-01-01'),
      matter('Fictional-future', '2026-11-24'),
    ], today, new Set(['Fictional-disposed', 'Fictional-unknown-disposal']));
    expect(backlog.weeks.slice(-2)).toEqual([
      { start: '2026-11-16', filed: 1, disposed: 0 }, { start: today, filed: 1, disposed: 1 },
    ]);
    expect(backlog.age.map(row => row.count)).toEqual([1, 1, 1, 2, 1]);
    expect(courtBacklog([], today, new Set())).toEqual({ weeks: [], age: [] });
  });
});
