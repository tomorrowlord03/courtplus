import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CaseRecord, ScreeningResult } from '@courtplus/contracts';
import { daysBetween, todayIST, useApp } from '../../lib/context';
import { ui } from '../../lib/i18n';
import { ScreenPage } from '../ScreenIntro';
import { Empty, ErrorNote, btn, btnPrimary, errMsg } from '../ui';
import { CaseText, ResultChip, cardReason, caseReference, chargeText, fullDate, plainReason, resultKind, results, type CaseResult } from './casePresentation';

interface CaseRow {
  record: CaseRecord;
  alias?: string;
  charges: string[];
  result?: ScreeningResult;
}

const longListThreshold = 100;
const filters = Object.keys(results) as CaseResult[];
const priority = (result?: ScreeningResult) => {
  if (!result) return filters.length + 1;
  return result.ceilingUrgent ? -1 : filters.indexOf(resultKind(result));
};

function custodyText({ record, result }: CaseRow) {
  const first = result?.trace.find(step => step.id === 'custody')?.inputs.firstCustody;
  if (typeof first === 'string' && result) {
    const inCustody = result.trace.find(step => step.id === 'follow-up')?.inputs.inCustody;
    const continuous = inCustody === true && result.rawCustodyDays === daysBetween(first, result.asOf) + 1;
    return `${ui(continuous ? 'In custody since' : 'First recorded custody')} ${fullDate(first)} - ${result.rawCustodyDays} ${ui(result.rawCustodyDays === 1 ? 'day' : 'days')}${continuous ? '' : ` ${ui('total in custody')}`}`;
  }
  const start = record.custody.filter(spell => spell.kind === 'judicial' || spell.kind === 'police')
    .map(spell => spell.start).sort()[0];
  return start ? `${ui('Custody first recorded on')} ${fullDate(start)}` : undefined;
}

function CaseCard({ row }: { row: CaseRow }) {
  const { record, alias, charges, result } = row;
  const reason = result && cardReason(result);
  const custody = custodyText(row);
  return <article className="surface-card flex flex-col gap-2">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <h2 className="text-lg font-semibold">
        <Link className="underline" to={`/case/${encodeURIComponent(record.id)}`}>{alias ?? ui('Alias unavailable')}</Link>
      </h2>
      {result ? <ResultChip result={result} /> : <span className="screening-status">{ui('Check unavailable')}</span>}
    </div>
    <p>{[record.court ?? ui('Court unavailable'), caseReference(record)].filter(Boolean).join(' · ')}</p>
    {charges.length > 0 && <ul aria-label={ui('Charges')}>
      {charges.map(charge => <li key={charge}><CaseText>{charge}</CaseText></li>)}
    </ul>}
    {reason && <p><CaseText>{plainReason(reason)}</CaseText></p>}
    {custody && <p className="muted">{custody}</p>}
    {record.orderDate && <p className="muted">{ui('Order dated')} {fullDate(record.orderDate)}</p>}
  </article>;
}

export function CaseCards() {
  const { api } = useApp();
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CaseResult>();

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    const asOf = todayIST();
    async function load() {
      const [cases, people] = await Promise.all([api.listCases(), api.listPersons()]);
      const aliases = new Map(people.map(person => [person.id, person.alias]));
      const cards: CaseRow[] = [];
      // Limit concurrent checks against the desktop store or the appliance.
      for (let i = 0; live && i < cases.length; i += 8) {
        const batch = await Promise.all(cases.slice(i, i + 8).map(async record => {
          const result = await api.screen(record.id, asOf).catch(() => undefined);
          return { record, alias: aliases.get(record.personId), charges: [...new Set(record.charges.map(chargeText))], result };
        }));
        cards.push(...batch);
      }
      if (live) setRows(cards.sort((a, b) => priority(a.result) - priority(b.result) ||
        (a.result?.dueInDays ?? Infinity) - (b.result?.dueInDays ?? Infinity) ||
        (a.alias ?? '').localeCompare(b.alias ?? '')));
    }
    void load().catch(e => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [api]);

  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = rows?.filter(({ alias, record, charges, result }) => {
    if (filter && (!result || resultKind(result) !== filter)) return false;
    const searchable = [alias, record.court, caseReference(record), ...charges].join(' ').toLowerCase();
    return terms.every(term => searchable.includes(term));
  });

  return <ScreenPage screenId="cases" title={ui('Cases')}>
    <ErrorNote error={error} />
    {!rows && !error && <p role="status">{ui('Loading cases…')}</p>}
    {rows?.length === 0 && <Empty title={ui('No cases yet')} hint={ui('Import an order to get started.')} to="/import" cta={ui('Import order')} />}
    {!!rows?.length && <div className="space-y-4">
      <label className="block max-w-lg font-medium">
        {ui('Search cases')}
        <input data-guide="start" type="search" className="field-control mt-1 w-full" placeholder={ui('Alias, section or court')} value={query}
          onChange={event => setQuery(event.target.value)} />
      </label>
      <div role="group" aria-label={ui('Filter by result')} className="flex flex-wrap gap-2">
        <button type="button" className={filter === undefined ? btnPrimary : btn} aria-pressed={filter === undefined}
          onClick={() => setFilter(undefined)}>{ui('All')}</button>
        {filters.map(kind => <button key={kind} type="button" className={filter === kind ? btnPrimary : btn}
          aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{ui(results[kind].label)}</button>)}
      </div>
      {visible?.length === 0 && <p role="status">{ui('No cases match your search and filters.')}</p>}
      <ul aria-label={ui('Cases, most urgent first')} className={'grid grid-cols-1 gap-3 lg:grid-cols-2' + (visible && visible.length >= longListThreshold ? ' case-list-long' : '')}>
        {visible?.map(row => <li key={row.record.id}><CaseCard row={row} /></li>)}
      </ul>
    </div>}
  </ScreenPage>;
}
