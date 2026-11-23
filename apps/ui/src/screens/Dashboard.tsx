import { ui } from '../lib/i18n';
import { useState } from 'react';
import type { Card, Lane } from '@courtplus/contracts';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Icon } from '../components/icons';
import { btn, ErrorNote, errMsg, Page } from '../components/ui';
import { todayIST, useApp } from '../lib/context';
import { weeklyActivity } from '../lib/dashboard';
import { useWorkData, type WorkData } from '../lib/deadlines';
import chhattisgarh from '../../../../data/stats/chhattisgarh.json';
import { dashboardTitle, useRole, type RoleGroup } from '../lib/roles';
import { RightsAdvisor } from './RightsAdvisor';
import { CourtBacklogPanel } from './CourtBacklogPanel';

const regionIndicators = [
  { id: 'cg-undertrial-share', label: 'Undertrial share', max: 100 },
  { id: 'cg-occupancy', label: 'Prison occupancy', max: 150 },
  { id: 'cg-utrc-identified', label: 'Identified for review' },
  { id: 'cg-utrc-recommended', label: 'Release recommended' },
  { id: 'cg-utrc-released', label: 'Released' },
];
const axis = { fontSize: 11, fill: 'var(--muted)' };
const tooltip = { border: '1px solid var(--border)', borderRadius: 12 };

export function Dashboard() {
  const role = useRole();
  return role === 'citizen' ? <RightsAdvisor title={ui(dashboardTitle(role))} /> : <WorkDashboard role={role} />;
}

function WorkDashboard({ role }: { role: RoleGroup }) {
  const { data, error } = useWorkData();
  return <Page title={ui(dashboardTitle(role))}>
    <ErrorNote error={error} />
    {!data?.boardIncluded && !error && <p role="status">{ui('Loading dashboard…')}</p>}
    {data?.boardIncluded && <section aria-label={ui('Undertrial release check')}>
      <h2 className="mb-2 text-lg font-semibold">{ui('Undertrial release check')}</h2>
      <DashboardContent data={data} showActivityTrend={role === 'lawyer'} />
    </section>}
    {/* Judge view order: release check (with deadlines) first, then court backlog, official benchmarks last. */}
    {role === 'judge' && <CourtBacklogPanel caseCount={data?.cases.length} caseError={error} />}
  </Page>;
}

function DashboardContent({ data, showActivityTrend }: { data: WorkData; showActivityTrend: boolean }) {
  const today = todayIST();
  const open = data.cards.filter(card => card.state !== 'closed');
  const openCount = (lane: Lane) => open.filter(card => card.lane === lane).length;
  const applyNow = openCount('APPLY_NOW');
  const review = openCount('LAWYER_REVIEW');
  const closedIds = new Set([
    ...data.cards.filter(card => card.state === 'closed').map(card => card.id),
    ...(data.activity?.closedCards.map(card => card.cardId) ?? []),
  ]);
  const requiringAction = new Set(open.map(card => card.caseId)).size;

  return <div className="dashboard">
    {data.screeningFailures > 0 && <p role="status" className="partial-note">
      {ui(data.screeningFailures === 1 ? 'Screening unavailable for {count} saved case.' : 'Screening unavailable for {count} saved cases.', { count: data.screeningFailures })} {ui('Some dates may be missing.')}
    </p>}
    <div className="dashboard-summary" style={showActivityTrend ? undefined : {
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
    }}>
      <section className="panel overview-hero" aria-labelledby="overview-title">
        <h2 id="overview-title">{ui("Overview")}</h2>
        <div className="hero-numbers">
          <div><strong>{data.cases.length}</strong><span>{ui("Cases saved")}</span></div>
          <div><strong>{requiringAction}</strong><span>{ui("Cases needing action")}</span></div>
        </div>
        <div className="hero-tiles">
          <BoardMetric label={ui("Apply now")} count={applyNow} />
          <BoardMetric label={ui("Needs a lawyer")} count={review} />
          <BoardMetric label={ui("Closed")} count={closedIds.size} />
        </div>
      </section>
      {showActivityTrend && <TrendChart weeks={weeklyActivity(data.cases, data.activity, today)} />}
      <MonthlyProgress open={open.length} applyNow={applyNow} review={review}
        closed={data.activity?.closedCards.filter(card => card.on && card.on.startsWith(today.slice(0, 7)) && card.on <= today).length ?? null} />
    </div>
    <div className="dashboard-detail">
      <Attention cards={open} empty={!data.cases.length} due={openCount('DUE_30')} mismatch={openCount('COURT_JAIL_MISMATCH')} />
      <RegionCard />
      <DeadlinesChart alerts={data.alerts} today={today} />
    </div>
  </div>;
}

