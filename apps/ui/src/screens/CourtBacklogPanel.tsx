import { useEffect, useState } from 'react';
import type { AgingBucket, BenchBacklogSummary, CourtBacklog, JudgeMetric } from '@courtplus/contracts';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import india from '../../../../data/stats/india.json';
import { backlogFigures } from '../components/IndiaBacklog';
import { Empty, ErrorNote, errMsg } from '../components/ui';
import { todayIST, useApp } from '../lib/context';
import { ui } from '../lib/i18n';

const ageBands: { key: keyof AgingBucket; label: string }[] = [
  { key: 'under1Year', label: '<1 year' },
  { key: 'oneToThreeYears', label: '1–<3 years' },
  { key: 'threeToFiveYears', label: '3–<5 years' },
  { key: 'fiveToTenYears', label: '5–10 years' },
  { key: 'overTenYears', label: '>10 years' },
];
const count = new Intl.NumberFormat('en-IN');
const decimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const axis = { fontSize: 11, fill: 'var(--muted)' };

export function CourtBacklogPanel({ caseCount, caseError }: { caseCount?: number; caseError: string | null }) {
  const { api } = useApp();
  const today = todayIST();
  const [asOf, setAsOf] = useState(today);
  const [selectedJudge, setSelectedJudge] = useState('');
  const [loaded, setLoaded] = useState<{ date: string; summary?: BenchBacklogSummary; error?: string }>();
  const hasCases = Boolean(caseCount);
  const analyticsAvailable = typeof api.judgeDashboard === 'function';

  useEffect(() => {
    if (!caseCount || !analyticsAvailable) return;
    let active = true;
    setLoaded(undefined);
    api.judgeDashboard(asOf)
      .then(summary => {
        if (active) setLoaded({ date: asOf, summary });
      })
      .catch(error => {
        if (active) setLoaded({ date: asOf, error: errMsg(error) });
      });
    return () => { active = false; };
  }, [api, asOf, caseCount, analyticsAvailable]);

  const current = hasCases && loaded?.date === asOf ? loaded : undefined;
  const judges = current?.summary?.judges;
  const judge = judges?.find(item => item.judgeName === selectedJudge);

  return <>
    <section className="panel" aria-labelledby="court-backlog-title">
      <h2 id="court-backlog-title">{ui('Court backlog')}</h2>
      {hasCases && analyticsAvailable && <div className="mb-4 flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block">{ui('Judge or bench')}</span>
          <select className="field-control" value={judge?.judgeName ?? ''} onChange={event => setSelectedJudge(event.target.value)}>
            <option value="">{ui('Entire bench')}</option>
            {judges?.map(item => <option value={item.judgeName} key={item.judgeName}>{item.judgeName}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block">{ui('As of date')}</span>
          <input className="field-control" type="date" value={asOf} max={today}
            onChange={event => { if (event.target.value) setAsOf(event.target.value); }} />
        </label>
        {asOf !== today && <button className="text-button" type="button" onClick={() => setAsOf(today)}>{ui('Reset to today')}</button>}
      </div>}
      <ErrorNote error={current?.error ?? null} />
      {((caseCount === undefined && !caseError) || (hasCases && analyticsAvailable && !current)) &&
        <p role="status">{ui('Loading court backlog…')}</p>}
      {hasCases && !analyticsAvailable && <p>{ui('Court backlog data is unavailable.')}</p>}
      {(caseCount === 0 || judges?.length === 0) &&
        <Empty title={ui(caseCount === 0 ? 'No case data recorded yet' : 'No case data for this date')}
          hint={ui('Import an order to start recording case activity.')} to="/import" cta={ui('Import an order')} />}
      {judges && judges.length > 0 && <CourtMetrics judges={judge ? [judge] : judges} />}
      {judges && judges.length > 1 && <div className="mt-4 overflow-x-auto">
        <h3>{ui('Bench roster')}</h3>
        <table className="w-full text-left">
          <thead><tr><th scope="col">{ui('Judge')}</th><th scope="col">{ui('Courtroom')}</th><th scope="col">{ui('Active')}</th>
            <th scope="col">{ui('Disposed')}</th><th scope="col">{ui('Adjournments')}</th><th scope="col">{ui('Average case age')}</th></tr></thead>
          <tbody>{judges.map(item => <tr key={item.judgeName}>
            <th scope="row"><button className="text-button" type="button" onClick={() => setSelectedJudge(item.judgeName)}>{item.judgeName}</button></th>
            <td>{item.courtRoom ?? '—'}</td><td>{count.format(item.activeCases)}</td><td>{count.format(item.disposedCases)}</td>
            <td>{count.format(item.totalAdjournmentsGranted)}</td>
            <td>{item.avgCaseLifespanDays ? `${count.format(item.avgCaseLifespanDays)} days` : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
    <OfficialBenchmarks />
  </>;
}

function CourtMetrics({ judges }: { judges: JudgeMetric[] }) {
  const sum = (field: 'activeCases' | 'disposedCases' | 'totalAdjournmentsGranted') =>
    judges.reduce((total, judge) => total + judge[field], 0);
  const active = sum('activeCases');
  const disposed = sum('disposedCases');
  const adjournments = sum('totalAdjournmentsGranted');
  const weeksByStart = new Map<string, CourtBacklog['weeks'][number]>();
  for (const judge of judges) {
    for (const week of judge.weeks ?? []) {
      const total = weeksByStart.get(week.start) ?? { start: week.start, filed: 0, disposed: 0 };
      total.filed += week.filed;
      total.disposed += week.disposed;
      weeksByStart.set(week.start, total);
    }
  }
  const weeks = [...weeksByStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  const filedInPeriod = weeks.reduce((total, week) => total + week.filed, 0);
  const disposedInPeriod = weeks.reduce((total, week) => total + week.disposed, 0);
  const ages = ageBands.map(({ key, label }) => ({
    label: ui(label), count: judges.reduce((total, judge) => total + judge.aging[key], 0),
  }));
  const cards = [
    { label: 'Clearance rate', value: filedInPeriod ? `${decimal.format(100 * disposedInPeriod / filedInPeriod)}%` : '—',
      note: 'Last 8 weeks · disposed ÷ filed' },
    { label: 'Active docket', value: count.format(active) },
    { label: 'Disposed matters', value: count.format(disposed) },
    { label: 'Adjournment ratio', value: disposed ? decimal.format(adjournments / disposed) : '—',
      note: `${count.format(adjournments)} recorded adjournments · ratio per disposal` },
  ];
  return <>
    <dl className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, note }) => <div className="rounded-lg border border-[var(--border)] p-3" key={label}>
        <dt>{ui(label)}</dt><dd className="text-2xl font-semibold">{value}</dd>
        {note && <dd className="muted text-sm">{ui(note)}</dd>}
      </div>)}
    </dl>
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="filings-title">
        <h3 id="filings-title">{ui('Filed and disposed per week')}</h3>
        {weeks.length ? <>
          <div className="h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={weeks} margin={{ top: 10, right: 12, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                <XAxis dataKey="start" tick={axis} tickFormatter={(on: string) => on.slice(5)} />
                <YAxis allowDecimals={false} tick={axis} />
                <Tooltip />
                <Line dataKey="filed" name={ui('Filed')} stroke="var(--ink)" strokeWidth={2.5} isAnimationActive={false} />
                <Line dataKey="disposed" name={ui('Disposed')} stroke="var(--chart-secondary)" strokeWidth={2.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend" aria-hidden="true"><span>{ui('Filed')}</span><span>{ui('Disposed')}</span></div>
          <details className="trend-details">
            <summary>{ui('Weekly figures')}</summary>
            <table><thead><tr><th scope="col">{ui('Week of')}</th><th scope="col">{ui('Filed')}</th><th scope="col">{ui('Disposed')}</th></tr></thead>
              <tbody>{weeks.map(week => <tr key={week.start}>
                <th scope="row">{week.start}</th><td>{count.format(week.filed)}</td><td>{count.format(week.disposed)}</td>
              </tr>)}</tbody>
            </table>
          </details>
        </> : <p>{ui('No confirmed filing or disposal dates in the last eight weeks.')}</p>}
      </section>
      <section aria-labelledby="ageing-title">
        <h3 id="ageing-title">{ui('Pending cases by age')}</h3>
        {ages.some(age => age.count > 0) ? <>
          <div className="h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={ages} margin={{ top: 10, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                <XAxis dataKey="label" tick={axis} />
                <YAxis allowDecimals={false} tick={axis} />
                <Tooltip />
                <Bar dataKey="count" name={ui('Pending cases')} fill="var(--ink)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-wrap gap-3">{ages.map(age =>
            <li key={age.label}>{ui(age.label)} · <strong>{count.format(age.count)}</strong></li>)}</ul>
        </> : <p>{ui('No pending cases with confirmed filing dates.')}</p>}
      </section>
    </div>
  </>;
}

function OfficialBenchmarks() {
  const additional = [
    { after: 'district-10y-india', id: 'district-10y-cg', short: 'District court cases pending 10+ years, Chhattisgarh' },
    { after: 'hc-judge-vacancy-india', id: 'hc-judge-vacancy-cg', short: 'High Court judge posts vacant, Chhattisgarh' },
  ];
  const figures = backlogFigures().flatMap(figure => {
    const entry = additional.find(item => item.after === figure.id);
    const state = india.figures.find(item => item.id === entry?.id && item.verified);
    return entry && state ? [figure, { ...state, short: entry.short }] : [figure];
  });
  return <section className="panel" aria-labelledby="court-benchmarks-title">
    <h2 id="court-benchmarks-title">{ui('Official backlog benchmarks')}</h2>
    <ul className="overview-list">{figures.map(figure => <li className="overview-row" key={figure.id}>
      <div className="overview-label"><span>{ui(figure.short)}</span><strong>{count.format(figure.value)}</strong></div>
      <p><a href={figure.url} target="_blank" rel="noreferrer">{figure.source}</a> · {figure.date}</p>
    </li>)}</ul>
  </section>;
}
