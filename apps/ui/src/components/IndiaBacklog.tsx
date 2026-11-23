import india from '../../../../data/stats/india.json';

// Official data.gov.in figures, shown exactly as published with their source and date.
export const BACKLOG_FIGURES = [
  { id: 'hc-pending-india', label: 'High Court cases pending, India' },
  { id: 'hc-pending-cg', label: 'High Court cases pending, Chhattisgarh' },
  { id: 'district-10y-india', label: 'District court cases pending 10+ years, India' },
  { id: 'hc-judge-vacancy-india', label: 'High Court judge posts vacant, India' },
  { id: 'national-lok-adalat-2025', label: 'Cases disposed in National Lok Adalats, 2025' },
];

export function backlogFigures() {
  return BACKLOG_FIGURES.flatMap(({ id, label }) => {
    const figure = india.figures.find(item => item.id === id && item.verified);
    return figure ? [{ ...figure, short: label }] : [];
  });
}

export function IndiaBacklog() {
  const figures = backlogFigures();
  if (!figures.length) return null;
  return <section className="panel india-backlog" aria-labelledby="india-backlog-title">
    <h2 id="india-backlog-title">India&apos;s backlog</h2>
    <ul className="overview-list">{figures.map(figure => <li key={figure.id} className="overview-row">
      <div className="overview-label"><span>{figure.short}</span><strong>{figure.value.toLocaleString('en-IN')}</strong></div>
      <p><a href={figure.url} target="_blank" rel="noreferrer">{figure.source}</a> · {figure.date}</p>
    </li>)}</ul>
  </section>;
}