function BoardMetric({ label, count }: { label: string; count: number }) {
  return <Link className="board-metric" to="/board" aria-label={`${label}: ${count}`}>
    <strong>{count}</strong><span>{label}</span>
  </Link>;
}

function TrendChart({ weeks }: { weeks: ReturnType<typeof weeklyActivity> }) {
  const previous = weeks.at(-2)?.filed ?? 0;
  const latest = weeks.at(-1)?.filed ?? 0;
  const change = previous ? Math.round(100 * (latest - previous) / previous) : null;
  const badge = change !== null ? `${change > 0 ? '+' : ''}${change}%` : latest ? ui('New') : '';
  const points = weeks.map((week, index) => ({ ...week, badge: index === weeks.length - 1 ? badge : '' }));
  return <section className="panel trend-panel" aria-labelledby="trend-title">
    <div className="panel-heading"><h2 id="trend-title">{ui("Cases filed vs resolved")}</h2></div>
    {weeks.length ? <>
      <div className="chart weekly-chart" role="img" aria-label={ui("Cases saved and cases resolved per week, for the last 8 weeks. Values are listed below.")}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} margin={{ top: 28, right: 24, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={17} />
            <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltip} />
            <Line type="monotone" dataKey="resolved" name={ui('Resolved')} stroke="var(--chart-secondary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="filed" name={ui('Saved')} stroke="var(--ink)" strokeWidth={2.5} dot={false} isAnimationActive={false}>
              <LabelList dataKey="badge" content={({ value, viewBox }) => {
                if (!value || !viewBox || !('x' in viewBox && 'y' in viewBox)) return null;
                const { x, y } = viewBox;
                if (x === undefined || y === undefined) return null;
                return <g aria-hidden="true">
                  <circle cx={x} cy={y} r={4} fill="var(--accent)" />
                  <rect x={x - 24} y={y - 27} width={48} height={19} rx={9.5} fill="var(--accent)" />
                  <text x={x} y={y - 14} textAnchor="middle" fill="var(--accent-text)" fontSize={11} fontWeight={700}>{value}</text>
                </g>;
              }} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend"><span>{ui("Saved")}</span><span>{ui("Resolved")}</span></div>
      <details className="trend-details">
        <summary>{ui("Weekly figures")}</summary>
        {change !== null && <p>{ui('Cases saved changed by')} {badge} {ui('from the previous week.')}</p>}
        {badge === 'New' && <p>{ui("No cases were saved in the previous week.")}</p>}
        <table><thead><tr><th scope="col">{ui("Week of")}</th><th scope="col">{ui("Saved")}</th><th scope="col">{ui("Resolved")}</th></tr></thead>
          <tbody>{weeks.map(week => <tr key={week.start}><th scope="row">{week.label}</th><td>{week.filed}</td><td>{week.resolved}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <div className="chart-empty"><Icon name="stats" size={28} /><p>{ui("Import orders to see your trend")}</p><small>{ui("Shows the last 8 weeks once 2 weeks have recorded activity.")}</small></div>}
  </section>;
}

function MonthlyProgress({ open, applyNow, review, closed }: { open: number; applyNow: number; review: number; closed: number | null }) {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const total = open + (closed ?? 0);
  const share = closed !== null && total ? Math.round(100 * closed / total) : null;

  async function download() {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const path = await api.exportScReturn(todayIST(), 'xlsx');
      setMessage(path ? 'SC return saved to ' + path : 'SC return downloaded.');
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return <section className="panel month-panel" aria-labelledby="month-title">
    <h2 id="month-title">{ui("This month")}</h2>
    <div className="progress-ring" style={{ background: `conic-gradient(var(--ink) ${share ?? 0}%, var(--track) 0)` }}>
      <div><strong>{share === null ? '—' : `${share}%`}</strong><span>{ui('of cards closed')}</span></div>
    </div>
    <p className="month-note">{closed === null ? ui('Dated local activity unavailable') : total ? `${closed} ${ui('closed this month')} · ${open} ${ui('still open')}` : ui('No cards this month')}</p>
    <ul className="month-legend">
      <li><Icon name="check" size={14} /><span>{ui("Apply now")}</span><strong>{applyNow}</strong></li>
      <li><Icon name="people" size={14} /><span>{ui("Review")}</span><strong>{review}</strong></li>
      <li><Icon name="verify" size={14} /><span>{ui("Closed")}</span><strong>{closed ?? '—'}</strong></li>
    </ul>
    <button className={btn} disabled={busy} onClick={() => void download()}><Icon name="download" size={16} />{busy ? ui("Downloading…") : ui("Download report")}</button>
    <ErrorNote error={error} />
    {message && <p className="muted break-all" role="status">{message}</p>}
  </section>;
}

function Attention({ cards, empty, due, mismatch }: { cards: Card[]; empty: boolean; due: number; mismatch: number }) {
  const soonest = [...cards].sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || a.title.localeCompare(b.title)).slice(0, 3);
  return <section className="panel attention-panel" aria-labelledby="attention-title">
    <div className="panel-heading"><h2 id="attention-title">{ui("Needs attention")}</h2><Link className="panel-link" to="/board">{ui("View all") + " "}<Icon name="arrow" size={15} /></Link></div>
    <div className="attention-metrics"><BoardMetric label={ui("Due in 30 days")} count={due} /><BoardMetric label={ui("Court/jail mismatch")} count={mismatch} /></div>
    {!soonest.length && <p className="muted">{empty ? ui("No cases saved yet") : ui("No open cards")}</p>}
    <div className="attention-list">
      {soonest.map(card => <Link className="attention-task" key={card.id} to={`/case/${encodeURIComponent(card.caseId)}`}>
        <Icon name={card.dueOn ? 'calendar' : 'cases'} size={17} /><strong>{card.title}</strong>
        {card.dueOn ? <time dateTime={card.dueOn}>{ui("Due") + " "}{card.dueOn}</time> : <span>{ui("No due date")}</span>}
      </Link>)}
      <Link className="attention-add" to="/import"><Icon name="plus" size={19} />{" " + ui("Import order")}</Link>
    </div>
  </section>;
}

function RegionCard() {
  const identified = chhattisgarh.figures.find(figure => figure.id === 'cg-utrc-identified' && figure.verified)?.value;
  return <section className="panel region-panel" aria-labelledby="region-title">
    <div className="panel-heading"><h2 id="region-title">{ui("Chhattisgarh at a glance")}</h2><Link className="panel-link" to="/stats">{ui("Statistics") + " "}<Icon name="arrow" size={15} /></Link></div>
    <div className="overview-list">{regionIndicators.map(({ id, label, max }) => {
      const figure = chhattisgarh.figures.find(item => item.id === id && item.verified);
      if (!figure) return null;
      const scale = Math.max(max ?? identified ?? figure.value, figure.value, 1);
      return <div className="overview-row" key={id}>
        <div className="overview-label"><span>{ui(label)}</span><strong>{figure.value}{max ? '%' : ''}</strong></div>
        <div className="progress-track" aria-hidden="true"><span style={{ width: `${100 * figure.value / scale}%` }} /></div>
        <p><a href={figure.url} target="_blank" rel="noreferrer">{figure.source}</a> · {figure.date}</p>
      </div>;
    })}</div>
  </section>;
}

function DeadlinesChart({ alerts, today }: { alerts: WorkData['alerts']; today: string }) {
  const counts = new Map<string, number>();
  for (const { on } of alerts) {
    if (on >= today && on.startsWith(today.slice(0, 7))) counts.set(on, (counts.get(on) ?? 0) + 1);
  }
  const points = [...counts].map(([on, count]) => ({ on, day: on.slice(-2), count }));
  return <section className="panel deadlines-panel" aria-labelledby="deadline-chart-title">
    <div className="panel-heading"><h2 id="deadline-chart-title">{ui("Deadlines this month")}</h2><Link className="panel-link" to="/calendar">{ui("Open calendar") + " "}<Icon name="arrow" size={15} /></Link></div>
    {points.length ? <div className="chart" role="img" aria-label={points.map(({ on, count }) => ui('{date}: {count} dated alerts', { date: on, count })).join('. ')}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={points} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
          <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltip} />
          <Bar dataKey="count" name={ui('Dated alerts')} fill="var(--ink)" radius={[5, 5, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div> : <div className="chart-empty"><Icon name="calendar" size={26} /><p>{ui("No upcoming dated alerts this month.")}</p></div>}
  </section>;
}
