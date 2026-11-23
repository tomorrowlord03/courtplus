import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseRecord, Person, ScreeningResult } from '@courtplus/contracts';
import { ChevronDown } from 'lucide-react';
import { addDays, daysBetween, todayIST, useApp } from '../lib/context';
import { Empty, ErrorNote, Page, btn, btnPrimary, errMsg } from '../components/ui';
import { HintsPanel } from '../components/HintsPanel';
import { useRole } from '../lib/roles';
import { ui } from '../lib/i18n';
import { CaseCards } from '../components/cases/CaseCards';
import { CaseText, ResultChip, cardReason, caseReference, chargeText, fullDate, plainReason, resultKind } from '../components/cases/casePresentation';

export { CaseCards as CaseList };

const meanings = {
  APPLY_NOW: 'The recorded time in custody has reached the point for an application to the court.',
  DUE_IN_N_DAYS: 'The recorded time in custody is approaching the point for an application to the court.',
  NEEDS_LAWYER_REVIEW: 'A lawyer needs to check the recorded facts and the rules that apply.',
  OUTSIDE_SCREEN: 'The recorded facts put this case outside the scope of this custody check.',
  BAIL_NOT_RELEASED: 'The records show bail was granted and the person is still in custody.',
};

function CasePanel({ title, panelRef, children }: { title: string; panelRef?: Ref<HTMLDetailsElement>; children: ReactNode }) {
  return <details ref={panelRef} className="surface-card group">
    <summary className="cursor-pointer list-none">
      <h2 className="flex items-center justify-between gap-3 text-lg font-semibold">
        {ui(title)}<ChevronDown size={18} aria-hidden="true" className="group-open:rotate-180" />
      </h2>
    </summary>
    <div className="mt-4 space-y-4">{children}</div>
  </details>;
}

function openPanel(panel: HTMLDetailsElement | null) {
  if (!panel) return;
  panel.open = true;
  panel.querySelector('summary')?.focus();
}

export function CaseView() {
  const { caseId = '' } = useParams();
  return <CaseDetails key={caseId} caseId={caseId} />;
}

