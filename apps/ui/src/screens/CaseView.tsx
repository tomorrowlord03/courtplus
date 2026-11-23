import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseRecord, Person, ScreeningResult } from '@courtplus/contracts';
import { addDays, daysBetween, todayIST, useApp } from '../lib/context';
import { Empty, ErrorNote, Page, errMsg } from '../components/ui';

const STATUS_TEXT: Record<ScreeningResult['status'], string> = {
  APPLY_NOW: '● Apply now',
  DUE_IN_N_DAYS: '◐ Due soon',
  NEEDS_LAWYER_REVIEW: '▲ Needs a lawyer to review',
  OUTSIDE_SCREEN: '○ Outside this screen',
};

export function CaseList() {
  const { api } = useApp();
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.listCases().then(setCases, (e) => setError(errMsg(e))); }, [api]);
  return (
    <Page title="Cases">
      <ErrorNote error={error} />
      {cases && cases.length === 0 && <Empty title="No cases yet" hint="Import a court order to begin." to="/import" cta="Import order" />}
      <ul className="space-y-1">
        {cases?.map((c) => (
          <li key={c.id}><Link className="text-blue-800 underline" to={`/case/${c.id}`}>{c.caseNo ?? c.cnr ?? c.id}</Link> {c.court && `· ${c.court}`}</li>
        ))}
      </ul>
    </Page>
  );
}

