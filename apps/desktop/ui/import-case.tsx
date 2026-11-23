import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseRecord, Charge, CourtPlusApi, Person, Tri } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg, Page } from '../../ui/src/components/ui';
import { api } from './bridge';
import {
  applySuggestion, bailOutcomes, buildCaseRecord, otherEvents, reviewFields, suggestionTarget,
  type Facts, type Field, type OtherEvent,
} from './import-facts';

// The intake adds `aiUnavailable` when the model could not run; the contract type does not name it.
type Order = Awaited<ReturnType<CourtPlusApi['importOrder']>> & { aiUnavailable?: string };
const fieldStyle = 'block w-full rounded border border-slate-400 px-2 py-1';
const dateFields: readonly Field[] = ['orderDate', 'firstRemandOn', 'chargesheetOn', 'judicialStart', 'bailGrantedOn', 'releasedOn'];
const confirmerKey = 'courtplus.confirmedBy';

function rememberedConfirmer(): string {
  try { return localStorage.getItem(confirmerKey) ?? ''; } catch { return ''; }
}

function tri(data: FormData, name: string): Tri {
  const value = data.get(name);
  return value === 'yes' || value === 'no' ? value : 'unknown';
}

export function ImportCase() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Order>();
  const [facts, setFacts] = useState<Facts>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState('');
  const [used, setUsed] = useState<number[]>([]);
  const [confirmedBy, setConfirmedBy] = useState(rememberedConfirmer);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.listPersons().then(setPeople, error => setError(errMsg(error))); }, []);

  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDoc(await api.importOrder({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }));
      setFacts({});
      setUsed([]);
    } catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const get = (key: string) => String(data.get(key) ?? '').trim() || undefined;
      const person = people.find(person => person.id === selected) ?? {
        id: crypto.randomUUID(), alias: get('alias')!,
        prisonerType: get('prisonerType') as Person['prisonerType'], priorConviction: tri(data, 'prior'),
        otherHolds: tri(data, 'holds'), juvenileClaim: tri(data, 'juvenile'), caseIds: [],
      };
      const otherKind = get('otherEvent') as OtherEvent | undefined;
      const record = buildCaseRecord({
        id: crypto.randomUUID(), personId: person.id, docId: doc.docId,
        confirmedBy, confirmedAt: new Date().toISOString(), facts,
        stage: get('stage') as Charge['stage'], pendingStatus: get('pendingStatus') as CaseRecord['pendingStatus'],
        judicialEnd: get('judicialEnd'), ongoing: data.has('ongoing'),
        otherEvent: otherKind ? { kind: otherKind, on: get('otherEventOn') } : undefined,
      });
      try { localStorage.setItem(confirmerKey, confirmedBy.trim()); } catch { /* storage is a convenience only */ }
      await api.saveCase({ ...person, caseIds: [...person.caseIds, record.id] }, record);
      navigate('/');
    } catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  const suggestions = doc?.suggestions.map((suggestion, i) => ({ suggestion, i, field: suggestionTarget(suggestion) }))
    .filter(item => item.field) ?? [];

  return <Page title="Import order" note="Review the extracted order and save confirmed facts. Exclude sealed, in-camera and other protected orders.">
    <ErrorNote error={error} />
    {!doc ? <label className={btn}>
      {busy ? 'Reading order…' : 'Choose PDF or image'}
      <input className="ml-3" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy}
        onChange={event => void read(event.target.files?.[0])} />
    </label> : <>
      <button className={btn + ' mb-4'} onClick={() => setDoc(undefined)}>Import another</button>
      {doc.aiUnavailable && <p role="status" className="mb-4 rounded bg-amber-50 p-2 text-sm text-amber-800">
        ▲ {doc.aiUnavailable}. The model could not run, so names are masked by rules only and the suggestions
        below come from text patterns. Check the masking and enter every fact from the order by hand.
      </p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Anonymised order and suggestions" className="min-w-0 space-y-3">
          <h2 className="font-semibold">Anonymised order {doc.ocr ? '· OCR' : ''}</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-white p-3 text-sm">{doc.redactedText}</pre>
          <h2 className="font-semibold">Suggested facts</h2>
          <div className="max-h-96 space-y-2 overflow-auto">
            {suggestions.length === 0 && <p className="text-sm">No suggestions. Enter the facts from the order.</p>}
            {suggestions.map(({ suggestion, i, field }) => {
              const value = field === 'bailOutcome' ? bailOutcomes[suggestion.value as keyof typeof bailOutcomes] : suggestion.value;
              return <div className="rounded border bg-white p-2" key={i}>
                <p>{reviewFields[field!]} · {value}{suggestion.page ? ' · page ' + suggestion.page : ''}</p>
                <blockquote className="my-1 border-l-2 pl-2 text-xs text-slate-700">“{suggestion.sentence}”</blockquote>
                <button type="button" className={btn} disabled={used.includes(i)} onClick={() => {
                  setFacts(previous => applySuggestion(previous, suggestion));
                  setUsed(previous => [...previous, i]);
                }}>{used.includes(i) ? 'Added to review' : 'Use suggestion'}</button>
              </div>;
            })}
          </div>
        </section>
        <form onSubmit={event => void save(event)} className="space-y-3 rounded border bg-white p-4">
          <h2 className="font-semibold">Confirmed case facts</h2>
          <label>Person
            <select className={fieldStyle} value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">New person</option>
              {people.map(person => <option key={person.id} value={person.id}>{person.alias}</option>)}
            </select>
          </label>
          {!selected && <>
            <label>Person alias<input name="alias" className={fieldStyle} required
              pattern="(?:Accused|Person|Prisoner|Undertrial)[ \\-][0-9]{1,12}" placeholder="Accused-01" /></label>
            <label>Prisoner type<select name="prisonerType" className={fieldStyle}>
              <option value="undertrial">Undertrial</option><option value="convict_appellant">Convict-appellant</option>
            </select></label>
            {([['prior', 'Prior conviction'], ['holds', 'Other holds'], ['juvenile', 'Juvenile claim']] as const).map(([key, label]) =>
              <label key={key}>{label}<select name={key} className={fieldStyle}>
                <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
              </select></label>)}
          </>}
          {(Object.entries(reviewFields) as [Field, string][]).map(([key, label]) => {
            const onChange = (value: string) => setFacts(previous => ({ ...previous, [key]: value }));
            return <label key={key}>{label}
              {key === 'section' ? <textarea className={fieldStyle} value={facts[key] ?? ''}
                onChange={event => onChange(event.target.value)} />
                : key === 'bailOutcome' ? <select className={fieldStyle} value={facts[key] ?? ''}
                  onChange={event => onChange(event.target.value)}>
                  <option value="">Not decided in this order</option>
                  {Object.entries(bailOutcomes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
                : <input className={fieldStyle} value={facts[key] ?? ''} type={dateFields.includes(key) ? 'date' : 'text'}
                  onChange={event => onChange(event.target.value)} />}
            </label>;
          })}
          <label>Judicial custody end<input name="judicialEnd" type="date" className={fieldStyle} /></label>
          <label className="block"><input name="ongoing" type="checkbox" /> Judicial custody is ongoing</label>
          <label>Other court event<select name="otherEvent" className={fieldStyle}>
            <option value="">None</option>
            {Object.entries(otherEvents).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select></label>
          <label>Other court event date<input name="otherEventOn" type="date" className={fieldStyle} /></label>
          <label>Charge stage<select name="stage" className={fieldStyle}>
            <option value="FIR">FIR</option><option value="FRAMED">Framed and verified</option>
          </select></label>
          <label>Pending stage<select name="pendingStatus" className={fieldStyle}>
            {['investigation', 'inquiry', 'trial', 'appeal', 'disposed'].map(stage => <option key={stage}>{stage}</option>)}
          </select></label>
          <label>Confirmed by<input className={fieldStyle} required value={confirmedBy}
            placeholder="Name and role of the person confirming" onChange={event => setConfirmedBy(event.target.value)} /></label>
          <button className={btnPrimary} disabled={busy}>Save confirmed case</button>
        </form>
      </div>
    </>}
  </Page>;
}
