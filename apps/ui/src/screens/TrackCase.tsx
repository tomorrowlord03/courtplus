import { useState, type FormEvent } from 'react';
import type { CaseRecord, CourtEvent, HearingSummary } from '@courtplus/contracts';
import { btnPrimary, ErrorNote, errMsg, Page } from '../components/ui';
import { todayIST, useApp } from '../lib/context';
import { t } from '../lib/i18n';
import { hearingBridge } from './hearing-tools';

// Track my case: what this Court+ backend holds about a case, in plain words. eCourts stays the
// authoritative status, so its link is always shown.

export const ECOURTS_CASE_STATUS = 'https://services.ecourts.gov.in/ecourtindia_v6/';

export const STAGE_GLOSSARY: Record<CaseRecord['pendingStatus'], string> = {
  investigation: 'The police are still collecting evidence. No charge sheet has been filed in court yet.',
  inquiry: 'The magistrate is examining the case before a trial starts (for example, deciding whether to take it up).',
  trial: 'The court is hearing evidence from both sides. Hearings happen on the dates the court fixes.',
  appeal: 'A higher court is reviewing an earlier decision in this case.',
  disposed: 'The court has finished with this case. Ask for a certified copy of the final order.',
};

export const EVENT_WORDS: Record<CourtEvent['kind'], string> = {
  remand: 'Remand: the court allowed the person to be kept in custody for a period',
  chargesheet: 'Charge sheet: the police filed their final report in court',
  framing: 'Charges framed: the court formally told the accused what they are tried for',
  bail_granted: 'Bail granted',
  bail_rejected: 'Bail refused',
  acquitted: 'Acquitted: found not guilty',
  convicted: 'Convicted: found guilty',
  released: 'Released from custody',
  hearing: 'Hearing',
  other: 'Other court event',
};

/** Case references are typed many ways; compare letters and digits only. */
export function normaliseRef(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function findCase(cases: CaseRecord[], reference: string): CaseRecord | undefined {
  const wanted = normaliseRef(reference);
  if (!wanted) return undefined;
  return cases.find(record => [record.cnr, record.caseNo, record.id].some(value => value && normaliseRef(value) === wanted));
}

export function caseDates(record: CaseRecord, today: string) {
  const events = [...record.events].sort((a, b) => a.on.localeCompare(b.on));
  return {
    past: events.filter(event => event.on <= today),
    next: events.find(event => event.on > today && (event.kind === 'hearing' || event.kind === 'other')) ?? events.find(event => event.on > today),
  };
}

type PublishedSummary = { recordingId: string; startedAt: string; version: number; summary: HearingSummary };

async function signedSummaries(caseId: string): Promise<PublishedSummary[]> {
  const hearing = hearingBridge();
  if (!hearing) return [];
  const recordings = (await hearing.list()).filter(item => item.caseId === caseId && item.state === 'recorded');
  const found: PublishedSummary[] = [];
  for (const recording of recordings) {
    const signed = (await hearing.transcripts(recording.id)).filter(version => version.receipt).at(-1);
    if (signed) found.push({ recordingId: recording.id, startedAt: recording.startedAt, version: signed.version,
      summary: await hearing.summary(recording.id, signed.version) });
  }
  return found;
}

export function TrackCase() {
  const { api } = useApp();
  const [record, setRecord] = useState<CaseRecord | null | undefined>(undefined);
  const [summaries, setSummaries] = useState<PublishedSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();

  async function look(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = String(new FormData(event.currentTarget).get('reference') ?? '');
    setBusy(true); setError(null); setSummaries([]);
    try {
      const found = findCase(await api.listCases(), reference) ?? null;
      setRecord(found);
      if (found) setSummaries(await signedSummaries(found.id).catch(() => []));
    } catch (e) { setError(errMsg(e)); setRecord(undefined); }
    finally { setBusy(false); }
  }

  const dates = record ? caseDates(record, today) : undefined;
  return <Page title={t('track.title', 'Track my case')} note={t('track.note', 'See what this court office has recorded. The eCourts website has the official status.')}>
    <form className="panel" onSubmit={event => void look(event)}>
      <label>{t('track.reference', 'Case number or CNR')}
        <input className="field-control" name="reference" required maxLength={100} autoComplete="off" placeholder="e.g. CGRP010012342024" />
      </label>
      <button className={btnPrimary + ' mt-2'} disabled={busy}>{busy ? 'Looking…' : t('track.find', 'Find my case')}</button>
    </form>
    <ErrorNote error={error} />
    <p className="mt-3"><a href={ECOURTS_CASE_STATUS} target="_blank" rel="noreferrer">{t('track.ecourts', 'Official case status on eCourts services')}</a></p>

    {record === null && <p role="status" className="panel mt-3">{t('track.notFound', 'This court office has no case with that number. Check the number, or use the eCourts link above.')}</p>}
    {record && dates && <section className="panel mt-3" aria-label="Case status">
      <h2 className="text-lg font-semibold">{record.caseNo ?? record.cnr ?? record.id}{record.court ? ` · ${record.court}` : ''}</h2>
      <p><strong>{t('track.stage', 'Stage')}:</strong> {record.pendingStatus} — {STAGE_GLOSSARY[record.pendingStatus]}</p>
      <p><strong>{t('track.next', 'Next date')}:</strong> {dates.next ? `${dates.next.on} (${EVENT_WORDS[dates.next.kind]})` : t('track.noNext', 'No next date recorded here yet')}</p>
      <h3 className="mt-3 font-semibold">{t('track.history', 'What has happened so far')}</h3>
      {dates.past.length ? <ol className="text-sm">{dates.past.map((event, index) => <li key={index}>
        {event.on}: {EVENT_WORDS[event.kind]}{event.note ? ` — ${event.note}` : ''}
      </li>)}</ol> : <p className="text-sm">{t('track.noHistory', 'No hearings recorded here yet.')}</p>}
      <h3 className="mt-3 font-semibold">{t('track.summaries', 'Signed hearing summaries')}</h3>
      {summaries.length ? summaries.map(item => <article key={item.recordingId} className="mt-2 rounded border p-2 text-sm">
        <p><strong>{item.startedAt.slice(0, 10)}</strong> · transcript version {item.version}, signed by the court · {item.summary.label}</p>
        <ul className="list-disc pl-5">{item.summary.sentences.map(sentence => <li key={sentence.segmentId}>{sentence.text}</li>)}</ul>
      </article>) : <p className="text-sm">{t('track.noSummaries', 'The court has not published a signed hearing summary for this case.')}</p>}
    </section>}

    <details className="panel mt-4">
      <summary className="font-semibold">{t('track.glossary', 'What the stages mean')}</summary>
      <dl className="text-sm">{Object.entries(STAGE_GLOSSARY).map(([stage, meaning]) => <div key={stage} className="mt-1">
        <dt className="font-medium capitalize">{stage}</dt><dd>{meaning}</dd>
      </div>)}</dl>
    </details>
  </Page>;
}