export function CaseView() {
  const { caseId = '' } = useParams();
  const { api, view } = useApp();
  const [rec, setRec] = useState<CaseRecord | null | undefined>(undefined);
  const [person, setPerson] = useState<Person | null>(null);
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();
  const [asOf, setAsOf] = useState(today);

  useEffect(() => {
    Promise.all([api.listCases(), api.listPersons()]).then(([cs, ps]) => {
      const c = cs.find((x) => x.id === caseId) ?? null;
      setRec(c);
      setPerson(ps.find((p) => p.id === c?.personId) ?? null);
    }, (e) => setError(errMsg(e)));
  }, [api, caseId]);

  // Recompute whenever the as-of date moves; ignore stale answers.
  useEffect(() => {
    if (!rec) return;
    let live = true;
    api.screen(caseId, asOf).then((r) => live && setResult(r), (e) => live && setError(errMsg(e)));
    return () => { live = false; };
  }, [api, caseId, asOf, rec]);

  const minDate = useMemo(() => {
    const starts = rec?.custody.map((s) => s.start).sort() ?? [];
    return starts[0] ?? addDays(today, -365);
  }, [rec, today]);
  const maxDate = addDays(today, 365);

  if (rec === undefined) return <Page title="Case"><ErrorNote error={error} />{!error && <p>Loading…</p>}</Page>;
  if (rec === null) return <Page title="Case"><Empty title="Case not found" to="/cases" cta="All cases" /></Page>;

  const trace = (
    <section aria-label="Proof trace" className={`rounded border bg-white p-3 ${view === 'utrc' ? 'order-1' : 'order-3'}`}>
      <h2 className="text-lg font-semibold">Proof trace</h2>
      {!result && <p className="text-sm text-slate-600">Calculating…</p>}
      <ol className="mt-2 space-y-3">
        {result?.trace.map((s, i) => (
          <li key={s.id} className="rounded border p-2 text-sm">
            <p className="font-medium">{i + 1}. {s.label}</p>
            <p className="font-mono text-xs">{s.operation} = {s.result}</p>
            <pre className="overflow-auto text-xs text-slate-700">{JSON.stringify(s.inputs)}</pre>
            {s.warnings?.map((w) => <p key={w} className="text-amber-800">▲ {w}</p>)}
            {s.authority?.map((a) => (
              <blockquote key={a.url + a.section} className="mt-1 border-l-2 pl-2 text-xs">
                “{a.text}” — {a.act} s.{a.section}{' '}
                <a className="text-blue-800 underline" href={a.url} target="_blank" rel="noreferrer">source</a>
              </blockquote>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );

  const polices = rec.custody.filter((s) => s.kind === 'police');
  const policeAlerts = result?.alerts.filter((a) => a.kind.startsWith('POLICE_CUSTODY')) ?? [];

  return (
    <Page title={`Case ${rec.caseNo ?? rec.cnr ?? rec.id}`} note={[rec.court, person?.alias].filter(Boolean).join(' · ')}>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-4">
        <section aria-label="What-if date" className="order-2 rounded border bg-white p-3">
          <label className="block font-medium" htmlFor="asof">What if we look at this date? <strong data-testid="asof-value">{asOf}</strong></label>
          <input
            id="asof" type="range" className="w-full" min={0} max={daysBetween(minDate, maxDate)}
            value={daysBetween(minDate, asOf)}
            onChange={(e) => setAsOf(addDays(minDate, Number(e.target.value)))}
          />
          <div className="flex justify-between text-xs text-slate-600">
            <span>{minDate}</span>
            <button className="underline" onClick={() => setAsOf(today)}>Back to today</button>
            <span>{maxDate}</span>
          </div>
          {result && (
            <div className="mt-3" aria-live="polite">
              <p className="text-xl font-bold">{STATUS_TEXT[result.status]}</p>
              <p className="text-sm">
                Custody counted: {result.countedCustodyDays} days (raw {result.rawCustodyDays}).
                {result.thresholdFraction && ` Threshold ${result.thresholdFraction}`}
                {result.thresholdDate && ` reached on ${result.thresholdDate}`}.
                {result.dueInDays !== undefined && ` Due in ${result.dueInDays} days.`}
              </p>
              {result.ceilingUrgent && <p className="font-semibold text-red-800">▲ Custody has reached the maximum term. Urgent lawyer review.</p>}
              <ul className="mt-1 list-disc pl-5 text-sm">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-1 text-xs text-slate-600">
                Rules {result.ruleVersion}. Day convention: {result.dayConvention}.
                {result.nalsaCategories.length > 0 && ` NALSA categories: ${result.nalsaCategories.join(', ')}.`}
                {result.antilCategory && ` Antil category ${result.antilCategory}.`}
              </p>
            </div>
          )}
        </section>

        {trace}

        <section aria-label="Alerts" className={`rounded border bg-white p-3 ${view === 'utrc' ? 'order-2' : 'order-1'}`}>
          <h2 className="text-lg font-semibold">Alerts</h2>
          {result?.alerts.length === 0 && <p className="text-sm text-slate-600">No alerts as of {asOf}.</p>}
          <ul className="space-y-1 text-sm">
            {result?.alerts.map((a, i) => <li key={i}>▲ {a.message}{a.dueOn && ` (due ${a.dueOn})`}</li>)}
          </ul>
          {view === 'legal_aid'
            ? <Link to="/drafts" className="mt-2 inline-block text-blue-800 underline">Prepare drafts for this case</Link>
            : <p className="mt-2 text-sm text-slate-600">Review queue: check the proof trace below each alert before the committee meets.</p>}
        </section>

        <section aria-label="Charges" className="order-4 rounded border bg-white p-3">
          <h2 className="text-lg font-semibold">Charges</h2>
          {rec.charges.length === 0 && <p className="text-sm text-slate-600">No charges recorded.</p>}
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Charge</th><th>Stage</th><th>Verified</th></tr></thead>
            <tbody>
              {rec.charges.map((c, i) => (
                <tr key={i} className="border-t">
                  <td>{c.act} {c.section}{c.subsection ? `(${c.subsection})` : ''}</td>
                  <td>{c.stage === 'FIR' ? 'FIR (as registered)' : 'Framed by court'}</td>
                  <td>
                    {c.verified
                      ? `✓ ${c.source?.verifiedBy ?? 'verified'}${c.source?.page ? `, p. ${c.source.page}` : ''}`
                      : c.stage === 'FRAMED' ? '✗ Not yet verified (not counted)' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Custody timeline" className="order-5 rounded border bg-white p-3">
          <h2 className="text-lg font-semibold">Custody timeline</h2>
          {rec.custody.length === 0 && <p className="text-sm text-slate-600">No custody spells recorded.</p>}
          <ol className="text-sm">
            {rec.custody.map((s, i) => <li key={i}>{s.kind.replace('_', ' ')}: {s.start} to {s.end ?? (s.ongoing ? 'ongoing' : '?')}</li>)}
          </ol>
          <h3 className="mt-3 font-semibold">Events</h3>
          <ol className="text-sm">
            {[...rec.events].sort((a, b) => a.on.localeCompare(b.on)).map((e, i) => (
              <li key={i}>{e.on}: {e.kind.replace('_', ' ')}{e.note ? ` — ${e.note}` : ''}</li>
            ))}
          </ol>
        </section>

        <section aria-label="Police custody" className="order-6 rounded border bg-white p-3">
          <h2 className="text-lg font-semibold">Police custody tracker</h2>
          <p className="text-sm text-slate-600">At most 15 days of police custody, inside the first 40 or 60 days of detention.</p>
          {polices.length === 0 && <p className="text-sm">No police custody recorded.</p>}
          <ul className="text-sm">{polices.map((s, i) => <li key={i}>{s.start} to {s.end ?? 'ongoing'}</li>)}</ul>
          {policeAlerts.map((a, i) => <p key={i} className="text-sm text-amber-800">▲ {a.message}</p>)}
        </section>
      </div>
    </Page>
  );
}
