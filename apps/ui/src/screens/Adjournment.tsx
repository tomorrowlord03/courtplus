import { ui } from '../lib/i18n';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AdjournmentAdvice, AdjournmentRequest, AdjournmentSummary } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import { todayIST } from '../lib/context';
import { fieldStyle, SourceLink, tomorrowIST, useCourt } from './Triage';

export function Adjournment() {
  const [params] = useSearchParams();
  const [caseId, setCaseId] = useState(params.get('case') ?? '');
  const [reviewed, setReviewed] = useState<{ request: AdjournmentRequest; advice: AdjournmentAdvice }>();
  const [nextOn, setNextOn] = useState('');
  const [message, setMessage] = useState('');
  const { data, busy, error, reload, profile } = useCourt(tomorrowIST());
  const selected = data?.cases.find(item => item.id === caseId);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request: AdjournmentRequest = {
      caseId, party: String(form.get('party')), date: String(form.get('date')),
      requestedDays: Number(form.get('days')), procedure: form.get('procedure') as AdjournmentRequest['procedure'],
    };
    const result = await reload({ kind: 'advice', request });
    if (result?.advice) setReviewed({ request, advice: result.advice });
  }

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewed) return;
    const form = new FormData(event.currentTarget);
    const result = await reload({ kind: 'decision', decision: {
      ...reviewed.request, nextOn, purpose: String(form.get('purpose')), reason: String(form.get('reason')),
    } });
    if (result) {
      setMessage(`Decision recorded. Matter listed on ${nextOn}.`);
      setReviewed(undefined);
      setNextOn('');
    }
  }

  const advice = reviewed?.advice;
  const history = advice?.history ?? selected?.adjournments;
  return <ScreenPage screenId="adjournment" note={ui("Moving a hearing to a later date (adjournment).")} judgeHint>
    <Link to="/triage">{ui("Back to hearing priorities")}</Link>
    <ErrorNote error={error} />
    {message && <p role="status">{message}</p>}
    {!window.courtplusJudge && <p>{ui("Open the Court+ desktop app to check a request to move a hearing.")}</p>}
    {window.courtplusJudge && profile !== undefined && profile?.role !== 'judge' &&
      <p>Choose the Judge role in your <Link to="/profile">{ui("desktop profile")}</Link>.</p>}
    {!data && busy && <p role="status">{ui("Loading docket…")}</p>}
    {data && <fieldset disabled={busy} className="grid gap-4">
      <section className="panel">
        <h2>{ui("Adjournment request")}</h2>
        <form className="grid gap-2" onSubmit={review} onChange={() => { setReviewed(undefined); setNextOn(''); setMessage(''); }}>
          <label>{ui("Saved case")}<select className={fieldStyle} required value={caseId} onChange={e => setCaseId(e.target.value)}>
            <option value="">{ui("Choose a case")}</option>
            {data.cases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          {!data.cases.length && <p>{ui("No saved cases.") + " "}<Link to="/import">{ui("Import an order")}</Link></p>}
          {selected?.disposed && <p>{ui("This matter is recorded as disposed. The hearing history is below.")}</p>}
          <fieldset disabled={!selected || selected.disposed} className="flex flex-wrap items-end gap-2">
            <label>{ui("Requesting party")}<input className={fieldStyle} name="party" required maxLength={200}
              placeholder={ui("Use the same party label as in the hearing history")} /></label>
            <label>{ui("Request date")}<input className={fieldStyle} name="date" required type="date" max={todayIST()} defaultValue={todayIST()} /></label>
            <label>{ui("Days requested")}<input className={fieldStyle} name="days" type="number" min={0} max={3650} required /></label>
            <label>{ui("Applicable procedure")}<select className={fieldStyle} name="procedure" required defaultValue="">
              <option value="">{ui("Choose procedure")}</option>
              <option value="cpc">{ui("Civil suit under CPC")}</option><option value="bnss">{ui("Inquiry or trial under BNSS")}</option>
              <option value="other">{ui("Other or uncertain")}</option></select></label>
            <button data-guide="start" className={btnPrimary}>{ui("Review request")}</button>
          </fieldset>
        </form>
      </section>
      {history && <section className="panel">
        <h2>{ui("Recorded adjournments")}</h2>
        <History history={history} />
        {advice && <p>{advice.pattern}.</p>}
      </section>}
      {reviewed && <section className="panel">
        <h2>{ui("Legal rule and workload")}</h2>
        <p>{reviewed.advice.legalNote} {reviewed.advice.authority && <SourceLink authority={reviewed.advice.authority} />}</p>
        <p>{ui("Confirmed cause lists with remaining capacity for this case")}</p>
        {reviewed.advice.workload.length ? <ul>{reviewed.advice.workload.map(row =>
          <li key={row.date}>{row.date} · {row.available ? `${row.available} available` : ui("Full")}</li>)}</ul>
          : <p>{ui("No future cause lists are confirmed.") + " "}<Link to="/triage">{ui("Plan a cause list")}</Link></p>}
        <p><strong>{ui("Requested") + " "}{reviewed.request.requestedDays}{" " + ui("day(s)")}{reviewed.advice.suggestion && ` → suggested ${reviewed.advice.suggestion.days} day(s) (${reviewed.advice.suggestion.date})`}</strong></p>
        <p>{reviewed.advice.reason}</p>
        <form className="grid gap-2" onSubmit={decide}>
          <label>{ui("Judge’s listing date")}<input className={fieldStyle} type="date" required min={todayIST()} value={nextOn}
            onChange={e => setNextOn(e.target.value)} /></label>
          {reviewed.advice.suggestion && <button type="button" className={btn}
            onClick={() => setNextOn(reviewed.advice.suggestion!.date)}>{ui("Use suggested date")}</button>}
          <label>{ui("Hearing purpose")}<input className={fieldStyle} name="purpose" required maxLength={200} /></label>
          <label>{ui("Reason for decision")}<textarea className={fieldStyle} name="reason" required maxLength={2000} /></label>
          <button className={btnPrimary}>{ui("Record judge’s decision")}</button>
        </form>
      </section>}
    </fieldset>}
  </ScreenPage>;
}

function History({ history }: { history: AdjournmentSummary[] }) {
  if (!history[0]?.count) return <p>{ui("No adjournments are recorded for this case.")}</p>;
  return <table className="w-full text-left">
    <thead><tr><th>{ui("Party")}</th><th>{ui("Adjournments")}</th><th>{ui("Known days lost")}</th><th>{ui("Unknown duration")}</th></tr></thead>
    <tbody>{history.map((row, index) => <tr key={index}>
      <th scope="row">{row.party ?? 'Case total'}</th><td>{row.count}</td><td>{row.daysLost}</td><td>{row.unknownDays}</td>
    </tr>)}</tbody>
  </table>;
}
