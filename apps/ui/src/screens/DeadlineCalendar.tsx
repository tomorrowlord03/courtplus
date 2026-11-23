import { ui } from '../lib/i18n';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorNote } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import { todayIST } from '../lib/context';
import { useWorkData } from '../lib/deadlines';

function shiftMonth(month: string, offset: number) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
}
function monthCells(month: string) {
  const [year, index] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  return [...Array.from({ length: offset }, () => ''), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}
export function DeadlineCalendar() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const { data, error } = useWorkData();
  const monthAlerts = data?.alerts.filter((a) => a.on.startsWith(month)) ?? [];
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return <ScreenPage screenId="calendar" note={ui("Dates come from release rules and confirmed case records.")}>
    <ErrorNote error={error}/>
    {!data && !error && <p role="status">{ui("Loading calendar…")}</p>}
    {data && data.screeningFailures > 0 && <p role="status" className="partial-note">Screening unavailable for {data.screeningFailures} saved case{data.screeningFailures === 1 ? '' : 's'}. Their dates may be missing; check the case records.</p>}
    {data && <div className="calendar-layout">
      <section className="panel" aria-label={ui("Month view")}>
        <div className="calendar-toolbar"><button className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={ui("Previous month")}>‹</button><h2 aria-live="polite">{title}</h2><button data-guide="start" className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={ui("Next month")}>›</button></div>
        <div className="calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <div key={day} className="calendar-weekday">{day}</div>)}
          {monthCells(month).map((date, i) => <div key={date || `empty-${i}`} className={`calendar-day ${date === todayIST() ? 'today' : ''} ${!date ? 'blank' : ''}`}>
            {date && <><span aria-current={date === todayIST() ? 'date' : undefined}>{Number(date.slice(-2))}</span>{monthAlerts.filter((a) => a.on === date).map((a, j) => <Link key={`${a.caseId}-${a.kind}-${j}`} to={`/case/${encodeURIComponent(a.caseId)}`} title={`${a.caseLabel}: ${a.label}`} className="calendar-event">{a.caseLabel}</Link>)}</>}
          </div>)}
        </div>
      </section>
      <section className="panel" aria-labelledby="dated-alerts-title"><div className="panel-heading"><h2 id="dated-alerts-title">{ui("Dated alerts")}</h2><span className="count-chip">{monthAlerts.length}</span></div>
        {data.cases.length === 0 ? <Empty title={ui("No cases saved yet")} hint={ui("Import an order to see case deadlines.")} to="/import" cta={ui("Import order")}/> : monthAlerts.length === 0 ? <p className="muted">No dated alerts in {title}. Use the arrows to inspect another month.</p> :
          <ol className="alert-list">{monthAlerts.map((a, i) => <li key={`${a.caseId}-${a.on}-${a.kind}-${i}`}><time dateTime={a.on}>{a.on}</time><div><Link to={`/case/${encodeURIComponent(a.caseId)}`}>{a.caseLabel}</Link><p>{a.label}</p></div></li>)}</ol>}
      </section>
    </div>}
  </ScreenPage>;
}
