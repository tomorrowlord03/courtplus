import { ui } from '../lib/i18n';
import { useState, type FormEvent } from 'react';
import type { MactInput, MactResult } from '@courtplus/contracts';
import { calculateMact } from '../../../../packages/engine/src/mact';
import { ErrorNote, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const notice = "This estimate uses Supreme Court rules and past awards. Call 15100 for free help from the National Legal Services Authority.";

export function CitizenSettlement() {
  const [kind, setKind] = useState<MactInput['kind']>('fatal');
  const [result, setResult] = useState<MactResult>();
  const [error, setError] = useState<string | null>(null);

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name) ?? 0);
    const base = { age: number('age'), monthlyIncome: number('income'), annualIncomeTax: number('tax') };
    const input: MactInput = kind === 'fatal' ? {
      ...base, kind, employment: data.get('employment') === 'permanent' ? 'permanent' : 'fixed-or-self-employed',
      familyStatus: data.get('family') === 'unmarried' ? 'unmarried' : 'married',
      dependants: number('dependants'), consortiumClaimants: number('claimants'),
      valuationOn: new Date().toISOString().slice(0, 10),
    } : {
      ...base, kind, functionalLossPercent: number('loss'), reviewedFutureProspectsPercent: 0,
      monthsUnableToWork: number('months'), treatment: number('treatment'), futureMedical: number('futureMedical'),
      pain: 0, amenities: 0, shortenedLife: 0,
    };
    try { setResult(calculateMact(input)); setError(null); }
    catch (cause) { setResult(undefined); setError(errMsg(cause)); }
  }

  const field = (label: string, name: string, required = false, max?: number) => <label key={name}>{ui(label)}
    <input className="field-control" name={name} type="number" min="0" max={max} step="any" required={required} defaultValue={required ? undefined : 0} />
  </label>;

  return <ScreenPage screenId="settlement-guide" note={ui(notice)}>
    <section className="panel grid gap-3" aria-label={ui("Accident compensation estimate")}>
      <h2 className="text-lg font-semibold">{ui("Estimate compensation for a road accident")}</h2>
      <p>{ui("Use the person’s age at the accident and income shown in records. Ask a lawyer to help check other amounts.")}</p>
      <form className="grid gap-3" onSubmit={calculate} onChange={() => { setResult(undefined); setError(null); }}>
        <label>{ui("What happened?")}<select className="field-control" value={kind} onChange={event => setKind(event.target.value === 'injury' ? 'injury' : 'fatal')}>
          <option value="fatal">{ui("Death in a road accident")}</option><option value="injury">{ui("Injury in a road accident")}</option>
        </select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Age at the accident", 'age', true, 120)}
          {field("Monthly income in rupees", 'income', true)}
          {field("Annual income tax in rupees", 'tax')}
          {kind === 'fatal' ? <>
            <label>{ui("Type of work")}<select className="field-control" name="employment"><option value="permanent">{ui("Permanent job")}</option><option value="fixed">{ui("Fixed pay or self-employed")}</option></select></label>
            <label>{ui("Marital status")}<select className="field-control" name="family"><option value="married">{ui("Married")}</option><option value="unmarried">{ui("Unmarried")}</option></select></label>
            {field("Family members who depend on this income", 'dependants', true, 100)}
            {field("Family members claiming for loss of companionship", 'claimants', false, 100)}
          </> : <>
            {field("Loss of ability to earn (%)", 'loss', true, 100)}
            {field("Months unable to work", 'months')}
            {field("Treatment and related costs in rupees", 'treatment')}
            {field("Expected future medical costs in rupees", 'futureMedical')}
          </>}
        </div>
        <div><button data-guide="start" className={btnPrimary}>{ui("Show estimate and working")}</button></div>
      </form>
      <ErrorNote error={error} />
      {result && <div aria-label={ui("How the estimate was calculated")}>
        <p className="font-semibold">{ui("Estimated total:") + " "}{money.format(result.total)}</p>
        <ol className="ml-5 list-decimal space-y-2">{result.steps.map(step => <li key={step.label}>
          <strong>{step.label}:</strong> {step.working}{step.amount !== undefined && ` = ${money.format(step.amount)}`}
          {step.source && <p><a href={step.source.url} target="_blank" rel="noreferrer">Source: {step.source.act}, {step.source.section}</a></p>}
        </li>)}</ol>
        <p>{ui(notice)}</p>
      </div>}
    </section>
    <section className="panel mt-4">
      <h2 className="text-lg font-semibold">{ui("Help with family support payments")}</h2>
      <p>{ui("The court looks at income, assets, and each person’s ability to work. It considers children’s needs and the family’s living, education, and healthcare costs. Health, caregiving, and other dependants also matter. The court sets the amount for each family.")}</p>
      <a href="https://indiankanoon.org/doc/117541087/?type=print" target="_blank" rel="noreferrer">Rajnesh v. Neha (2020)</a>
      <p>{ui(notice)}</p>
    </section>
    <section className="panel mt-4">
      <h2 className="text-lg font-semibold">{ui("Ways to reach an agreement")}</h2>
      <p>{ui("Lok Adalat can help settle some disputes, including certain road accident and family cases. In mediation, someone helps both sides talk and look for an agreement. Ask a legal aid lawyer which option could work for you before agreeing to terms.")}</p>
      <a href="https://nalsa.gov.in/" target="_blank" rel="noreferrer">{ui("National Legal Services Authority")}</a>
      <p>{ui(notice)}</p>
    </section>
  </ScreenPage>;
}
