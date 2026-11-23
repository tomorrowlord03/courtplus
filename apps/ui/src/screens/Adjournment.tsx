import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AdjournmentAdvice, AdjournmentRequest, AdjournmentSummary } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, Page } from '../components/ui';
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
  return <Page title="Adjournment analyzer" note="Priority hint - the judge decides">
    <Link to="/triage">Back to Smart triage</Link>
    <ErrorNote error={error} />
    {message && <p role="status">{message}</p>}
    {!window.courtplusJudge && <p>Open the adjournment analyzer in the desktop workspace.</p>}
    {window.courtplusJudge && profile !== undefined && profile?.role !== 'judge' &&
      <p>Choose the Judge role in your <Link to="/profile">desktop profile</Link>.</p>}
    {!data && busy && <p role="status">Loading docket…</p>}
    {data && <fieldset disabled={busy} className="grid gap-4">
      <section className="panel">
        <h2>Adjournment request</h2>
        <form className="grid gap-2" onSubmit={review} onChange={() => { setReviewed(undefined); setNextOn(''); setMessage(''); }}>
          <label>Saved case<select className={fieldStyle} required value={caseId} onChange={e => setCaseId(e.target.value)}>
            <option value="">Choose a case</option>
            {data.cases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label>
          {!data.cases.length && <p>No saved cases. <Link to="/import">Import an order</Link></p>}
          {selected?.disposed && <p>This matter is recorded as disposed. The hearing history is below.</p>}
          <fieldset disabled={!selected || selected.disposed} className="flex flex-wrap items-end gap-2">
            <label>Requesting party<input className={fieldStyle} name="party" required maxLength={200}
              placeholder="Use the same party label as in the hearing history" /></label>
            <label>Request date<input className={fieldStyle} name="date" required type="date" max={todayIST()} defaultValue={todayIST()} /></label>
            <label>Days requested<input className={fieldStyle} name="days" type="number" min={0} max={3650} required /></label>
            <label>Applicable procedure<select className={fieldStyle} name="procedure" required defaultValue="">
              <option value="">Choose procedure</option>
              <option value="cpc">Civil suit under CPC</option><option value="bnss">Inquiry or trial under BNSS</option>
              <option value="other">Other or uncertain</option></select></label>
            <button className={btnPrimary}>Review request</button>
          </fieldset>
        </form>
      </section>
      {history && <section className="panel">
        <h2>Recorded adjournments</h2>
        <History history={history} />
        {advice && <p>{advice.pattern}.</p>}
      </section>}
      {reviewed && <section className="panel">
        <h2>Legal rule and workload</h2>
        <p>{reviewed.advice.legalNote} {reviewed.advice.authority && <SourceLink authority={reviewed.advice.authority} />}</p>
        <p>Confirmed cause lists with remaining capacity for this case</p>
        {reviewed.advice.workload.length ? <ul>{reviewed.advice.workload.map(row =>
          <li key={row.date}>{row.date} · {row.available ? `${row.available} available` : 'Full'}</li>)}</ul>
          : <p>No future cause lists are confirmed. <Link to="/triage">Plan a cause list</Link></p>}
        <p><strong>Requested {reviewed.request.requestedDays} day(s)
          {reviewed.advice.suggestion && ` → suggested ${reviewed.advice.suggestion.days} day(s) (${reviewed.advice.suggestion.date})`}</strong></p>
        <p>{reviewed.advice.reason}</p>
        <form className="grid gap-2" onSubmit={decide}>
          <label>Judge’s listing date<input className={fieldStyle} type="date" required min={todayIST()} value={nextOn}
            onChange={e => setNextOn(e.target.value)} /></label>
          {reviewed.advice.suggestion && <button type="button" className={btn}
            onClick={() => setNextOn(reviewed.advice.suggestion!.date)}>Use suggested date</button>}
          <label>Hearing purpose<input className={fieldStyle} name="purpose" required maxLength={200} /></label>
          <label>Reason for decision<textarea className={fieldStyle} name="reason" required maxLength={2000} /></label>
          <button className={btnPrimary}>Record judge’s decision</button>
        </form>
      </section>}
    </fieldset>}
  </Page>;
}

function History({ history }: { history: AdjournmentSummary[] }) {
  if (!history[0]?.count) return <p>No adjournments are recorded for this case.</p>;
  return <table className="w-full text-left">
    <thead><tr><th>Party</th><th>Adjournments</th><th>Known days lost</th><th>Unknown duration</th></tr></thead>
    <tbody>{history.map((row, index) => <tr key={index}>
      <th scope="row">{row.party ?? 'Case total'}</th><td>{row.count}</td><td>{row.daysLost}</td><td>{row.unknownDays}</td>
    </tr>)}</tbody>
  </table>;
}
