import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Authority, CaseMeta, CourtAction, CourtSettings, CourtWorkspace, CourtWorkspaceApi, Hearing,
  PriorityOverride } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg, Page } from '../components/ui';
import { addDays, todayIST, useApp } from '../lib/context';

declare global {
  interface Window { courtplusJudge?: CourtWorkspaceApi }
}

const caseTypes: Record<CaseMeta['caseType'], string> = {
  criminal: 'Criminal', civil: 'Civil', family: 'Family', MACT: 'Motor accident claim',
  cheque: 'NI Act cheque complaint', other: 'Other',
};
const partyFlags: Record<CaseMeta['partyFlags'][number], string> = {
  seniorCitizen: 'Senior citizen', woman: 'Woman', child: 'Child', disability: 'Disability', undertrial: 'Undertrial',
};
const listingBasis = { adjournment: 'Adjournment decision', oldest: 'Oldest-case allocation', priority: 'Priority order' };
export const fieldStyle = 'field-control';

export function tomorrowIST(): string {
  return addDays(todayIST(), 1);
}

export function useCourt(date: string) {
  const { profile } = useApp();
  const judge = profile?.role === 'judge';
  const [data, setData] = useState<CourtWorkspace>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const reload = useCallback(async (action: CourtAction = { kind: 'read' }) => {
    if (!window.courtplusJudge || !judge || !date) return;
    const request = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await window.courtplusJudge.courtWorkspace(date, action);
      if (request === sequence.current) setData(result);
      return result;
    } catch (cause) {
      if (request === sequence.current) setError(errMsg(cause));
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }, [date, judge]);
  useEffect(() => {
    if (!judge) { setData(undefined); setBusy(false); }
    void reload();
    return () => { sequence.current++; };
  }, [judge, reload]);
  return { data: judge ? data : undefined, error, busy, reload, profile };
}

export function SourceLink({ authority }: { authority: Authority }) {
  return <a href={authority.url} target="_blank" rel="noreferrer" title={authority.text}>
    {authority.act} {authority.section}
  </a>;
}

type Submit = (action: CourtAction) => Promise<CourtWorkspace | undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const optionalDays = (form: FormData, key: string) => text(form, key) ? Number(text(form, key)) : undefined;