function CaseDetails({ caseId }: { caseId: string }) {
  const { api, view } = useApp();
  const role = useRole();
  const [rec, setRec] = useState<CaseRecord | null | undefined>(undefined);
  const [person, setPerson] = useState<Person | null>(null);
  const [screening, setResult] = useState<ScreeningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const proofPanel = useRef<HTMLDetailsElement>(null);
  const alertsPanel = useRef<HTMLDetailsElement>(null);
  const today = todayIST();
  const [asOf, setAsOf] = useState(today);
  const result = screening?.asOf === asOf ? screening : null;

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([api.listCases(), api.listPersons()]).then(([cs, ps]) => {
      if (!live) return;
      const c = cs.find((x) => x.id === caseId) ?? null;
      setRec(c);
      setPerson(ps.find((p) => p.id === c?.personId) ?? null);
    }, (e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [api, caseId]);

  // Recompute whenever the as-of date moves; ignore stale answers.
  useEffect(() => {
    if (!rec) return;
    let live = true;
    setScreenError(null);
    setResult(null);
    api.screen(caseId, asOf).then((r) => { if (live) setResult(r); }, (e) => { if (live) setScreenError(errMsg(e)); });
    return () => { live = false; };
  }, [api, caseId, asOf, rec]);

  const minDate = useMemo(() => {
    const starts = rec?.custody.map((s) => s.start).sort() ?? [];
    return [starts[0] ?? addDays(today, -365), rec?.orderDate ?? today, today].sort()[0];
  }, [rec, today]);
  const maxDate = [addDays(today, 365), rec?.orderDate ?? today].sort()[1];

  if (rec === undefined) return <Page title={ui("Case")}><ErrorNote error={error} />{!error && <p>{ui("Loading…")}</p>}</Page>;
  if (rec === null) return <Page title={ui("Case")}><Empty title={ui("Case not found")} to="/cases" cta={ui("All cases")} /></Page>;

  const trace = (
    <CasePanel title="How we checked (proof trace)" panelRef={proofPanel}>
      <section aria-label={ui('Proof trace')}>
        <h2 className="text-lg font-semibold">{ui('Proof trace')}</h2>
        {!result && !screenError && <p className="muted">{ui('Calculating…')}</p>}
        {result && <div className="mt-2 text-sm">
          <p>{ui('Custody counted for this check:')} {result.countedCustodyDays} {ui('days out of')} {result.rawCustodyDays} {ui('recorded.')}</p>
          {result.thresholdFraction && <p>{ui('Required share of the maximum sentence:')} {result.thresholdFraction}</p>}
          {result.thresholdDate && <p>{ui('Custody threshold date:')} {fullDate(result.thresholdDate)}</p>}
          {result.ceilingUrgent && <p className="font-semibold text-red-800">{ui('▲ Custody has reached the maximum term. Urgent lawyer review.')}</p>}
          <p className="muted"><CaseText>{ui('Rules {version}. How days are counted: {convention}.', {
            version: result.ruleVersion, convention: result.dayConvention,
          })}</CaseText></p>
          {result.nalsaCategories.length > 0 && <p className="muted"><CaseText>{ui('NALSA categories: {categories}.', {
            categories: result.nalsaCategories.join(', '),
          })}</CaseText></p>}
          {result.antilCategory && <p className="muted">{ui('Antil category')} {result.antilCategory}.</p>}
          <ul className="mt-2 list-disc pl-5">
            {result.reasons.map((reason, i) => <li key={i}><CaseText>{ui(plainReason(reason))}</CaseText></li>)}
          </ul>
        </div>}
        <ol className="mt-2 space-y-3">
          {result?.trace.map((s, i) => (
            <li key={s.id} className="rounded border p-2 text-sm">
              <p className="font-medium">{i + 1}. <CaseText>{s.label}</CaseText></p>
              <p className="font-mono text-xs"><CaseText>{`${s.operation} = ${s.result}`}</CaseText></p>
              <pre className="overflow-auto text-xs text-slate-700">{JSON.stringify(s.inputs)}</pre>
              {s.warnings?.map((w) => <p key={w} className="text-amber-800">▲ <CaseText>{w}</CaseText></p>)}
              {s.authority?.map((a) => (
                <blockquote key={a.url + a.section} className="mt-1 border-l-2 pl-2 text-xs">
                  “<CaseText>{a.text}</CaseText>” — <CaseText>{`${a.act} s.${a.section}`}</CaseText>{' '}
                  <a className="text-blue-800 underline" href={a.url} target="_blank" rel="noreferrer">{ui('source')}</a>
                </blockquote>
              ))}
            </li>
          ))}
        </ol>
      </section>
    </CasePanel>
  );

  const polices = rec.custody.filter((s) => s.kind === 'police');
  const { orderDate } = rec;
  const policeAlerts = result?.alerts.filter((a) => a.kind.startsWith('POLICE_CUSTODY')) ?? [];
  const kind = result && resultKind(result);
  const reasons = (result ? [cardReason(result), ...result.reasons] : []).flatMap(reason => reason ? [plainReason(reason)] : []);
  const summaryReasons = [...new Set(reasons)].slice(0, 3);
  const reference = caseReference(rec);
  const drafts = { pathname: '/drafts', search: new URLSearchParams({ caseId }).toString() };
  const canPrepare = kind === 'APPLY_NOW' && view === 'legal_aid' && asOf === (orderDate ?? today)
    && result?.trace.find(step => step.id === 'governing-law')?.result === 'BNSS s.479';
  const alerts = (
    <CasePanel title="Alerts and deadlines" panelRef={alertsPanel}>
      <section aria-label={ui('Alerts')}>
        <h2 className="text-lg font-semibold">{ui('Alerts')}</h2>
        {result?.alerts.length === 0 && <p className="muted">{ui('No alerts as of')} {fullDate(asOf)}.</p>}
        <ul className="space-y-1 text-sm">
          {result?.alerts.map((a, i) => <li key={i}>▲ <CaseText>{ui(a.message)}</CaseText>{a.dueOn && ` ${ui('(due {date})', { date: fullDate(a.dueOn) })}`}</li>)}
        </ul>
        {view === 'utrc' && <p className="mt-2 muted">{ui('Review the proof trace before the committee meets.')}</p>}
      </section>
      <section aria-label={ui('Police custody')}>
        <h2 className="text-lg font-semibold">{ui('Police custody tracker')}</h2>
        <p className="muted">{ui('At most 15 days of police custody, inside the first 40 or 60 days of detention.')}</p>
        {polices.length === 0 && <p className="text-sm">{ui('No police custody recorded.')}</p>}
        <ul className="text-sm">{polices.map((s, i) => <li key={i}>{custodyPeriod(s)}</li>)}</ul>
        {policeAlerts.map((a, i) => <p key={i} className="text-sm text-amber-800">▲ <CaseText>{ui(a.message)}</CaseText></p>)}
      </section>
    </CasePanel>
  );

  return (
    <Page title={reference ? `${ui('Case')} ${reference}` : ui('Case')} note={[person?.alias, rec.court].filter(Boolean).join(' · ')}>
      <ErrorNote error={screenError} />
      <div className="space-y-4">
        <section aria-label={ui('Case summary')} aria-live="polite" className="surface-card space-y-3">
          {result && kind ? <>
            <ResultChip result={result} />
            <div>
              <h2>{ui('What this means')}</h2>
              <p>{ui(meanings[kind])}</p>
            </div>
            {summaryReasons.length > 0 && <div>
              <h2>{ui('Why')}</h2>
              <ul className="list-disc pl-5">{summaryReasons.map(reason =>
                <li key={reason}><CaseText>{ui(reason)}</CaseText></li>)}
              </ul>
            </div>}
            <div>
              <h2 className="mb-2">{ui('What to do next')}</h2>
              {canPrepare
                ? <Link className={btnPrimary} to={drafts}>{ui('Open s.479(3) application drafts')}</Link>
                : kind === 'BAIL_NOT_RELEASED'
                  ? <button className={btnPrimary} type="button" onClick={() => openPanel(alertsPanel.current)}>{ui('Open release follow-up')}</button>
                  : <button className={btnPrimary} type="button" onClick={() => openPanel(proofPanel.current)}>{ui('Open proof trace')}</button>}
            </div>
          </> : <p>{screenError ? ui('Screening is unavailable for this date.') : ui('Checking the recorded facts…')}</p>}
        </section>

        <section aria-label={ui('What-if date')} className="surface-card">
          <label className="block font-medium" htmlFor="asof">{ui('What if we look at this date?')} <strong data-testid="asof-value">{fullDate(asOf)}</strong></label>
          <input
            id="asof" type="range" className="w-full" min={0} max={daysBetween(minDate, maxDate)}
            value={daysBetween(minDate, asOf)}
            onChange={(e) => setAsOf(addDays(minDate, Number(e.target.value)))}
          />
          <div className="flex justify-between text-xs text-slate-600">
            <span>{fullDate(minDate)}</span>
            <div className="flex flex-wrap justify-center gap-x-3">
              <button className="underline" onClick={() => setAsOf(today)}>{ui("Back to today")}</button>
              {orderDate && <button className="underline" onClick={() => setAsOf(orderDate)}>{ui("As of order date")}</button>}
            </div>
            <span>{fullDate(maxDate)}</span>
          </div>
        </section>

        <CasePanel title="Facts confirmed from the order">
          <section aria-label={ui('Charges')}>
            <h2 className="text-lg font-semibold">{ui('Charges')}</h2>
            {rec.charges.length === 0 && <p className="text-sm text-slate-600">{ui('No charges recorded.')}</p>}
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>{ui('Charge')}</th><th>{ui('Stage')}</th><th>{ui('Verified')}</th></tr></thead>
              <tbody>
                {rec.charges.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td><CaseText>{chargeText(c)}</CaseText></td>
                    <td>{c.stage === 'FIR' ? <CaseText>{ui('FIR (as registered)')}</CaseText> : ui('Framed by court')}</td>
                    <td>
                      {c.verified
                        ? `✓ ${c.source?.verifiedBy ?? ui('verified')}${c.source?.page ? `, ${ui('p.')} ${c.source.page}` : ''}`
                        : c.stage === 'FRAMED' ? ui('✗ Not yet verified (not counted)') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-label={ui('Custody timeline')}>
            <h2 className="text-lg font-semibold">{ui('Custody timeline')}</h2>
            {rec.custody.length === 0 && <p className="text-sm text-slate-600">{ui('No custody spells recorded.')}</p>}
            <ol className="text-sm">
              {rec.custody.map((s, i) => <li key={i}>{ui(s.kind.replaceAll('_', ' '))}: {custodyPeriod(s)}</li>)}
            </ol>
            <h3 className="mt-3 font-semibold">{ui('Events')}</h3>
            <ol className="text-sm">
              {[...rec.events].sort((a, b) => a.on.localeCompare(b.on)).map((e, i) => (
                <li key={i}>{fullDate(e.on)}: <CaseText>{ui(e.kind.replaceAll('_', ' ')) + (e.note ? ` — ${e.note}` : '')}</CaseText></li>
              ))}
            </ol>
          </section>
        </CasePanel>

        {view === 'utrc' ? <>{trace}{alerts}</> : <>{alerts}{trace}</>}
        {role === 'judge' && <CasePanel title="Hints (judge decides)"><HintsPanel record={rec} /></CasePanel>}
        <CasePanel title="Documents">
          <p>{orderDate ? `${ui('Order dated')} ${fullDate(orderDate)}` : ui('No order date recorded.')}</p>
          {view === 'legal_aid' && <Link to={drafts} className={btn}>{ui('Prepare drafts for this case')}</Link>}
        </CasePanel>
      </div>
    </Page>
  );
}

function custodyPeriod(spell: CaseRecord['custody'][number]): string {
  return ui('{start} to {end}', {
    start: fullDate(spell.start),
    end: spell.end ? fullDate(spell.end) : ui(spell.ongoing ? 'ongoing' : 'end date unknown'),
  });
}
