import { ui } from '../lib/i18n';
import { useMemo, useRef, useState } from 'react';
import type { CourtPlusApi, Entity, FieldSuggestion } from '@courtplus/contracts';
import { useApp } from '../lib/context';
import { ErrorNote, btn, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';

type Imported = Awaited<ReturnType<CourtPlusApi['importOrder']>>;
type Decision = { status: 'pending' | 'confirmed' | 'rejected'; value: string };

// Label name is always shown beside the colour so colour is never the only signal.
export const LABEL_STYLE: Record<Entity['label'], string> = {
  COURT: 'bg-sky-200', PETITIONER: 'bg-rose-200', RESPONDENT: 'bg-orange-200', JUDGE: 'bg-violet-200',
  LAWYER: 'bg-pink-200', DATE: 'bg-lime-200', ORG: 'bg-teal-200', GPE: 'bg-cyan-200', STATUTE: 'bg-amber-200',
  PROVISION: 'bg-yellow-200', PRECEDENT: 'bg-indigo-200', CASE_NUMBER: 'bg-emerald-200',
  WITNESS: 'bg-fuchsia-200', OTHER_PERSON: 'bg-red-200',
};
const MASKED: Entity['label'][] = ['PETITIONER', 'RESPONDENT', 'WITNESS', 'OTHER_PERSON', 'LAWYER'];
const FIELDS = ['court', 'caseNo', 'cnr', 'policeStation', 'orderDate', 'section', 'bailGrantedOn', 'firstRemandOn'];

/** Splits text into plain and entity segments; masked labels are blocked out in anonymised view. */
export function segments(text: string, entities: Entity[], anonymise: boolean) {
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const out: { text: string; entity?: Entity }[] = [];
  let pos = 0;
  for (const e of sorted) {
    if (e.start < pos) continue;
    if (e.start > pos) out.push({ text: text.slice(pos, e.start) });
    const hide = anonymise && MASKED.includes(e.label);
    out.push({ text: hide ? '█'.repeat(Math.min(8, Math.max(3, e.end - e.start))) : text.slice(e.start, e.end), entity: e });
    pos = e.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

async function fileToBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function ImportOrder() {
  const { api } = useApp();
  const [doc, setDoc] = useState<Imported | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [anonymise, setAnonymise] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [selection, setSelection] = useState('');
  const [manualField, setManualField] = useState(FIELDS[0]);
  const textRef = useRef<HTMLDivElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setBusy(true);
    try {
      const bytes = await fileToBytes(file);
      const res = await api.importOrder({ name: file.name, bytes });
      setDoc(res);
      setDecisions(Object.fromEntries(res.suggestions.map((s, i) => [i, { status: 'pending', value: s.value }])));
      setManual({});
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const segs = useMemo(() => (doc ? segments(doc.text, doc.entities, anonymise) : []), [doc, anonymise]);
  const decide = (i: number, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [i]: { ...d[i], ...patch } }));

  const captureSelection = () => {
    const sel = window.getSelection();
    if (sel && textRef.current && sel.anchorNode && textRef.current.contains(sel.anchorNode)) {
      setSelection(sel.toString().trim());
    }
  };

  return (
    <ScreenPage screenId="import" judgeHint note={ui("The order is read on this computer. Check suggestions against the order.")}>
      <ErrorNote error={error} />
      {!doc && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void handleFile(e.dataTransfer.files[0]); }}
          className="rounded-lg border-2 border-dashed border-slate-400 bg-white p-10 text-center"
        >
          <p className="text-lg font-semibold">{ui("Import a court order to begin")}</p>
          <p className="mb-4 text-slate-600">{ui("Drag a PDF or a photo of the order here, or choose a file.")}</p>
          <label className={`${btnPrimary} cursor-pointer`}>
            {busy ? ui("Reading…") : ui("Choose PDF or image")}
            <input
              data-guide="start"
              type="file" accept="application/pdf,image/*" className="sr-only"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {doc && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={anonymise} onChange={(e) => setAnonymise(e.target.checked)} />{ui("Anonymised view (names masked)")}</label>
              {doc.ocr && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">{ui("Scanned: read by OCR, check carefully")}</span>}
              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium">{ui("✦ The app suggested details from this order")}</span>
              <button className={btn} onClick={() => setDoc(null)}>{ui("Import another")}</button>
            </div>
            <div
              ref={textRef} onMouseUp={captureSelection} onKeyUp={captureSelection} tabIndex={0}
              aria-label={ui("Order text")}
              className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border bg-white p-3 text-sm leading-6"
            >
              {segs.map((s, i) =>
                s.entity ? (
                  <mark key={i} className={`${LABEL_STYLE[s.entity.label]} rounded px-0.5`} title={s.entity.label}>
                    {s.text}<sup className="ml-0.5 text-[10px] font-bold">{s.entity.label}</sup>
                  </mark>
                ) : <span key={i}>{s.text}</span>,
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded border bg-white p-2 text-sm">
              <span>{ui("Missed a field? Select text above, then:")}</span>
              <select aria-label={ui("Field")} value={manualField} onChange={(e) => setManualField(e.target.value)} className="rounded border px-1 py-1">
                {FIELDS.map((f) => <option key={f}>{f}</option>)}
              </select>
              <button
                className={btn} disabled={!selection}
                onClick={() => { setManual((m) => ({ ...m, [manualField]: selection })); setSelection(''); }}
              >
                Use “{selection.slice(0, 24) || '…'}” for {manualField}
              </button>
            </div>
          </div>

          <aside aria-label={ui("Field suggestions")} className="space-y-2">
            <h2 className="font-semibold">Suggestions ({doc.suggestions.length})</h2>
            {doc.suggestions.length === 0 && <p className="text-sm text-slate-600">{ui("No suggestions found. Select text to fill fields by hand.")}</p>}
            {doc.suggestions.map((s: FieldSuggestion, i) => {
              const d = decisions[i];
              if (!d) return null;
              return (
                <div key={i} className="rounded border bg-white p-2 text-sm" data-testid={`suggestion-${i}`}>
                  <p className="text-xs uppercase text-slate-600">{s.field}</p>
                  {editing === i ? (
                    <input
                      aria-label={`Edit ${s.field}`} value={d.value} autoFocus
                      onChange={(e) => decide(i, { value: e.target.value })}
                      onBlur={() => setEditing(null)}
                      className="w-full rounded border px-1"
                    />
                  ) : (
                    <p className="font-medium">{d.value}</p>
                  )}
                  <blockquote className="my-1 border-l-2 pl-2 text-xs text-slate-700">“{s.sentence}”{s.page ? ` (p. ${s.page})` : ''}</blockquote>
                  <p className="text-xs">{ui("Status:") + " "}<strong>{d.status === 'confirmed' ? ui("✓ Confirmed") : d.status === 'rejected' ? '✗ Rejected' : 'Pending'}</strong></p>
                  <div className="mt-1 flex gap-1">
                    <button className={btnPrimary} onClick={() => decide(i, { status: 'confirmed' })}>{ui("Confirm")}</button>
                    <button className={btn} onClick={() => setEditing(i)}>{ui("Edit")}</button>
                    <button className={btn} onClick={() => decide(i, { status: 'rejected' })}>{ui("Reject")}</button>
                  </div>
                </div>
              );
            })}
            {Object.keys(manual).length > 0 && (
              <div className="rounded border bg-white p-2 text-sm">
                <h3 className="font-semibold">{ui("Entered by hand")}</h3>
                <ul>{Object.entries(manual).map(([k, v]) => <li key={k}><strong>{k}</strong>: {v}</li>)}</ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </ScreenPage>
  );
}
