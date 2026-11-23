import { ui } from '../lib/i18n';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CASE_ROLES, LAWYER_HINT, PRECEDENT_LOADING, type CaseAnalysis, type LawyerPdf, type ResearchResult, type ResearchSentence } from '@courtplus/contracts';
import { ErrorNote, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import { LawyerNav, SignedPdfResult } from './SettlementAnalyzer';

const people = new Set(['PETITIONER', 'RESPONDENT', 'WITNESS', 'OTHER_PERSON', 'LAWYER']);
const entityGroups = [
  { title: 'People (masked)', includes: (label: string) => people.has(label) },
  { title: 'Places', includes: (label: string) => label === 'GPE' },
  { title: 'Sections and statutes', includes: (label: string) => label === 'PROVISION' || label === 'STATUTE' },
];

function ResearchPanel<T>({ title, result, children }: { title: string; result: ResearchResult<T>; children: (data: T) => ReactNode }) {
  return <section className="panel grid gap-2">
    <h2 className="text-lg font-semibold">{title}</h2>
    {result.available ? children(result.value) : <p role="status">{PRECEDENT_LOADING}</p>}
  </section>;
}

function Sentences({ rows }: { rows: ResearchSentence[] }) {
  return rows.length ? <ul className="ml-5 list-disc space-y-2">
    {rows.map(({ text, source }, index) => <li key={source + index}>
      <span dir="auto">{text}</span><small className="block text-slate-600">{source}</small>
    </li>)}
  </ul> : <p>{ui("No relevant sentences identified.")}</p>;
}

function Source({ value, label }: { value: string; label?: string }) {
  const url = URL.parse(value);
  return url?.protocol === 'https:' ? <a href={url.href} target="_blank" rel="noreferrer">{label ?? value}</a> : <span>{label ?? value}</span>;
}

export function CaseAnalyzer() {
  const [file, setFile] = useState<File>();
  const [analysis, setAnalysis] = useState<CaseAnalysis>();
  const [confirmedBy, setConfirmedBy] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [out, setOut] = useState<LawyerPdf>();
  const [busy, setBusy] = useState<'analyzing' | 'exporting'>();
  const [error, setError] = useState<string | null>(null);
  const api = window.courtplusLawyer;

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!file || !api || busy) return;
    if (!file.size || file.size > 32 * 1024 * 1024) { setError('Choose a non-empty case file up to 32 MB.'); return; }
    setBusy('analyzing'); setError(null); setAnalysis(undefined); setOut(undefined); setReviewed(false); setConfirmedBy('');
    try { setAnalysis(await api.analyzeCase({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(undefined); }
  }

  async function exportAnalysis(event: FormEvent) {
    event.preventDefault();
    if (!analysis || !api || !reviewed || !confirmedBy.trim() || busy) return;
    setBusy('exporting'); setError(null); setOut(undefined);
    try { setOut(await api.exportAnalysis(analysis.id, confirmedBy.trim())); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(undefined); }
  }

  return <ScreenPage screenId="case-analyzer" judgeHint note={ui("Case file analysis. Check each suggestion against the original.")}>
    <LawyerNav />
    <div className="grid gap-4">
      <section className="panel">
        <form className="grid gap-3" onSubmit={analyze}>
          <label>{ui("Case file (PDF, PNG or JPEG)")}<input className="field-control" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            required disabled={!api || !!busy} onChange={event => {
              setFile(event.target.files?.[0]); setAnalysis(undefined); setOut(undefined); setError(null);
            }} /></label>
          <div><button data-guide="start" className={btnPrimary} disabled={!file || !api || !!busy}>{busy === 'analyzing' ? ui("Analyzing…") : ui("Read case file")}</button></div>
        </form>
        {!api && <p role="status" className="mt-2">{ui("Open the CourtPlus desktop app to analyze a case file.")}</p>}
        {busy === 'analyzing' && <p role="status" className="mt-2">{ui("Reading and masking the case file. Scanned pages may take longer.")}</p>}
        <ErrorNote error={error} />
      </section>
      {analysis && <>
        <div className="rounded border bg-white p-4">
          <strong>{LAWYER_HINT}</strong>
          <p>{analysis.pages} {analysis.pages === 1 ? 'page' : 'pages'} read{analysis.ocr ? ' using OCR where needed' : ''}. Confirm each suggestion against the case file and cited sources.</p>
          {analysis.researchLimited && <p>{ui("Research used the first 60,000 characters of the masked document.")}</p>}
          <details className="mt-2">
            <summary className="cursor-pointer">{ui("Review masked case text")}</summary>
            <p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words" dir="auto">{analysis.maskedText}</p>
          </details>
        </div>
        <ResearchPanel title={ui("Plain-language summary")} result={analysis.summary}>{rows => <>
          <p>{ui("Key sentences selected from the case file.")}</p><Sentences rows={rows} />
        </>}</ResearchPanel>
        <ResearchPanel title={ui("Facts, issues, arguments and reasoning")} result={analysis.roles}>{groups =>
          <div className="grid gap-3 lg:grid-cols-2">{CASE_ROLES.map(role => <section className="rounded border p-3" key={role}>
            <h3 className="mb-2 font-semibold">{role}</h3><Sentences rows={groups[role]} />
          </section>)}</div>
        }</ResearchPanel>
        <section className="panel grid gap-3">
          <h2 className="text-lg font-semibold">{ui("People, places and sections")}</h2>
          {!analysis.nerAvailable && <p role="status">{ui("Local name and place recognition is unavailable. Review masking manually.")}</p>}
          <div className="grid gap-3 sm:grid-cols-3">{entityGroups.map(({ title, includes }) => {
            const entities = analysis.entities.filter(item => includes(item.label));
            return <section className="rounded border p-3" key={title}>
              <h3 className="mb-2 font-semibold">{title}</h3>
              {entities.length ? <ul className="ml-5 list-disc space-y-1">{entities.map(({ text, page }, index) =>
                <li key={text + index}><span dir="auto">{text}</span>{page && <small className="block text-slate-600">{ui("Case file, p.") + " "}{page}</small>}</li>)}</ul>
                : <p>{ui("No entries identified.")}</p>}
            </section>;
          })}</div>
        </section>
        <ResearchPanel title={ui("Suggested sections")} result={analysis.sections}>{rows => rows.length ?
          <ul className="ml-5 list-disc space-y-2">{rows.map(({ act, section, title, source, bns }) => <li key={act + section}>
            <strong>{act} §{section} · {title}</strong> · <Source value={source} label={ui("Source")} />
            {bns.map((item, index) => <small className="block" key={item.section + index}>BNS §{item.section}
              {item.note && ' · ' + item.note} · <Source value={item.source} label={'Source, p. ' + item.page} /></small>)}
          </li>)}</ul> : <p>{ui("No suggested sections met the local model threshold.")}</p>
        }</ResearchPanel>
        <ResearchPanel title={ui("Similar past cases")} result={analysis.precedents}>{rows => rows.length ?
          <ul className="space-y-3">{rows.map(row => <li className="rounded border p-3" key={row.id}>
            <h3 className="font-semibold"><Source value={row.url} label={row.title} /></h3>
            <p>{row.citation} · {row.year ?? 'Year unavailable'} · {row.court}</p>
            {row.paragraph && <p dir="auto">{row.paragraph}</p>}
          </li>)}</ul> : <p>{ui("No similar cases were retrieved.")}</p>
        }</ResearchPanel>
        <section className="panel grid gap-3">
          <h2 className="text-lg font-semibold">{ui("Weak points and procedural gaps")}</h2>
          {analysis.checklist.length ? <ul className="space-y-3">{analysis.checklist.map(item => <li className="rounded border p-3" key={item.id}>
            <h3 className="font-semibold">{item.label}</h3>
            <p>{item.check}</p>
            <blockquote className="mt-2 border-l-2 pl-3 text-sm" dir="auto">{item.evidence}</blockquote>
            <ul className="mt-2 text-sm">{item.sources.map(source => <li key={source.url + source.section}>
              <Source value={source.url} label={source.act + ' ' + source.section} />
            </li>)}</ul>
          </li>)}</ul> : <p>{ui("No checklist rules matched the extracted case text.")}</p>}
        </section>
        <section className="panel">
          <h2 className="mb-3 text-lg font-semibold">{ui("Export analysis")}</h2>
          <form className="grid gap-3" onSubmit={exportAnalysis}>
            <fieldset className="grid gap-3" disabled={!!busy}>
              <label>{ui("Reviewed by")}<input className="field-control" value={confirmedBy} onChange={event => setConfirmedBy(event.target.value)} maxLength={150} required /></label>
              <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={reviewed}
                onChange={event => setReviewed(event.target.checked)} required />{ui("I reviewed the masking, source excerpts and suggestions in this report.")}</label>
              <div><button className={btnPrimary} disabled={!reviewed || !confirmedBy.trim()}>{busy === 'exporting' ? ui("Preparing…") : ui("Export signed PDF")}</button></div>
            </fieldset>
          </form>
          <ErrorNote error={error} />
        </section>
        {out && <SignedPdfResult out={out} />}
      </>}
    </div>
  </ScreenPage>;
}
