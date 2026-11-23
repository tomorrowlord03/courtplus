import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Person } from '@courtplus/contracts';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { addDays, todayIST, useApp, type View } from '../lib/context';
import { useWorkData } from '../lib/deadlines';
import { Icon } from './icons';

export function TopBar() {
  const { profile, view, setView } = useApp();
  const { data, error } = useWorkData();
  const today = todayIST();
  const limit = addDays(today, 7);
  const count = data?.alerts.filter(alert => alert.on >= today && alert.on <= limit).length;
  const partial = Boolean(error || data?.screeningFailures);
  const names = profile?.fullName.trim().split(/\s+/);
  const initials = names ? [names[0], ...(names.length > 1 ? [names[names.length - 1]] : [])]
    .map(name => Array.from(name)[0]).join('').toLocaleUpperCase() : null;
  const bellLabel = error ? 'Deadline Calendar, count unavailable'
    : count === undefined ? 'Deadline Calendar'
    : `${count} ${count === 1 ? 'deadline' : 'deadlines'} due in the next 7 days${partial ? ', some dates unavailable' : ''}`;

  return <header className="topbar">
    <div className="topbar-greeting">
      <p>{names ? `Hi, ${names[0]}!` : 'Welcome'}</p>
      {profile?.office && <span title={profile.office}>{profile.office}</span>}
    </div>
    <label className="view-control">
      <span className="sr-only">Active view</span>
      <select value={view} onChange={event => setView(event.target.value as View)}>
        <option value="legal_aid">Legal-aid view</option>
        <option value="utrc">Review committee view</option>
      </select>
    </label>
    <div className="topbar-actions">
      <AliasSearch />
      <Link className="button secondary quick-link" to="/board"><Icon name="board" size={16} /> Board</Link>
      <Link className="button secondary quick-link" to="/calendar"><Icon name="calendar" size={16} /> Calendar</Link>
      <Link className="button primary" to="/import"><Icon name="plus" size={18} /> Import order</Link>
      <Link to="/calendar" className="icon-button deadline-bell" aria-label={bellLabel} title={bellLabel}>
        <Icon name="bell" />
        {count !== undefined && <span className="bell-count" aria-hidden="true">{count}</span>}
      </Link>
      <Link className="icon-button profile-avatar" to="/profile" aria-label="My profile" title="My profile">
        {initials ?? <Icon name="person" />}
      </Link>
    </div>
  </header>;
}

function AliasSearch() {
  const { api } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const term = query.trim().toLocaleLowerCase();
  const searching = open && term.length > 0;

  useEffect(() => { setQuery(''); setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!searching) return;
    let live = true;
    setFailed(false);
    void api.listPersons().then(result => { if (live) setPeople(result); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, searching]);

  const matches = people?.filter(person => person.caseIds.length && person.alias.toLocaleLowerCase().includes(term)).slice(0, 8) ?? [];
  const destination = (person: Person) => person.caseIds.length === 1
    ? `/case/${encodeURIComponent(person.caseIds[0])}`
    : `/person/${encodeURIComponent(person.id)}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = matches.find(person => person.alias.toLocaleLowerCase() === term) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!failed && match) { setOpen(false); navigate(destination(match)); }
  }

  return <form role="search" className="alias-search" onSubmit={submit}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <Icon name="search" size={17} />
    <input aria-label="Search cases by alias" aria-controls={searching ? resultsId : undefined}
      type="search" placeholder="Search by alias" value={query} onFocus={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setOpen(true); }} />
    {searching && <div className="search-results" id={resultsId}>
      {failed || !people || !matches.length
        ? <p role="status">{failed ? 'Search unavailable' : !people ? 'Searching…' : 'No matching aliases'}</p>
        : <ul aria-label="Matching aliases">{matches.map(person => <li key={person.id}>
          <Link to={destination(person)} onClick={() => setOpen(false)}>
            <strong>{person.alias}</strong><span>{person.caseIds.length} {person.caseIds.length === 1 ? 'case' : 'cases'}</span>
          </Link>
        </li>)}</ul>}
    </div>}
  </form>;
}
