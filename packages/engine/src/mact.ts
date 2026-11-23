import type { Authority, MactInput, MactResult, MactStep } from '@courtplus/contracts';

const sarla = 'https://indiankanoon.org/doc/837924/';
const pranay = 'https://indiankanoon.org/doc/139996215/';
const raj = 'https://indiankanoon.org/doc/153578069/';

const multiplierSource: Authority = { act: 'Sarla Verma v. DTC (2009)', section: 'SCC ¶42', text: 'Age multiplier', url: sarla };
const deductionSource: Authority = { act: multiplierSource.act, section: 'SCC ¶¶30–32', text: 'Personal and living expenses', url: sarla };
const prospectsSource: Authority = { act: 'National Insurance Co. v. Pranay Sethi (2017)', section: 'SCC ¶¶59.3–59.4', text: 'Income after tax and additions', url: pranay };
const conventionalSource: Authority = { act: prospectsSource.act, section: 'SCC ¶59.8', text: 'Conventional heads and triennial increases', url: pranay };
const injurySource: Authority = { act: 'Raj Kumar v. Ajay Kumar (2011)', section: 'SCC ¶¶6–7', text: 'Heads for personal injury', url: raj };
const disabilitySource: Authority = { act: injurySource.act, section: 'SCC ¶¶10–14, 19–20', text: 'Functional loss and worked illustrations', url: raj };

// Sarla Verma SCC ¶42 (¶21 in the judgment text), column (4).
const multipliers = [[25, 18], [30, 17], [35, 16], [40, 15], [45, 14], [50, 13],
  [55, 11], [60, 9], [65, 7], [Infinity, 5]] as const;

const money = (value: number) => value.toFixed(2);
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function nonnegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error(label + ' must be a finite, non-negative number.');
  }
  return value;
}

function whole(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + ' must be a non-negative whole number.');
  return value;
}

function percent(value: number, label: string) {
  if (nonnegative(value, label) > 100) throw new Error(label + ' cannot exceed 100%.');
  return value;
}

// Pranay Sethi SCC ¶¶59.3–59.4: permanent employment vs self-employment/fixed salary.
export function futureProspects(age: number, employment: 'permanent' | 'fixed-or-self-employed'): number {
  const permanent = employment === 'permanent';
  if (age < 40) return permanent ? 50 : 40;
  if (age < 50) return permanent ? 30 : 25;
  if (age <= 60) return permanent ? 15 : 10;
  return 0;
}

function deduction(input: Extract<MactInput, { kind: 'fatal' }>): [number, string] {
  const count = whole(input.dependants, 'Dependants');
  if (count === 0) return [1, 'No dependency claimed'];
  if (input.reviewedDeductionPercent !== undefined) {
    const rate = percent(input.reviewedDeductionPercent, 'Reviewed personal deduction');
    return [rate / 100, rate + '% reviewed deduction'];
  }
  // Sarla Verma SCC ¶¶30–32 (¶¶14–15 in the judgment text).
  if (input.familyStatus === 'unmarried') return [1 / 2, '1/2'];
  if (input.familyStatus === 'unmarried-dependent-family') return [1 / 3, '1/3'];
  if (count === 1) throw new Error('Enter the reviewed personal deduction for one married dependant.');
  if (count <= 3) return [1 / 3, '1/3'];
  if (count <= 6) return [1 / 4, '1/4'];
  return [1 / 5, '1/5'];
}

function conventionalYears(on: string): number {
  const date = new Date(on);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== on
    || on < '2017-10-31') {
    throw new Error('Enter a valid valuation date on or after 31 October 2017.');
  }
  // Pranay Sethi SCC ¶59.8: 10% increase every three years from the judgment.
  return Math.floor((date.getUTCFullYear() - 2017 - (on.slice(5) < '10-31' ? 1 : 0)) / 3);
}

