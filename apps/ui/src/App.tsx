import { useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './components/icons';
import { TopBar } from './components/TopBar';
import { useApp } from './lib/context';
import { WorkDataProvider } from './lib/deadlines';
import { t } from './lib/i18n';
import { ImportOrder } from './screens/ImportOrder';
import { Board } from './screens/Board';
import { CaseList, CaseView } from './screens/CaseView';
import { PersonView, PersonList } from './screens/PersonView';
import { Drafts } from './screens/Drafts';
import { ScReturn } from './screens/ScReturn';
import { Verifier } from './screens/Verifier';
import { Stats } from './screens/Stats';
import { Safeguards } from './screens/Safeguards';
import { Dashboard } from './screens/Dashboard';
import { DeadlineCalendar } from './screens/DeadlineCalendar';
import { ProfileScreen } from './screens/Profile';
import { EvidenceInbox } from './screens/EvidenceInbox';
import { SubmitProof } from './screens/SubmitProof';
import { Triage } from './screens/Triage';
import { Adjournment } from './screens/Adjournment';
import { HearingRecorder } from './screens/HearingRecorder';
import { HearingTranscript } from './screens/HearingTranscript';
import { CaseAnalyzer } from './screens/CaseAnalyzer';
import { SettlementAnalyzer, SettlementDraft } from './screens/SettlementAnalyzer';

const NAV: { to: string; key: string; label: string; icon: IconName }[] = [
  { to: '/', key: 'dashboard', label: 'Release Dashboard', icon: 'home' },
  { to: '/calendar', key: 'calendar', label: 'Deadline Calendar', icon: 'calendar' },
  { to: '/triage', key: 'triage', label: 'Smart triage', icon: 'cases' },
  { to: '/board', key: 'nav.board', label: 'Action board', icon: 'board' },
  { to: '/import', key: 'nav.import', label: 'Import order', icon: 'import' },
  { to: '/cases', key: 'nav.cases', label: 'Cases', icon: 'cases' },
  { to: '/persons', key: 'nav.persons', label: 'People', icon: 'people' },
  { to: '/drafts', key: 'nav.drafts', label: 'Drafts', icon: 'drafts' },
  { to: '/lawyer', key: 'lawyerTools', label: 'Lawyer tools', icon: 'cases' },
  { to: '/sc-return', key: 'nav.sc', label: 'SC return', icon: 'sheet' },
  { to: '/verify', key: 'nav.verify', label: 'Verifier', icon: 'verify' },
  { to: '/evidence', key: 'nav.evidence', label: 'Evidence vault', icon: 'verify' },
  { to: '/submit-proof', key: 'nav.submitProof', label: 'Submit proof', icon: 'import' },
  { to: '/hearings', key: 'nav.hearings', label: 'Hearing recorder', icon: 'mic' },
  { to: '/stats', key: 'nav.stats', label: 'Statistics', icon: 'stats' },
  { to: '/safeguards', key: 'nav.safeguards', label: 'Safeguards', icon: 'shield' },
];

const promptKey = 'courtplus.profilePromptDismissed';

function dismissedProfilePrompt() {
  try { return localStorage.getItem(promptKey) === 'yes'; } catch { return false; }
}

export function App({ importScreen, settingsScreen }: { importScreen?: ReactNode; settingsScreen?: ReactNode } = {}) {
  const { profile } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedProfilePrompt);
  const { pathname } = useLocation();

  function dismissPrompt() {
    setDismissed(true);
    try { localStorage.setItem(promptKey, 'yes'); } catch { /* Storage may be disabled. */ }
  }

  return <WorkDataProvider page={pathname}>
    <a href="#main" className="skip-link" onClick={event => {
      event.preventDefault();
      document.getElementById('main')?.focus();
    }}>Skip to content</a>
    <div className={'app-shell' + (collapsed ? ' sidebar-collapsed' : '')}>
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark"><Icon name="brand" size={20} /></span>
          <strong className="sidebar-label">CourtPlus</strong>
        </div>
        <p className="nav-heading sidebar-label">Workspace</p>
        <nav aria-label="Main"><ul className="nav-list">{NAV.filter(item => item.to !== '/triage' || (window.courtplusJudge && profile?.role === 'judge')).map(({ to, key, label, icon }) => <li key={to}>
          <NavLink to={to} end={to === '/'} title={t(key, label)} aria-label={t(key, label)} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <Icon name={icon} /><span className="sidebar-label">{t(key, label)}</span>
          </NavLink>
        </li>)}</ul></nav>
        <div className="sidebar-bottom">
          {settingsScreen && <NavLink to="/settings" title="Settings" aria-label="Settings" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <Icon name="settings" /><span className="sidebar-label">Settings</span>
          </NavLink>}
          <button className="nav-item collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
            <Icon name={collapsed ? 'expand' : 'collapse'} /><span className="sidebar-label">Collapse</span>
          </button>
        </div>
      </aside>
      <div className="app-content">
        <TopBar />
        <main id="main" tabIndex={-1} className="main-content">
          {profile === null && !dismissed && pathname === '/' && <aside className="profile-prompt" aria-label="Set up your profile">
            <Icon name="person" /><p><strong>Personalise CourtPlus</strong><span>Set your role and preferred language.</span></p>
            <Link to="/profile" className="button secondary" onClick={dismissPrompt}>Set up profile</Link>
            <button className="text-button" onClick={dismissPrompt}>Skip for now</button>
          </aside>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/calendar" element={<DeadlineCalendar />} />
            <Route path="/triage" element={<Triage />} />
            <Route path="/triage/adjournment" element={<Adjournment />} />
            <Route path="/board" element={<Board />} />
            <Route path="/import" element={importScreen ?? <ImportOrder />} />
            <Route path="/cases" element={<CaseList />} />
            <Route path="/case/:caseId" element={<CaseView />} />
            <Route path="/persons" element={<PersonList />} />
            <Route path="/person/:personId" element={<PersonView />} />
            <Route path="/drafts" element={<Drafts />} />
            <Route path="/drafts/settlement" element={<SettlementDraft />} />
            <Route path="/lawyer" element={<SettlementAnalyzer />} />
            <Route path="/lawyer/case" element={<CaseAnalyzer />} />
            <Route path="/sc-return" element={<ScReturn />} />
            <Route path="/verify" element={<Verifier />} />
            <Route path="/evidence" element={<EvidenceInbox />} />
            <Route path="/submit-proof" element={<SubmitProof initialRole="citizen" />} />
            <Route path="/file-evidence" element={<SubmitProof initialRole="lawyer" />} />
            <Route path="/hearings" element={<HearingRecorder />} />
            <Route path="/hearings/:id" element={<HearingTranscript />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/safeguards" element={<Safeguards />} />
            <Route path="/profile" element={<ProfileScreen />} />
            {settingsScreen && <Route path="/settings" element={settingsScreen} />}
          </Routes>
        </main>
      </div>
    </div>
  </WorkDataProvider>;
}