export function Triage() {
  const [date, setDate] = useState(tomorrowIST);
  const { data, error, busy, reload, profile } = useCourt(date);
  const [selected, setSelected] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterFlag, setFilterFlag] = useState('');
  const [query, setQuery] = useState('');
  const [pinnedCase, setPinnedCase] = useState('');
  const [message, setMessage] = useState('');
  const selectedCase = data?.cases.find(item => item.id === selected);
  const meta = data?.metadata.find(item => item.caseId === selected);
  const labels = new Map(data?.cases.map(item => [item.id, item.label]));
  const visible = data?.ranked.filter(({ meta }) =>
    (!filterType || meta.caseType === filterType) &&
    (!filterFlag || (filterFlag === 'custody' ? meta.partiesInCustody : meta.partyFlags.some(flag => flag === filterFlag))) &&
    (!query || (labels.get(meta.caseId) ?? meta.caseId).toLowerCase().includes(query.trim().toLowerCase()))) ?? [];

  async function submit(action: CourtAction) {
    setMessage('');
    const result = await reload(action);
    if (result) {
      if (action.kind === 'pdf') setMessage(result.exported ? `Saved ${result.exported}.` : '');
      else setMessage('Saved.');
    }
    return result;
  }

  return <Page title="Smart triage" note="Priority hint - the judge decides">
    <ErrorNote error={error} />
    {message && <p role="status">{message}</p>}
    {!window.courtplusJudge && <p>Open Smart triage in the desktop workspace.</p>}
    {window.courtplusJudge && profile !== undefined && profile?.role !== 'judge' &&
      <p>Choose the Judge role in your <Link to="/profile">desktop profile</Link>.</p>}
    {!data && busy && <p role="status">Loading docket…</p>}
    {data && <fieldset disabled={busy} className="grid gap-4">
      <section className="panel">
        <h2>Case and hearing records</h2>
        {data.cases.length ? <label>Saved case<select className={fieldStyle} value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">Choose a case</option>
          {data.cases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label> : <p><Link to="/import">Import an order and save the confirmed case</Link> to begin.</p>}
        {selectedCase && <>
          <MetaForm key={selectedCase.id} caseId={selectedCase.id} meta={meta} submit={submit} />
          <HearingForm key={'hearing-' + selectedCase.id} record={selectedCase} submit={submit} />
          <h3>Hearing history</h3>
          <ul>{data.hearings.filter(item => item.caseId === selectedCase.id).map((item, index) =>
            <li key={index}>{item.date} · {item.purpose} · {item.outcome}
              {item.adjournedBy && ` · ${item.adjournedBy}`}{item.grantedDays !== undefined && ` · ${item.grantedDays} day(s) granted`}
              {item.reasonText && ` · ${item.reasonText}`}</li>)}</ul>
          {!data.hearings.some(item => item.caseId === selectedCase.id) && <p>No hearings recorded.</p>}
          <Link to={`/triage/adjournment?case=${encodeURIComponent(selectedCase.id)}`}>Analyze an adjournment request</Link>
        </>}
      </section>
      <section className="panel">
        <h2>Ranked pending cases</h2>
        <p>Each chip shows points earned and maximum points. The weights are local scheduling rules.</p>
        <div className="flex flex-wrap gap-3">
          <label>Find case<input className={fieldStyle} value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label>Case type<select className={fieldStyle} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(caseTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Party filter<select className={fieldStyle} value={filterFlag} onChange={e => setFilterFlag(e.target.value)}>
            <option value="">All parties</option><option value="custody">In custody</option>
            {Object.entries(partyFlags).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        {!visible.length && <p>{data.ranked.length ? 'No pending cases match these filters.' : 'No pending cases with confirmed filing details.'}</p>}
        <ol className="grid gap-4">
          {visible.map(({ meta, score, factors, override }) => <li key={meta.caseId} className="rounded-lg border p-3">
            <h3>{labels.get(meta.caseId)} · {score}/100</h3>
            <p>{caseTypes[meta.caseType]} · {meta.stage} · Filed {meta.filedOn}</p>
            {override && <p>Judge pin {override.direction}. {override.reason}</p>}
            <div className="flex flex-wrap gap-2">{factors.map(item =>
              <span key={item.label} className="rounded-full border px-2 py-1 text-sm">{item.label} {item.points}/{item.weight}</span>)}</div>
            <details className="my-2">
              <summary>Factor reasons and sources</summary>
              <ul>{factors.map(item => <li key={item.label}>{item.label}. {item.reason}{' '}
                {item.sources.map(source => <span key={source.section}><SourceLink authority={source} />{' '}</span>)}</li>)}</ul>
            </details>
            {pinnedCase === meta.caseId ? <form className="flex flex-wrap items-end gap-2" onSubmit={async event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const direction = text(form, 'direction') as PriorityOverride['direction'];
              if (await submit({ kind: 'override', override: { caseId: meta.caseId, direction, reason: text(form, 'reason') } })) setPinnedCase('');
            }}>
              <label>Override<select className={fieldStyle} name="direction"><option value="up">Pin up</option>
                <option value="down">Pin down</option>{override && <option value="clear">Clear pin</option>}</select></label>
              <label>Reason<input className={fieldStyle} name="reason" required maxLength={2000} /></label>
              <button className={btnPrimary}>Save override</button>
              <button className={btn} type="button" onClick={() => setPinnedCase('')}>Cancel</button>
            </form> : <button className={btn} type="button" onClick={() => setPinnedCase(meta.caseId)}>Judge override</button>}
          </li>)}
        </ol>
      </section>
      <section className="panel">
        <h2>Cause list</h2>
        <SettingsForm key={JSON.stringify(data.settings)} settings={data.settings} submit={submit} />
        <label>Listing date<input className={fieldStyle} type="date" required value={date} onChange={e => {
          if (e.target.value) setDate(e.target.value);
        }} /></label>
        {date === data.causeList.date && <>
          <p>{data.causeList.confirmed ? 'Confirmed' : 'Suggested'} · {data.causeList.entries.length} of {data.causeList.capacity} matters</p>
          {!data.causeList.entries.length && <p>No matters listed for this date.</p>}
          <ol className="list-decimal pl-6">{data.causeList.entries.map(item =>
            <li key={item.caseId}>{labels.get(item.caseId)} · {listingBasis[item.basis]}{item.score !== undefined && ` · ${item.score}/100`}</li>)}</ol>
          <div className="flex flex-wrap gap-2">
            {data.causeList.confirmed
              ? <button className={btn} type="button" onClick={() => void submit({ kind: 'pdf' })}>Export PDF</button>
              : <button className={btnPrimary} type="button" disabled={date < todayIST()} onClick={() => void submit({
                kind: 'confirmCauseList', entries: data.causeList.entries, capacity: data.causeList.capacity,
              })}>Confirm cause list</button>}
            <Link className={btn} to="/triage/adjournment">Adjournment analyzer</Link>
          </div>
        </>}
      </section>
    </fieldset>}
  </Page>;
}

function MetaForm({ caseId, meta, submit }: { caseId: string; meta?: CaseMeta; submit: Submit }) {
  return <details open={!meta}>
    <summary>Filing and scheduling details</summary>
    <form className="grid gap-2" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void submit({ kind: 'meta', meta: {
        caseId, caseType: text(form, 'type') as CaseMeta['caseType'], filedOn: text(form, 'filedOn'),
        stage: text(form, 'stage'), partiesInCustody: form.has('custody'),
        partyFlags: Object.keys(partyFlags).filter(key => form.has(key)) as CaseMeta['partyFlags'],
        nationalSecurity: form.has('security'), disposedOn: text(form, 'disposedOn') || undefined,
      } });
    }}>
      <div className="flex flex-wrap gap-2">
        <label>Case type<select className={fieldStyle} name="type" required defaultValue={meta?.caseType ?? ''}>
          <option value="">Choose a type</option>{Object.entries(caseTypes).map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Filed on<input className={fieldStyle} name="filedOn" type="date" required max={todayIST()} defaultValue={meta?.filedOn} /></label>
        <label>Stage<input className={fieldStyle} name="stage" required maxLength={200} defaultValue={meta?.stage} /></label>
        <label>Disposed on<input className={fieldStyle} name="disposedOn" type="date" max={todayIST()} defaultValue={meta?.disposedOn} /></label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label><input name="custody" type="checkbox" defaultChecked={meta?.partiesInCustody} /> Party in custody</label>
        {Object.entries(partyFlags).map(([key, label]) => <label key={key}>
          <input name={key} type="checkbox" defaultChecked={meta?.partyFlags.some(flag => flag === key)} /> {label}</label>)}
        <label><input name="security" type="checkbox" defaultChecked={meta?.nationalSecurity} /> National-security statute</label>
      </div>
      <button className={btnPrimary}>Save confirmed case details</button>
    </form>
  </details>;
}

