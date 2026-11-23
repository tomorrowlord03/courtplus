import { describe, expect, it } from 'vitest';
import type { CaseMeta, Hearing } from '@courtplus/contracts';
import { tierFor } from '../src/tiers';
import { rankCases, scoreCase } from '../src/jai';
import type { StatutoryCheck } from '../src/tiers';

const today = '2026-11-23';
const matter = (fields: Partial<CaseMeta> = {}): CaseMeta => ({
  caseId: 'Fictional-tier-case', filedOn: today, caseType: 'civil', stage: 'Fictional hearing',
  partiesInCustody: false, partyFlags: [], nationalSecurity: false, ...fields,
});
const adjourned: Hearing = {
  caseId: matter().caseId, date: today, purpose: 'Fictional hearing', outcome: 'adjourned',
};

describe('rule-based case tiers', () => {
  it.each([
    [{ status: 'APPLY_NOW', asOf: today }, 1, 'BNSS s.479: Apply now (checked 2026-11-23)'],
    [{ status: 'APPLY_NOW', asOf: today, ceilingUrgent: true }, 1,
      'BNSS s.479: Urgent: maximum reached (checked 2026-11-23)'],
    [{ status: 'DUE_IN_N_DAYS', asOf: today, dueInDays: 30 }, 2, 'BNSS s.479 due in 30 days'],
    [{ status: 'DUE_IN_N_DAYS', asOf: today, dueInDays: 31 }, 3, undefined],
    [{ status: 'NEEDS_LAWYER_REVIEW', asOf: today }, 3, undefined],
    [{ status: 'NEEDS_LAWYER_REVIEW', asOf: today, ceilingUrgent: true }, 3, undefined],
    [{ status: 'OUTSIDE_SCREEN', asOf: today }, 3, undefined],
  ] as [StatutoryCheck, 1 | 2 | 3, string | undefined][])(
    'maps a confirmed s.479 check %j to tier %i', (check, level, rule) => {
      const meta = matter({ partiesInCustody: true, partyFlags: ['undertrial'] });
      const statutory = new Map([[meta.caseId, check]]);
      const tier = tierFor(meta, [], today, statutory);
      expect(tier.level).toBe(level);
      expect(tier.triggers.map(item => item.rule)).toEqual(rule ? [rule] : []);
      expect(tier.statutoryStatus).toBe(check.status);
      if (rule) expect(tier.triggers[0].source.section).toBe('479');
    });

  it('keeps the flag fallback without a screening result and passes checks through ranking', () => {
    const meta = matter({ partiesInCustody: true, partyFlags: ['undertrial'] });
    expect(tierFor(meta, [], today).triggers[0].rule).toContain('Verify the detention limit separately.');
    const statutory = new Map([[meta.caseId, { status: 'APPLY_NOW' as const, asOf: today }]]);
    expect(scoreCase(meta, [], today, statutory).tier.level).toBe(1);
    expect(rankCases([meta], [], [], today, statutory)[0].tier.triggers[0].rule).toContain('Apply now');
  });
  const flagCases: [Partial<CaseMeta>, 1 | 2, string[]][] = [
    [{ partiesInCustody: true, partyFlags: ['undertrial'] }, 1, ['479']],
    [{ partiesInCustody: true, partyFlags: ['child'] }, 1, ['12', 'Article 15(3)']],
    [{ nationalSecurity: true }, 1, ['19']],
    [{ partyFlags: ['seniorCitizen'] }, 2, ['Resolution 11']],
    [{ partyFlags: ['woman'] }, 2, ['Resolution 11']],
    [{ partyFlags: ['child'] }, 2, ['Article 15(3)']],
    [{ partyFlags: ['disability'] }, 2, ['12']],
  ];
  it.each(flagCases)('uses the recorded flags %j to assign tier %i and cite its sources', (fields, level, sections) => {
    const tier = tierFor(matter(fields), [], today);
    expect(tier.level).toBe(level);
    expect(tier.triggers.map(({ source }) => source.section)).toEqual(sections);
    expect(tier.triggers.every(({ rule, source }) => rule && source.url.startsWith('https://'))).toBe(true);
  });

  it.each(['2026-11-22', '2026-11-23', '2026-11-24'])('uses a strict five-year cutoff on %s', asOf => {
    const tier = tierFor(matter({ filedOn: '2021-11-23' }), [], asOf);
    expect(tier.level).toBe(asOf === '2026-11-24' ? 2 : 3);
    if (tier.level === 2) expect(tier.triggers[0].source.section).toBe('Resolution 8');
  });

  it.each(['2026-02-27', '2026-02-28', '2026-03-01'])('uses the passed calendar-month cheque target on %s', asOf => {
    const tier = tierFor(matter({ filedOn: '2025-08-31', caseType: 'cheque' }), [], asOf);
    expect(tier.level).toBe(asOf === '2026-03-01' ? 2 : 3);
    if (tier.level === 2) expect(tier.triggers[0].source.section).toBe('143(3)');
    expect(tierFor(matter({ filedOn: '2025-08-31' }), [], asOf).level).toBe(3);
  });

  it('counts only this case’s adjournments through the assessment date', () => {
    const hearings: Hearing[] = [adjourned, { ...adjourned, date: '2026-11-22' },
      { ...adjourned, date: '2026-11-24' }, { ...adjourned, outcome: 'heard' },
      { ...adjourned, caseId: 'Fictional-other-case' }];
    expect(tierFor(matter(), hearings, today).level).toBe(3);
    expect(tierFor(matter(), hearings, '2026-11-24')).toMatchObject({
      level: 2, triggers: [{ source: { section: 'Order XVII Rule 1(1) proviso' } }],
    });
  });

  it.each(['civil', 'family', 'MACT'] as const)('cites CPC for %s adjournments', caseType => {
    const tier = tierFor(matter({ caseType }), [adjourned, adjourned, adjourned], today);
    expect(tier.triggers[0].source.section).toBe('Order XVII Rule 1(1) proviso');
    expect(tier.triggers[0].rule).toContain('three per party in a civil suit');
  });

  it.each(['criminal', 'cheque', 'other'] as const)('uses a plain check prompt for %s adjournments', caseType => {
    const tier = tierFor(matter({ caseType }), [adjourned, adjourned, adjourned], today);
    expect(tier.triggers[0]).toMatchObject({
      rule: '3+ adjournments recorded (prompt to check)', source: { act: 'National Judicial Data Grid' },
    });
  });

  it('retains every applicable trigger across tiers', () => {
    const tier = tierFor(matter({ filedOn: '2020-01-01', caseType: 'cheque', partiesInCustody: true, nationalSecurity: true,
      partyFlags: ['undertrial', 'child', 'seniorCitizen', 'woman', 'disability'] }),
    [adjourned, { ...adjourned, date: '2026-11-22' }, { ...adjourned, date: '2026-11-21' }], today);
    expect(tier.label).toBe('Liberty / custody');
    expect(tier.triggers).toHaveLength(10);
    expect(new Set(tier.triggers.map(({ rule }) => rule)).size).toBe(10);
  });

  it.each([{}, { partiesInCustody: true }, { partyFlags: ['undertrial'] } satisfies Partial<CaseMeta>])(
    'returns Regular when no priority trigger applies to %j', fields => {
      expect(tierFor(matter(fields), [], today)).toEqual({ level: 3, label: 'Regular', triggers: [] });
    });
});
