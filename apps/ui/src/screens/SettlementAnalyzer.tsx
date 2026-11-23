import { ui } from '../lib/i18n';
import { createElement, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LAWYER_HINT, PRECEDENT_LOADING, type LawyerPdf, type LawyerToolsApi, type MactInput, type MactResult, type PastAward, type ResearchResult, type SettlementProposal } from '@courtplus/contracts';
import { calculateMact } from '../../../../packages/engine/src/mact';
import { ErrorNote, btn, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';

declare global {
  interface Window {
    courtplusLawyer?: LawyerToolsApi;
  }
}

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const formatMoney = (amount: number) => rupees.format(amount);
const indianDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function LawyerNav() {
  return <nav className="mb-4 flex flex-wrap gap-2" aria-label={ui("Lawyer tools")}>
    <Link className={btn} to="/lawyer">{ui("What courts awarded before")}</Link>
    <Link className={btn} to="/lawyer/case">{ui("Review a case file")}</Link>
  </nav>;
}

export function SignedPdfResult({ out }: { out: LawyerPdf }) {
  return <section className="rounded border p-4" aria-label={ui("Export result")}>
    <h2 className="font-semibold">{ui("Signed PDF ready")}</h2>
    <dl className="break-all text-sm">
      <dt>PDF</dt><dd>{out.pdfPath}</dd>
      <dt>{ui("Receipt")}</dt><dd>{out.receiptPath}</dd>
      <dt>{ui("Verification manifest")}</dt><dd>{out.manifestPath}</dd>
    </dl>
    <Link className="mt-2 inline-block" to="/verify">{ui("Check the signed file")}</Link>
  </section>;
}

function NumberField({ label, name, required = false, max, integer = false, optional = false }: {
  label: string; name: string; required?: boolean; max?: number; integer?: boolean; optional?: boolean;
}) {
  return <label>{label}<input className="field-control" name={name} type="number" min="0" max={max}
    step={integer ? '1' : '0.01'} required={required} defaultValue={required || optional ? undefined : 0} /></label>;
}

function MactCalculator() {
  const [kind, setKind] = useState<MactInput['kind']>('fatal');
  const [result, setResult] = useState<MactResult>();
  const [error, setError] = useState<string | null>(null);

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const string = (key: string) => String(data.get(key) ?? '');
    const number = (key: string) => Number(string(key));
    const base = { age: number('age'), monthlyIncome: number('monthlyIncome'), annualIncomeTax: number('annualIncomeTax') };
    const input: MactInput = kind === 'fatal' ? {
      ...base, kind, employment: string('employment') as Extract<MactInput, { kind: 'fatal' }>['employment'],
      familyStatus: string('familyStatus') as Extract<MactInput, { kind: 'fatal' }>['familyStatus'],
      dependants: number('dependants'), consortiumClaimants: number('consortiumClaimants'), valuationOn: string('valuationOn'),
      ...(string('deduction') && { reviewedDeductionPercent: number('deduction') }),
    } : {
      ...base, kind, functionalLossPercent: number('functionalLossPercent'),
      reviewedFutureProspectsPercent: number('reviewedFutureProspectsPercent'), monthsUnableToWork: number('monthsUnableToWork'),
      treatment: number('treatment'), futureMedical: number('futureMedical'), pain: number('pain'),
      amenities: number('amenities'), shortenedLife: number('shortenedLife'),
    };
    try { setResult(calculateMact(input)); setError(null); }
    catch (error) { setResult(undefined); setError(errMsg(error)); }
  }

  return <section className="panel grid gap-4" aria-label={ui("Motor accident compensation")}>
    <h2 className="text-lg font-semibold">{ui("Motor accident compensation (MACT)")}</h2>
    <p>{ui("Enter amounts in rupees and use the age at the accident. The calculation covers the principal compensation heads. Confirm disputed inputs and the valuation date before relying on the working.")}</p>
    <form onSubmit={run} className="grid gap-4" onChange={() => { setResult(undefined); setError(null); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>{ui("Claim type")}<select className="field-control" value={kind} onChange={event => setKind(event.target.value === 'injury' ? 'injury' : 'fatal')}>
          <option value="fatal">{ui("Fatal accident")}</option><option value="injury">{ui("Personal injury")}</option>
        </select></label>
        <NumberField label={ui("Age (completed years)")} name="age" required integer />
        <NumberField label={ui("Established monthly income before tax")} name="monthlyIncome" required />
        <NumberField label={ui("Annual income tax on that income")} name="annualIncomeTax" />
      </div>
      {kind === 'fatal' ? <div key="fatal" className="grid gap-3 sm:grid-cols-2">
        <label>{ui("Employment")}<select className="field-control" name="employment">
          <option value="permanent">{ui("Permanent employment")}</option><option value="fixed-or-self-employed">{ui("Fixed salary or self-employed")}</option>
        </select></label>
        <label>{ui("Family circumstances")}<select className="field-control" name="familyStatus">
          <option value="married">{ui("Married")}</option><option value="unmarried">{ui("Unmarried")}</option>
          <option value="unmarried-dependent-family">{ui("Unmarried with a large dependent family (reviewed exception)")}</option>
        </select></label>
        <NumberField label={ui("Dependent family members")} name="dependants" required integer />
        <NumberField label={ui("Reviewed personal deduction override (%)")} name="deduction" max={100} optional />
        <NumberField label={ui("Eligible consortium claimants")} name="consortiumClaimants" integer />
        <label>{ui("Conventional heads valuation date")}<input className="field-control" type="date" name="valuationOn"
          required min="2017-10-31" defaultValue={indianDate()} /></label>
      </div> : <div key="injury" className="grid gap-3 sm:grid-cols-2">
        <p className="sm:col-span-2">{ui("Enter the reviewed loss of earning capacity and evidence-supported amounts. Severe injuries may justify future medical, amenities or shortened-life amounts where supported by evidence.")}</p>
        <NumberField label={ui("Functional loss of earning capacity (%)")} name="functionalLossPercent" max={100} />
        <NumberField label={ui("Reviewed future prospects addition (%)")} name="reviewedFutureProspectsPercent" max={100} />
        <NumberField label={ui("Months unable to earn during treatment")} name="monthsUnableToWork" />
        <NumberField label={ui("Treatment, transport, attendant and related expenses")} name="treatment" />
        <NumberField label={ui("Future medical costs")} name="futureMedical" />
        <NumberField label={ui("Pain, suffering and trauma")} name="pain" />
        <NumberField label={ui("Loss of amenities or marriage prospects")} name="amenities" />
        <NumberField label={ui("Shortened life expectancy")} name="shortenedLife" />
      </div>}
      <div><button className={btnPrimary}>{ui("Calculate compensation")}</button></div>
    </form>
    <ErrorNote error={error} />
    {result && <ol className="ml-5 list-decimal space-y-2" aria-label={ui("Compensation working")}>
      {result.steps.map(({ label, working, amount, source }) => <li className="break-words" key={label}>
        <strong>{label}</strong> · {working}{amount !== undefined && <> = <strong>{formatMoney(amount)}</strong></>}
        {source && <div className="text-sm"><a href={source.url} target="_blank" rel="noreferrer">{source.act}, {source.section}</a></div>}
      </li>)}
    </ol>}
  </section>;
}

function Awards() {
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<ResearchResult<PastAward[]>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = window.courtplusLawyer;

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!api || busy || description.trim().length < 3) return;
    setBusy(true); setResult(undefined); setError(null);
    try { setResult(await api.pastAwards(description.trim())); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  const matches = new Map<string, Map<PastAward['basis'], Set<number>>>();
  if (result?.available) for (const row of result.value) {
    const id = row.precedent.citation === 'Citation unavailable' ? row.precedent.id
      : [row.precedent.court, row.precedent.year, row.precedent.citation].join('|');
    const byBasis = matches.get(id) ?? new Map();
    const amounts = byBasis.get(row.basis) ?? new Set<number>();
    row.amounts.forEach(amount => amounts.add(amount));
    byBasis.set(row.basis, amounts);
    matches.set(id, byBasis);
  }
  const ranges = (['lump sum', 'monthly', 'annual'] as const).flatMap(basis => {
    const amounts = [...matches.values()].flatMap(byBasis => {
      const match = byBasis.get(basis);
      return match?.size === 1 ? [...match] : [];
    });
    return amounts.length >= 5 ? [{ basis, count: amounts.length, min: Math.min(...amounts), max: Math.max(...amounts) }] : [];
  });
  return <section className="panel grid gap-3">
    <h2 className="text-lg font-semibold">{ui("Past awards")}</h2>
    <p>{LAWYER_HINT}</p>
    <form className="grid gap-3" onSubmit={run}>
      <label>{ui("Case description")}<textarea className="field-control" rows={3} required minLength={3} maxLength={10000} value={description}
        disabled={!api || busy} onChange={event => { setDescription(event.target.value); setResult(undefined); }} /></label>
      <div><button data-guide="start" className={btnPrimary} disabled={!api || busy || description.trim().length < 3}>{busy ? ui("Searching…") : ui("Find past awards")}</button></div>
    </form>
    <ErrorNote error={error} />
    {(!api || result?.available === false) && <p role="status">{PRECEDENT_LOADING}</p>}
    {result?.available && (result.value.length ? <>
      {ranges.length > 0 && <div><strong>{ui("What courts awarded in similar past cases (not a prediction)")}</strong>
        <ul>{ranges.map(({ basis, count, min, max }) => <li key={basis}>
          {formatMoney(min)} to {formatMoney(max)} across {count} judgments with one comparable {basis} award each.
        </li>)}</ul></div>}
      <ul className="space-y-3">
        {result.value.map(({ precedent, amounts, sentence, basis }) => <li key={precedent.id + sentence} className="rounded border p-3">
          <h3 className="font-semibold">{precedent.url ? <a href={precedent.url} target="_blank" rel="noreferrer">{precedent.title}</a> : precedent.title}</h3>
          <p>{precedent.citation} · {precedent.year ?? 'Year unavailable'} · {precedent.court}</p>
          <p dir="auto">{sentence}</p>
          <p className="font-medium">{amounts.map(formatMoney).join(', ')}{basis !== 'unclear' && ' · ' + basis}</p>
        </li>)}
      </ul>
    </> : <p role="status">{ui("No award amounts were found in the available text of the retrieved judgments.")}</p>)}
  </section>;
}

export function SettlementAnalyzer() {
  return <ScreenPage screenId="settlement" judgeHint>
    <LawyerNav />
    <div className="grid gap-4">
      <MactCalculator />
      <section className="panel grid gap-3">
        <h2 className="text-lg font-semibold">{ui("Maintenance guidance")}</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>Consider each party’s circumstances, the standard of living during the marriage and the reasonable needs of the applicant and dependent children.</li>
          <li>Review both parties’ income and assets, the applicant’s ability to support themself, the other party’s ability to pay, liabilities and other legal dependants.</li>
          <li>Consider age, health or disability, duration of marriage, past employment and opportunities forgone for caregiving.</li>
          <li>Check housing, education, healthcare and litigation costs, and account for any overlapping maintenance awards.</li>
        </ul>
        <p><a href="https://indiankanoon.org/doc/117541087/?type=print" target="_blank" rel="noreferrer">Rajnesh v. Neha (2020), Part B–III and Final Directions VI(c)</a></p>
        <p><strong>{ui("Case-specific benchmark.")}</strong> The Court discussed 25% of the paying spouse’s net salary, then adjusted the award for the family circumstances. Consider the benchmark alongside the factors above. The court sets the amount for each case.</p>
        <p><a href="https://indiankanoon.org/doc/87785076/" target="_blank" rel="noreferrer">Kalyan Dey Chowdhury v. Rita Dey Chowdhury (2017), ¶¶16–17</a></p>
      </section>
      <Awards />
      <section className="panel grid gap-4">
        <h2 className="text-lg font-semibold">{ui("Settlement routes")}</h2>
        <div>
          <h3 className="font-semibold">{ui("Lok Adalat")}</h3>
          <p>Pending and pre-litigation disputes within the forum’s jurisdiction can be referred for compromise. Examples include suitable civil, money, motor accident and family disputes, and compoundable offences. The forum has no jurisdiction over non-compoundable offences. A settlement award is deemed a civil court decree, is final and binding on the parties, and carries no appeal under the Act. Court fees paid in a pending case referred to Lok Adalat are refunded when the case settles there.</p>
          <a href="https://www.indiacode.nic.in/handle/123456789/17040?locale=en" target="_blank" rel="noreferrer">Legal Services Authorities Act 1987, §§19–21</a>
        </div>
        <div>
          <h3 className="font-semibold">{ui("Mediation")}</h3>
          <p>Civil, commercial and appropriate family disputes can be suitable for voluntary settlement, including court referral under CPC §89. Check the Mediation Act’s First Schedule for excluded matters such as prosecution for criminal offences, claims against protected persons and certain public or regulatory disputes. Check current commencement notifications and any statutory requirements for the forum and case type.</p>
          <a href="https://www.indiacode.nic.in/handle/123456789/19637" target="_blank" rel="noreferrer">Mediation Act 2023, §§5–7 and First Schedule</a>
          {' · '}<a href="https://www.indiacode.nic.in/bitstream/123456789/3966/1/Code_of_Civil_Procedure.pdf" target="_blank" rel="noreferrer">Code of Civil Procedure 1908, §89</a>
        </div>
        <div><Link className={btnPrimary} to="/drafts/settlement">{ui("Draft settlement proposal")}</Link></div>
      </section>
    </div>
  </ScreenPage>;
}

const previewTags = new Set(['p', 'h1', 'h2', 'div']);
function previewBody(html: string): ReactNode {
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
  function nodeBody(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element) || !previewTags.has(node.localName)) return null;
    return createElement(node.localName === 'h1' || node.localName === 'h2' ? 'h3' : node.localName, { key },
      ...Array.from(node.childNodes, nodeBody));
  }
  return main && Array.from(main.childNodes, nodeBody);
}

