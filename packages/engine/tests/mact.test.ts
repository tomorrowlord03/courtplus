import { describe, expect, it } from 'vitest';
import type { MactInput } from '@courtplus/contracts';
import { calculateMact, futureProspects } from '../src/mact.js';

const fatal = {
  kind: 'fatal', age: 38, monthlyIncome: 4_004, annualIncomeTax: 0, employment: 'permanent',
  familyStatus: 'married', dependants: 7, consortiumClaimants: 1, valuationOn: '2017-10-31',
} as const satisfies MactInput;

const injury = {
  kind: 'injury', age: 30, monthlyIncome: 3_000, annualIncomeTax: 0, functionalLossPercent: 15,
  reviewedFutureProspectsPercent: 0, monthsUnableToWork: 0, treatment: 0, futureMedical: 0,
  pain: 0, amenities: 0, shortenedLife: 0,
} as const satisfies MactInput;

describe('MACT compensation', () => {
  it('reproduces the dependency working in Sarla Verma SCC ¶¶43–46 (judgment ¶¶22–25)', () => {
    const result = calculateMact(fatal);
    const line = (label: string) => result.steps.find(step => step.label === label);
    expect(line('Adjusted annual income')?.amount).toBe(72_072);
    expect(line('Age multiplier')?.working).toContain('× 15');
    expect(line('Annual family contribution')?.amount).toBe(57_658);
    expect(line('Loss of dependency')?.amount).toBe(864_870);
    expect(result.total).toBe(934_870);
  });

  it.each([
    ['A', 30, 3_000, 15, 91_800],
    ['B', 30, 3_000, 75, 459_000],
    ['C', 25, 5_000, 70, 756_000],
  ])('reproduces Raj Kumar illustration %s using functional earning loss', (_, age, monthlyIncome, functionalLossPercent, total) => {
    expect(calculateMact({ ...injury, age, monthlyIncome, functionalLossPercent }).total).toBe(total);
  });

  it.each([
    [15, 18], [20, 18], [25, 18], [26, 17], [30, 17], [31, 16], [36, 15], [41, 14],
    [46, 13], [51, 11], [56, 9], [61, 7], [66, 5], [80, 5],
  ])('applies the Sarla Verma multiplier at age %i', (age, multiplier) => {
    const result = calculateMact({ ...injury, age, functionalLossPercent: 100 });
    expect(result.total).toBe(36_000 * multiplier);
  });

  it.each([
    [39, 50, 40], [40, 30, 25], [49, 30, 25], [50, 15, 10], [60, 15, 10], [61, 0, 0],
  ])('applies the Pranay Sethi additions at age %i', (age, permanent, fixed) => {
    expect(futureProspects(age, 'permanent')).toBe(permanent);
    expect(futureProspects(age, 'fixed-or-self-employed')).toBe(fixed);
  });

  it.each([
    ['married', 2, 120_000], ['married', 3, 120_000], ['married', 4, 135_000], ['married', 6, 135_000],
    ['married', 7, 144_000], ['unmarried', 1, 90_000], ['unmarried-dependent-family', 5, 120_000],
    ['married', 0, 0],
  ] as const)('applies personal deductions for %s with %i dependants', (familyStatus, dependants, contribution) => {
    const result = calculateMact({ ...fatal, monthlyIncome: 11_000, annualIncomeTax: 12_000, familyStatus, dependants });
    expect(result.steps.find(step => step.label === 'Annual family contribution')?.amount).toBe(contribution);
  });

  it.each([
    ['2020-10-30', 15_000, 40_000], ['2020-10-31', 16_500, 44_000],
    ['2023-10-31', 18_150, 48_400], ['2026-10-31', 19_965, 53_240],
  ])('applies compounded triennial increases as of %s', (valuationOn, estate, consortium) => {
    const result = calculateMact({ ...fatal, valuationOn, consortiumClaimants: 2 });
    expect(result.steps.find(step => step.label === 'Loss of estate')?.amount).toBe(estate);
    expect(result.steps.find(step => step.label === 'Funeral expenses')?.amount).toBe(estate);
    expect(result.steps.find(step => step.label === 'Loss of consortium')?.amount).toBe(consortium * 2);
  });

  it('shows each injury head and sums only the monetary heads', () => {
    const result = calculateMact({
      ...injury, monthsUnableToWork: 1.5, treatment: 1_000, futureMedical: 2_000, pain: 3_000,
      amenities: 4_000, shortenedLife: 5_000, reviewedFutureProspectsPercent: 10,
    });
    expect(result.steps.find(step => step.label === 'Earnings lost during treatment')?.amount).toBe(4_500);
    expect(result.total).toBe(100_980 + 4_500 + 15_000);
  });

  it('requires a reviewed deduction for a sole married dependant and validates unsupported or invalid inputs', () => {
    expect(() => calculateMact({ ...fatal, dependants: 1 })).toThrow(/reviewed personal deduction/);
    expect(calculateMact({ ...fatal, dependants: 1, reviewedDeductionPercent: 50 }).steps
      .find(step => step.label === 'Annual family contribution')?.amount).toBe(36_036);
    expect(() => calculateMact({ ...fatal, annualIncomeTax: 900_000 })).toThrow(/cannot exceed/);
    expect(() => calculateMact({ ...fatal, age: 14 })).toThrow(/age 15/);
    expect(() => calculateMact({ ...fatal, valuationOn: '2024-02-30' })).toThrow(/valid valuation date/);
    expect(() => calculateMact({ ...injury, functionalLossPercent: 101 })).toThrow(/cannot exceed 100%/);
  });
});
