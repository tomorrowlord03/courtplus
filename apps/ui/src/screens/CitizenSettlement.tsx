import { useState, type FormEvent } from 'react';
import type { MactInput, MactResult } from '@courtplus/contracts';
import { calculateMact } from '../../../../packages/engine/src/mact';
import { ErrorNote, Page, btnPrimary, errMsg } from '../components/ui';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const notice = 'Estimate based on Supreme Court formulas and past awards - not a prediction; talk to free legal aid (NALSA 15100)';

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

  const field = (label: string, name: string, required = false, max?: number) => <label key={name}>{label}
    <input className="field-control" name={name} type="number" min="0" max={max} step="any" required={required} defaultValue={required ? undefined : 0} />
  </label>;

  return <Page title="Settlement and compensation guide" note={notice}>
    <section className="panel grid gap-3" aria-label="Motor accident estimate">
      <h2 className="text-lg font-semibold">Motor accident compensation estimate</h2>
      <p>Use the age at the accident and income supported by records. A lawyer can help check the other amounts the court may consider.</p>
      <form className="grid gap-3" onSubmit={calculate} onChange={() => { setResult(undefined); setError(null); }}>
        <label>What happened?<select className="field-control" value={kind} onChange={event => setKind(event.target.value === 'injury' ? 'injury' : 'fatal')}>
          <option value="fatal">Death in a motor accident</option><option value="injury">Injury in a motor accident</option>
        </select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Age at the accident', 'age', true, 120)}
          {field('Monthly income in rupees', 'income', true)}
          {field('Annual income tax in rupees', 'tax')}
          {kind === 'fatal' ? <>
            <label>Work type<select className="field-control" name="employment"><option value="permanent">Permanent job</option><option value="fixed">Fixed pay or self-employed</option></select></label>
            <label>Family situation<select className="field-control" name="family"><option value="married">Married</option><option value="unmarried">Unmarried</option></select></label>
            {field('Dependent family members', 'dependants', true, 100)}
            {field('Eligible family members claiming consortium', 'claimants', false, 100)}
          </> : <>
            {field('Loss of ability to earn (%)', 'loss', true, 100)}
            {field('Months unable to work', 'months')}
            {field('Treatment and related costs in rupees', 'treatment')}
            {field('Expected future medical costs in rupees', 'futureMedical')}
          </>}
        </div>
        <div><button className={btnPrimary}>Show estimate and working</button></div>
      </form>
      <ErrorNote error={error} />
      {result && <div aria-label="Compensation working">
        <p className="font-semibold">Estimated total: {money.format(result.total)}</p>
        <ol className="ml-5 list-decimal space-y-2">{result.steps.map(step => <li key={step.label}>
          <strong>{step.label}:</strong> {step.working}{step.amount !== undefined && ` = ${money.format(step.amount)}`}
          {step.source && <p><a href={step.source.url} target="_blank" rel="noreferrer">Source: {step.source.act}, {step.source.section}</a></p>}
        </li>)}</ol>
        <p>{notice}</p>
      </div>}
    </section>
    <section className="panel mt-4">
      <h2 className="text-lg font-semibold">Maintenance guidance</h2>
      <p>The court considers both people’s income and assets, the needs of children, housing, education and healthcare costs, the standard of living during the marriage, and each person’s ability to work. Health, caregiving and other dependants also matter. There is no amount that applies to every family.</p>
      <a href="https://indiankanoon.org/doc/117541087/?type=print" target="_blank" rel="noreferrer">Rajnesh v. Neha (2020)</a>
      <p>{notice}</p>
    </section>
    <section className="panel mt-4">
      <h2 className="text-lg font-semibold">Consider Lok Adalat or mediation</h2>
      <p>Lok Adalat can help both sides settle suitable disputes, including some motor accident and family matters. Mediation is a guided discussion where both sides can seek an agreed solution. Ask a legal aid lawyer whether your matter can use either route before agreeing to terms.</p>
      <a href="https://nalsa.gov.in/" target="_blank" rel="noreferrer">National Legal Services Authority</a>
      <p>{notice}</p>
    </section>
  </Page>;
}