function HearingForm({ record, submit }: { record: CourtWorkspace['cases'][number]; submit: Submit }) {
  const [fromOrder, setFromOrder] = useState(false);
  const [outcome, setOutcome] = useState<Hearing['outcome'] | ''>('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    if (!outcome) return;
    const hearing: Hearing = { caseId: record.id, date: text(form, 'date'), purpose: text(form, 'purpose'), outcome };
    if (outcome === 'adjourned') {
      hearing.adjournedBy = text(form, 'party') || undefined;
      hearing.reasonText = text(form, 'reason') || undefined;
      hearing.requestedDays = optionalDays(form, 'requestedDays');
      hearing.grantedDays = optionalDays(form, 'grantedDays');
    }
    if (await submit({ kind: 'hearing', hearing, fromOrder })) { element.reset(); setOutcome(''); }
  }
  return <details>
    <summary>Record a hearing</summary>
    <form className="grid gap-2" onSubmit={save}>
      <label>Source<select className={fieldStyle} value={fromOrder ? 'order' : 'manual'} onChange={e => setFromOrder(e.target.value === 'order')}>
        <option value="manual">Manual entry</option><option value="order" disabled={!record.orderDates.length}>Saved order</option>
      </select></label>
      {fromOrder ? <>
        <label>Date in saved order<select className={fieldStyle} name="date" required defaultValue="">
          <option value="">Choose a date</option>{record.orderDates.map(date => <option key={date}>{date}</option>)}
        </select></label>
        <label><input type="checkbox" required /> I confirmed this hearing date, purpose and outcome in the order.</label>
      </> : <label>Hearing date<input className={fieldStyle} name="date" type="date" max={todayIST()} required /></label>}
      <label>Purpose<input className={fieldStyle} name="purpose" maxLength={200} required /></label>
      <label>Outcome<select className={fieldStyle} value={outcome} required onChange={e => setOutcome(e.target.value as Hearing['outcome'])}>
        <option value="">Choose an outcome</option><option value="heard">Heard</option><option value="adjourned">Adjourned</option>
        <option value="disposed">Disposed</option></select></label>
      {outcome === 'adjourned' && <div className="flex flex-wrap gap-2">
        <label>Party requesting<input className={fieldStyle} name="party" maxLength={200} /></label>
        <label>Reason<input className={fieldStyle} name="reason" maxLength={2000} /></label>
        <label>Days requested<input className={fieldStyle} name="requestedDays" type="number" min={0} max={3650} /></label>
        <label>Days granted<input className={fieldStyle} name="grantedDays" type="number" min={0} max={3650} /></label>
      </div>}
      <button className={btnPrimary}>{fromOrder ? 'Import confirmed hearing' : 'Save hearing'}</button>
    </form>
  </details>;
}

function SettingsForm({ settings, submit }: { settings: CourtSettings; submit: Submit }) {
  return <details>
    <summary>Judge scheduling settings</summary>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void submit({ kind: 'settings', settings: { capacity: Number(form.get('capacity')),
        oldestShare: Number(form.get('oldestShare')), minimumPreparationDays: Number(form.get('minimumDays')) } });
    }}>
      <label>Daily capacity<input className={fieldStyle} name="capacity" type="number" min={1} max={1000} required defaultValue={settings.capacity} /></label>
      <label>Oldest-case share (%)<input className={fieldStyle} name="oldestShare" type="number" min={0} max={100} required defaultValue={settings.oldestShare} /></label>
      <label>Minimum preparation days<input className={fieldStyle} name="minimumDays" type="number" min={0} max={3650} required
        defaultValue={settings.minimumPreparationDays} /></label>
      <button className={btn}>Save settings</button>
    </form>
  </details>;
}
