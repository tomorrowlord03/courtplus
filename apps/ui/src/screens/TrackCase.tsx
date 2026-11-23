import { useState, type FormEvent } from 'react';
import type { CaseRecord, CourtEvent, PublicCaseTrack } from '@courtplus/contracts';
import { btnPrimary, ErrorNote, errMsg, Page } from '../components/ui';
import { t, ui } from '../lib/i18n';
import { CitizenSettlementEstimator } from './CitizenSettlementEstimator';
import { HearingBreakdowns } from './HearingBreakdowns';

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
  const uniqueIds = cases.filter(record => [record.cnr, record.id].some(value => value && normaliseRef(value) === wanted));
  if (uniqueIds.length) return uniqueIds.length === 1 ? uniqueIds[0] : undefined;
  const caseNumbers = cases.filter(record => record.caseNo && normaliseRef(record.caseNo) === wanted);
  return caseNumbers.length === 1 ? caseNumbers[0] : undefined;
}

export function caseDates(record: CaseRecord, today: string) {
  const events = [...record.events].sort((a, b) => a.on.localeCompare(b.on));
  return {
    past: events.filter(event => event.on <= today),
    next: events.find(event => event.on > today && (event.kind === 'hearing' || event.kind === 'other')) ?? events.find(event => event.on > today),
  };
}

async function trackBase(): Promise<string> {
  const desktop = (window as Window & { courtplusDesktop?: { settings?: () => Promise<{ backendUrl: string }> } }).courtplusDesktop;
  if (!desktop?.settings) return '';
  const settings = await desktop.settings();
  if (!settings.backendUrl) throw new Error('Set the Court+ backend URL in Settings to track a case.');
  return settings.backendUrl;
}

export function TrackCase() {
  const [record, setRecord] = useState<PublicCaseTrack | null | undefined>(undefined);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function look(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = String(new FormData(event.currentTarget).get('reference') ?? '');
    setBusy(true); setError(null); setReference(reference);
    try {
      const response = await fetch((await trackBase()) + '/track/' + encodeURIComponent(reference.trim()));
      if (response.status === 404) { setRecord(null); return; }
      if (!response.ok) throw new Error('Case lookup failed (' + response.status + ').');
      setRecord(await response.json() as PublicCaseTrack);
    } catch (e) { setError(errMsg(e)); setRecord(undefined); }
    finally { setBusy(false); }
  }

  return <Page title={t('track.title', 'Track my case')} note={t('track.note', 'See what this court office has recorded. The eCourts website has the official status.')}>
    <form className="panel" onSubmit={event => void look(event)}>
      <label>{t('track.reference', 'Case number or CNR')}
        <input className="field-control" name="reference" required maxLength={100} autoComplete="off" placeholder={ui('e.g. CGRP010012342024')} />
      </label>
      <button className={btnPrimary + ' mt-2'} disabled={busy}>{busy ? ui("Looking…") : t('track.find', 'Find my case')}</button>
    </form>
    <ErrorNote error={error && ui(error)} />
    <p className="mt-3"><a href={ECOURTS_CASE_STATUS} target="_blank" rel="noreferrer">{t('track.ecourts', 'Official case status on eCourts services')}</a></p>

    {record === null && <p role="status" className="panel mt-3">{t('track.notFound', 'This court office has no case with that number. Check the number, or use the eCourts link above.')}</p>}
    {record && <section className="panel mt-3" aria-label={ui('Case status')}>
      <h2 className="text-lg font-semibold">{reference}</h2>
      <p><strong>{t('track.stage', 'Stage')}:</strong> {record.stage ? `${ui(record.stage)} — ${ui(STAGE_GLOSSARY[record.stage])}` : ui('No stage recorded here yet')}</p>
      <p><strong>{t('track.next', 'Next date')}:</strong> {record.nextDate ?? t('track.noNext', 'No next date recorded here yet')}</p>
      <h3 className="mt-3 font-semibold">{t('track.history', 'What has happened so far')}</h3>
      {record.hearingDates.length ? <ol className="text-sm">{record.hearingDates.map(date => <li key={date}>{date}: {ui('Hearing')}</li>)}</ol>
        : <p className="text-sm">{t('track.noHistory', 'No hearings recorded here yet.')}</p>}
      <HearingBreakdowns record={record} />
    </section>}

    <CitizenSettlementEstimator />

    <details className="panel mt-4">
      <summary className="font-semibold">{t('track.glossary', 'What the stages mean')}</summary>
      <dl className="text-sm">{Object.entries(STAGE_GLOSSARY).map(([stage, meaning]) => <div key={stage} className="mt-1">
        <dt className="font-medium capitalize">{ui(stage)}</dt><dd>{ui(meaning)}</dd>
      </div>)}</dl>
    </details>
  </Page>;
}