export function calculateMact(input: MactInput): MactResult {
  const age = whole(input.age, 'Age');
  if (age < 15) throw new Error('The Sarla Verma multiplier in this calculator starts at age 15. Review child compensation separately.');
  const multiplier = multipliers.find(([maximum]) => age <= maximum)![1];
  const annual = nonnegative(input.monthlyIncome, 'Monthly income') * 12;
  const tax = nonnegative(input.annualIncomeTax, 'Annual income tax');
  if (tax > annual) throw new Error('Annual income tax cannot exceed annual income.');
  const net = annual - tax;
  const rate = input.kind === 'fatal' ? futureProspects(age, input.employment)
    : percent(input.reviewedFutureProspectsPercent, 'Reviewed future prospects');
  const uplift = net * rate / 100;
  const adjusted = net + uplift;
  const steps: MactStep[] = [
    { label: 'Annual income after tax', working: `${money(input.monthlyIncome)} × 12 − ${money(tax)}`, amount: round(net), source: prospectsSource },
    { label: 'Future prospects addition', working: `${money(net)} × ${rate}%`, amount: round(uplift), source: input.kind === 'fatal' ? prospectsSource : undefined },
    { label: 'Adjusted annual income', working: `${money(net)} + ${money(uplift)}`, amount: round(adjusted) },
    { label: 'Age multiplier', working: `Age ${age} → × ${multiplier}`, source: multiplierSource },
  ];
  const heads: MactStep[] = [];
  function head(label: string, working: string, amount: number, source: Authority) {
    heads.push({ label, working, amount: round(nonnegative(amount, label)), source });
  }

  if (input.kind === 'fatal') {
    const [share, fraction] = deduction(input);
    const personal = adjusted * share;
    // Match the whole-rupee annual contribution used in Sarla Verma SCC ¶46 (judgment ¶25).
    const contribution = Math.round(adjusted - personal);
    steps.push({ label: 'Personal and living expenses', working: `${money(adjusted)} × ${fraction}`, amount: round(personal), source: deductionSource });
    steps.push({ label: 'Annual family contribution', working: `${money(adjusted)} − ${money(personal)}, rounded to the nearest rupee`, amount: contribution });
    head('Loss of dependency', `${money(contribution)} × ${multiplier}`, contribution * multiplier, multiplierSource);
    const increases = conventionalYears(input.valuationOn);
    const factor = 1.1 ** increases;
    const claimants = whole(input.consortiumClaimants, 'Eligible consortium claimants');
    for (const [label, base, count] of [['Loss of estate', 15_000, 1], ['Funeral expenses', 15_000, 1],
      ['Loss of consortium', 40_000, claimants]] as const) {
      head(label, `${money(base)} × 1.10^${increases} × ${count} (as of ${input.valuationOn})`, base * factor * count, conventionalSource);
    }
  } else {
    // Raj Kumar SCC ¶¶6–7, 10–14, 19–20: use functional earning loss, with no personal deduction.
    const loss = percent(input.functionalLossPercent, 'Functional earning loss');
    const period = nonnegative(input.monthsUnableToWork, 'Months unable to work');
    head('Earnings lost during treatment', `${money(net / 12)} × ${period} months`, net / 12 * period, injurySource);
    head('Future earning loss', `${money(adjusted)} × ${loss}% × ${multiplier}`, adjusted * loss / 100 * multiplier, disabilitySource);
    for (const [label, amount] of [['Treatment, transport, attendant and related expenses', input.treatment],
      ['Future medical expenses', input.futureMedical], ['Pain, suffering and trauma', input.pain],
      ['Loss of amenities or marriage prospects', input.amenities], ['Shortened life expectancy', input.shortenedLife]] as const) {
      head(label, 'Reviewed amount entered', amount, injurySource);
    }
  }
  const amounts = heads.map(step => step.amount!);
  const total = round(nonnegative(amounts.reduce((sum, amount) => sum + amount, 0), 'Total'));
  return { steps: [...steps, ...heads, { label: 'Total', working: amounts.map(money).join(' + '), amount: total }], total };
}
