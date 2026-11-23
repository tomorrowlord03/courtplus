import { ui } from '../lib/i18n';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HINT_LABEL, type PrecedentHit, type PrecedentQuery, type PrecedentText } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import {
  addDraftCitation, copyText, formatCitation, highlight, removeDraftCitation, researchApi, unavailableText, useDraftCitations,
} from '../lib/research';

const COURTS = ['Supreme Court', 'Chhattisgarh'];

export function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlight(text, query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</>;
}

export function Research() {
  const [query, setQuery] = useState<PrecedentQuery | null>(null);
  const [hits, setHits] = useState<PrecedentHit[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<PrecedentText | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const words = String(form.get('query') ?? '').trim();
    if (!words) return;
    const year = (key: string) => Number(form.get(key)) || undefined;
    const next: PrecedentQuery = {
      query: words, k: 20, court: String(form.get('court') ?? '') || undefined, yearFrom: year('yearFrom'), yearTo: year('yearTo'),
    };
    setBusy(true); setError(null); setMessage(''); setOpen(null);
    try {
      const result = await researchApi().searchPrecedents(next);
      setQuery(next);
      if (result.available) { setHits(result.items); setUnavailable(null); }
      else { setHits(null); setUnavailable(result.reason); }
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function openText(hit: PrecedentHit) {
    setError(null);
    try {
      const full = await researchApi().openPrecedent(hit.id);
      if (full?.text) setOpen(full);
      else if (hit.url) window.open(hit.url, '_blank', 'noopener,noreferrer');
      else setMessage('The full text of this judgment is not in the local index.');
    } catch (e) { setError(errMsg(e)); }
  }

  async function copy(hit: PrecedentHit) {
    setMessage(await copyText(formatCitation(hit)) ? 'Citation copied.' : 'Could not copy. Select the citation and copy it.');
  }

  return <ScreenPage screenId="research" judgeHint note={ui("Search published decisions by words or a law section. Each result links to its source.")}>
    <form className="panel research-form" role="search" onSubmit={event => void search(event)}>
      <label>{ui("Search judgments")}<input className="field-control" name="query" type="search" required maxLength={2000}
          placeholder="e.g. default bail chargesheet not filed, or IPC 379" />
      </label>
      <div className="research-filters">
        <label>{ui("Court")}<select className="field-control" name="court" defaultValue="">
            <option value="">{ui("All courts")}</option>
            {COURTS.map(court => <option key={court} value={court}>{court}</option>)}
          </select>
        </label>
        <label>{ui("From year")}<input className="field-control" name="yearFrom" type="number" min={1950} max={2100} inputMode="numeric" /></label>
        <label>{ui("To year")}<input className="field-control" name="yearTo" type="number" min={1950} max={2100} inputMode="numeric" /></label>
        <button data-guide="start" className={btnPrimary} disabled={busy}>{busy ? ui("Searching…") : ui("Search")}</button>
      </div>
    </form>
    <ErrorNote error={error} />
    {message && <p role="status" className="muted">{message}</p>}
    {unavailable && <p role="status" className="partial-note">{unavailableText(unavailable)}</p>}
    {hits && query && <section aria-label={ui("Search results")} className="research-results">
      <p className="muted">{hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}. ${HINT_LABEL}: read the judgment before relying on it.` : ui("No judgments matched. Try other words or remove a filter.")}</p>
      <ol className="space-y-3">{hits.map(hit => <li key={hit.id} className="panel research-hit">
        <h2 className="text-lg font-semibold"><Highlighted text={hit.title} query={query.query} /></h2>
        <p className="text-sm"><strong>{hit.citation}</strong>{hit.year ? ` · ${hit.year}` : ''} · {hit.court}</p>
        {hit.snippet && <p className="research-snippet"><Highlighted text={hit.snippet} query={query.query} /></p>}
        <p className="text-xs muted">{ui("Source:") + " "}{hit.source}{hit.url && <> · <a href={hit.url} target="_blank" rel="noreferrer">{ui("official copy")}</a></>}</p>
        <div className="flex flex-wrap gap-2">
          <button className={btn} type="button" onClick={() => void openText(hit)}>{ui("Open full text")}</button>
          <button className={btn} type="button" onClick={() => void copy(hit)}>{ui("Copy citation")}</button>
          <button className={btn} type="button" onClick={() =>
            setMessage(addDraftCitation(formatCitation(hit)) ? 'Added to your draft citations.' : 'Already in your draft citations.')}>{ui("Add to draft")}</button>
        </div>
      </li>)}</ol>
    </section>}
    {open && <section className="panel research-full" aria-label={ui("Full text")}>
      <div className="panel-heading"><h2>{open.title}</h2><button className={btn} type="button" onClick={() => setOpen(null)}>{ui("Close")}</button></div>
      <p className="text-sm">{open.citation} · {open.source}</p>
      <div className="research-text">{open.text}</div>
    </section>}
    <DraftCitations />
  </ScreenPage>;
}

function DraftCitations() {
  const citations = useDraftCitations();
  const [copied, setCopied] = useState('');
  if (!citations.length) return null;
  return <section className="panel mt-4" aria-labelledby="draft-citations-title">
    <div className="panel-heading"><h2 id="draft-citations-title">{ui("Citations for your draft")}</h2>
      <Link className="panel-link" to="/drafts">{ui("Open drafts")}</Link></div>
    <ol className="list-decimal pl-5 text-sm">{citations.map(citation => <li key={citation}>
      {citation} <button className="text-button" type="button" aria-label={`Remove ${citation}`} onClick={() => removeDraftCitation(citation)}>{ui("Remove")}</button>
    </li>)}</ol>
    <button className={btn} type="button" onClick={() => void copyText(citations.join('\n')).then(ok => setCopied(ok ? 'All citations copied.' : 'Could not copy.'))}>{ui("Copy all")}</button>
    {copied && <p role="status" className="muted">{copied}</p>}
  </section>;
}
