import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseRecord, Charge, CourtPlusApi, Person, SourceRef, Tri } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg, Page } from '../../ui/src/components/ui';
import { api } from './bridge';

type Order = Awaited<ReturnType<CourtPlusApi['importOrder']>>;
const reviewFields = {
  court: 'Court', caseNo: 'Case reference', cnr: 'CNR', policeStation: 'Police station',
  orderDate: 'Order date', firstRemandOn: 'First remand date', chargesheetOn: 'Chargesheet date',
  bailGrantedOn: 'Bail grant date', releasedOn: 'Release date', section: 'Charges',
} as const;
type Field = keyof typeof reviewFields;
const fieldStyle = 'block w-full rounded border border-slate-400 px-2 py-1';

function confirmedCharges(text: string, stage: Charge['stage'], source: SourceRef): Charge[] {
  return text.split(/[\n,]/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^(IPC|BNS|NDPS|UAPA|PMLA|POCSO|PC_ACT|ARMS|EXCISE|OTHER)\s+([0-9]+[a-z]?)(?:\(([^)]+)\))?(?:\(([^)]+)\))?$/i.exec(line);
    if (!match) throw new Error('Enter charges with their statute, for example IPC 379. Put each charge on its own line.');
    const [, act, section, subsection, variant] = match;
    return { act: act.toUpperCase() as Charge['act'], section, subsection, variant, stage, verified: true, source };
  });
}

function tri(data: FormData, name: string): Tri {
  const value = data.get(name);
  return value === 'yes' || value === 'no' ? value : 'unknown';
}

export function ImportCase() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Order>();
  const [facts, setFacts] = useState<Partial<Record<Field, string>>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState('');
  const [used, setUsed] = useState<number[]>([]);
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
      const id = crypto.randomUUID();
      const person = people.find(person => person.id === selected) ?? {
        id: crypto.randomUUID(), alias: get('alias')!,
        prisonerType: get('prisonerType') as Person['prisonerType'], priorConviction: tri(data, 'prior'),
        otherHolds: tri(data, 'holds'), juvenileClaim: tri(data, 'juvenile'), caseIds: [],
      };
      const source: SourceRef = { docId: doc.docId, verifiedAt: new Date().toISOString() };
      const value = (field: Field) => facts[field]?.trim() || undefined;
      const firstRemandOn = value('firstRemandOn');
      const start = get('judicialStart');
      const end = get('judicialEnd');
      const ongoing = data.has('ongoing');
      if (start && (!end && !ongoing || end && (ongoing || end < start))) {
        throw new Error('Enter a judicial custody end date or confirm that custody is ongoing.');
      }
      const bailGrantedOn = value('bailGrantedOn');
      const releasedOn = value('releasedOn');
      const orderDate = value('orderDate');
      const chargesheetOn = value('chargesheetOn');
      const record: CaseRecord = {
        id, personId: person.id, court: value('court'), caseNo: value('caseNo'),
        cnr: value('cnr'), policeStation: value('policeStation'), firstRemandOn, chargesheetOn,
        orderDate, bailGrantedOn, releasedOn,
        pendingStatus: get('pendingStatus') as CaseRecord['pendingStatus'],
        charges: confirmedCharges(value('section') ?? '', get('stage') as Charge['stage'], source),
        custody: start ? [{ kind: 'judicial', start, end, ongoing, source }] : [],
        events: [
          ...(firstRemandOn ? [{ kind: 'remand' as const, on: firstRemandOn, source }] : []),
          ...(chargesheetOn ? [{ kind: 'chargesheet' as const, on: chargesheetOn, source }] : []),
          ...(bailGrantedOn ? [{ kind: 'bail_granted' as const, on: bailGrantedOn, source }] : []),
          ...(releasedOn ? [{ kind: 'released' as const, on: releasedOn, source }] : []),
        ],
      };
      await api.saveCase({ ...person, caseIds: [...person.caseIds, id] }, record);
      navigate('/');
    } catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  return <Page title="Import order" note="Review the extracted order and save confirmed facts. Exclude sealed, in-camera and other protected orders.">
    <ErrorNote error={error} />
    {!doc ? <label className={btn}>
      {busy ? 'Reading order…' : 'Choose PDF or image'}
      <input className="ml-3" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy}
        onChange={event => void read(event.target.files?.[0])} />
    </label> : <>
      <button className={btn + ' mb-4'} onClick={() => setDoc(undefined)}>Import another</button>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Anonymised order and suggestions" className="min-w-0 space-y-3">
          <h2 className="font-semibold">Anonymised order {doc.ocr ? '· OCR' : ''}</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-white p-3 text-sm">{doc.redactedText}</pre>
          <h2 className="font-semibold">Suggested facts</h2>
          <div className="max-h-96 space-y-2 overflow-auto">
            {doc.suggestions.filter(suggestion => Object.hasOwn(reviewFields, suggestion.field)).map((suggestion, i) => {
              const field = suggestion.field as Field;
              return <div className="rounded border bg-white p-2" key={i}>
                <p>{reviewFields[field]} · {suggestion.value}{suggestion.page ? ' · page ' + suggestion.page : ''}</p>
                <button type="button" className={btn} disabled={used.includes(i)} onClick={() => {
                  setFacts(previous => ({ ...previous, [field]: field === 'section' && previous.section
                    ? previous.section + '\n' + suggestion.value : suggestion.value }));
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
            const onChange = (value: string) => setFacts({ ...facts, [key]: value });
            return <label key={key}>{label}
              {key === 'section' ? <textarea className={fieldStyle} value={facts[key] ?? ''}
                onChange={event => onChange(event.target.value)} />
                : <input className={fieldStyle} value={facts[key] ?? ''}
                  type={key.endsWith('On') || key === 'orderDate' ? 'date' : 'text'}
                  onChange={event => onChange(event.target.value)} />}
            </label>;
          })}
          <label>Charge stage<select name="stage" className={fieldStyle}>
            <option value="FIR">FIR</option><option value="FRAMED">Framed and verified</option>
          </select></label>
          <label>Pending stage<select name="pendingStatus" className={fieldStyle}>
            {['investigation', 'inquiry', 'trial', 'appeal', 'disposed'].map(stage => <option key={stage}>{stage}</option>)}
          </select></label>
          <label>Judicial custody start<input name="judicialStart" type="date" className={fieldStyle} /></label>
          <label>Judicial custody end<input name="judicialEnd" type="date" className={fieldStyle} /></label>
          <label className="block"><input name="ongoing" type="checkbox" /> Judicial custody is ongoing</label>
          <button className={btnPrimary} disabled={busy}>Save confirmed case</button>
        </form>
      </div>
    </>}
  </Page>;
}