export function SettlementDraft() {
  const [params] = useSearchParams();
  const [proposal, setProposal] = useState<SettlementProposal>({
    route: 'Lok Adalat', caseReference: params.get('caseId') ?? '', parties: '', terms: '', deadlines: '',
  });
  const [preview, setPreview] = useState<{ for: SettlementProposal; html: string }>();
  const [out, setOut] = useState<LawyerPdf>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = window.courtplusLawyer;
  useEffect(() => {
    if (!api) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.previewSettlement(proposal).then(html => { if (active) setPreview({ for: proposal, html }); },
        error => { if (active) setError(errMsg(error)); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [api, proposal]);

  function change<K extends keyof SettlementProposal>(key: K, value: SettlementProposal[K]) {
    setProposal(previous => ({ ...previous, [key]: value }));
    setOut(undefined); setError(null);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!api || busy) return;
    setBusy(true); setOut(undefined); setError(null);
    try { setOut(await api.exportSettlement(proposal)); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  return <ScreenPage screenId="settlement-draft" note={ui("Review the terms with the parties before sending the proposal.")}>
    <div className="mb-4 flex gap-2"><Link className={btn} to="/drafts">{ui("All drafts")}</Link><Link className={btn} to="/lawyer">{ui("Settlement routes")}</Link></div>
    <ErrorNote error={error} />
    {!api && <p role="status">{ui("Open the CourtPlus desktop app to preview and export a settlement proposal.")}</p>}
    <div className="draft-studio">
      <section className="panel">
        <h2 className="mb-3 text-lg font-semibold">{ui("Settlement proposal")}</h2>
        <form onSubmit={run}>
          <fieldset className="grid gap-3" disabled={!api || busy}>
            <label>{ui("Settlement route")}<select className="field-control" value={proposal.route} onChange={event => change('route', event.target.value === 'Mediation' ? 'Mediation' : 'Lok Adalat')}>
              <option>{ui("Lok Adalat")}</option><option>{ui("Mediation")}</option>
            </select></label>
            <label>{ui("Case reference (optional)")}<input className="field-control" value={proposal.caseReference} maxLength={250} onChange={event => change('caseReference', event.target.value)} /></label>
            <label>{ui("Parties")}<textarea className="field-control" value={proposal.parties} maxLength={2000} required onChange={event => change('parties', event.target.value)} /></label>
            <label>{ui("Proposed terms")}<textarea className="field-control" rows={5} value={proposal.terms} maxLength={12000} required onChange={event => change('terms', event.target.value)} /></label>
            <label>{ui("Deadlines and performance (optional)")}<textarea className="field-control" value={proposal.deadlines} maxLength={3000} onChange={event => change('deadlines', event.target.value)} /></label>
            <div><button data-guide="start" className={btnPrimary} disabled={!proposal.parties.trim() || !proposal.terms.trim()}>{busy ? ui("Preparing…") : ui("Export signed PDF")}</button></div>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h2 className="mb-3 text-lg font-semibold">{ui("Live preview")}</h2>
        <div className="draft-paper">{preview?.for === proposal ? previewBody(preview.html) : api && !error && <p role="status">{ui("Preparing preview…")}</p>}</div>
      </section>
    </div>
    {out && <SignedPdfResult out={out} />}
  </ScreenPage>;
}
