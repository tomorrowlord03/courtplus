import { NavLink, Route, Routes } from 'react-router-dom';
import { useApp, type View } from './lib/context';
import { RIGHTS_CARD_LANGS, t, useLang } from './lib/i18n';
import { ImportOrder } from './screens/ImportOrder';
import { Board } from './screens/Board';
import { CaseList, CaseView } from './screens/CaseView';
import { PersonView, PersonList } from './screens/PersonView';
import { Drafts } from './screens/Drafts';
import { ScReturn } from './screens/ScReturn';
import { Verifier } from './screens/Verifier';
import { Stats } from './screens/Stats';
import { Safeguards } from './screens/Safeguards';

const NAV: [string, string, string][] = [
  ['/', 'nav.board', 'Action board'],
  ['/import', 'nav.import', 'Import order'],
  ['/cases', 'nav.cases', 'Cases'],
  ['/persons', 'nav.persons', 'People'],
  ['/drafts', 'nav.drafts', 'Drafts'],
  ['/sc-return', 'nav.sc', 'SC return'],
  ['/verify', 'nav.verify', 'Verifier'],
  ['/stats', 'nav.stats', 'Statistics'],
  ['/safeguards', 'nav.safeguards', 'Safeguards'],
];

export function App() {
  const { view, setView } = useApp();
  const [lang, setLang] = useLang();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:bg-white focus:p-2">Skip to content</a>
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <strong className="text-lg">CourtPlus</strong>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            Language
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded border border-slate-400 px-2 py-1"
            >
              {RIGHTS_CARD_LANGS.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            View
            <select
              value={view}
              onChange={(e) => setView(e.target.value as View)}
              className="rounded border border-slate-400 px-2 py-1"
            >
              <option value="legal_aid">Legal-aid view</option>
              <option value="utrc">Review committee (UTRC) view</option>
            </select>
          </label>
        </div>
      </header>
      <div className="flex">
        <nav aria-label="Main" className="w-44 shrink-0 border-r bg-white p-2">
          <ul className="space-y-1">
            {NAV.map(([to, key, label]) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm ${isActive ? 'bg-blue-700 font-semibold text-white' : 'hover:bg-slate-100'}`
                  }
                >
                  {t(key, label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 p-4">
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/import" element={<ImportOrder />} />
            <Route path="/cases" element={<CaseList />} />
            <Route path="/case/:caseId" element={<CaseView />} />
            <Route path="/persons" element={<PersonList />} />
            <Route path="/person/:personId" element={<PersonView />} />
            <Route path="/drafts" element={<Drafts />} />
            <Route path="/sc-return" element={<ScReturn />} />
            <Route path="/verify" element={<Verifier />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/safeguards" element={<Safeguards />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
