import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './components/icons';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { TopBar } from './components/TopBar';
import { useApp } from './lib/context';
import { WorkDataProvider } from './lib/deadlines';
import { t, ui } from './lib/i18n';
import { dashboardTitle, NAV_SECTIONS, setRoleOverride, useRole, type RoleGroup } from './lib/roles';

const ImportOrder = lazy(() => import('./screens/ImportOrder').then(({ ImportOrder }) => ({ default: ImportOrder })));
const Board = lazy(() => import('./screens/Board').then(({ Board }) => ({ default: Board })));
const CaseList = lazy(() => import('./components/cases/CaseCards').then(({ CaseCards }) => ({ default: CaseCards })));
const CaseView = lazy(() => import('./screens/CaseView').then(({ CaseView }) => ({ default: CaseView })));
const PersonView = lazy(() => import('./screens/PersonView').then(({ PersonView }) => ({ default: PersonView })));
const PersonList = lazy(() => import('./screens/PersonView').then(({ PersonList }) => ({ default: PersonList })));
const Drafts = lazy(() => import('./screens/Drafts').then(({ Drafts }) => ({ default: Drafts })));
const ScReturn = lazy(() => import('./screens/ScReturn').then(({ ScReturn }) => ({ default: ScReturn })));
const Verifier = lazy(() => import('./screens/Verifier').then(({ Verifier }) => ({ default: Verifier })));
const Stats = lazy(() => import('./screens/Stats').then(({ Stats }) => ({ default: Stats })));
const Safeguards = lazy(() => import('./screens/Safeguards').then(({ Safeguards }) => ({ default: Safeguards })));
const Dashboard = lazy(() => import('./screens/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })));
const DeadlineCalendar = lazy(() => import('./screens/DeadlineCalendar').then(({ DeadlineCalendar }) => ({ default: DeadlineCalendar })));
const ProfileScreen = lazy(() => import('./screens/Profile').then(({ ProfileScreen }) => ({ default: ProfileScreen })));
const EvidenceInbox = lazy(() => import('./screens/EvidenceInbox').then(({ EvidenceInbox }) => ({ default: EvidenceInbox })));
const SubmitProof = lazy(() => import('./screens/SubmitProof').then(({ SubmitProof }) => ({ default: SubmitProof })));
const Triage = lazy(() => import('./screens/Triage').then(({ Triage }) => ({ default: Triage })));
const Adjournment = lazy(() => import('./screens/Adjournment').then(({ Adjournment }) => ({ default: Adjournment })));
const HearingRecorder = lazy(() => import('./screens/HearingRecorder').then(({ HearingRecorder }) => ({ default: HearingRecorder })));
const HearingTranscript = lazy(() => import('./screens/HearingTranscript').then(({ HearingTranscript }) => ({ default: HearingTranscript })));
const CaseAnalyzer = lazy(() => import('./screens/CaseAnalyzer').then(({ CaseAnalyzer }) => ({ default: CaseAnalyzer })));
const SettlementAnalyzer = lazy(() => import('./screens/SettlementAnalyzer').then(({ SettlementAnalyzer }) => ({ default: SettlementAnalyzer })));
const SettlementDraft = lazy(() => import('./screens/SettlementAnalyzer').then(({ SettlementDraft }) => ({ default: SettlementDraft })));
const Research = lazy(() => import('./screens/Research').then(({ Research }) => ({ default: Research })));
const RightsAdvisor = lazy(() => import('./screens/RightsAdvisor').then(({ RightsAdvisor }) => ({ default: RightsAdvisor })));
const TrackCase = lazy(() => import('./screens/TrackCase').then(({ TrackCase }) => ({ default: TrackCase })));
const CitizenSettlement = lazy(() => import('./screens/CitizenSettlement').then(({ CitizenSettlement }) => ({ default: CitizenSettlement })));

type NavItem = { to: string; key: string; label: string; icon: IconName };
const NAV: NavItem[] = [
  { to: '/', key: 'dashboard', label: 'Dashboard', icon: 'home' },
  { to: '/calendar', key: 'calendar', label: 'Deadline Calendar', icon: 'calendar' },
  { to: '/triage', key: 'triage', label: 'Smart triage', icon: 'cases' },
  { to: '/triage/adjournment', key: 'nav.adjournments', label: 'Adjournments', icon: 'calendar' },
  { to: '/research', key: 'nav.research', label: 'Research', icon: 'search' },
  { to: '/rights', key: 'nav.rights', label: 'Rights advisor', icon: 'shield' },
  { to: '/track', key: 'nav.track', label: 'Track my case', icon: 'search' },
  { to: '/settlement-guide', key: 'nav.settlementGuide', label: 'Settlement guide', icon: 'drafts' },
  { to: '/file-evidence', key: 'nav.fileEvidence', label: 'File evidence', icon: 'import' },
  { to: '/board', key: 'nav.board', label: 'Action board', icon: 'board' },
  { to: '/import', key: 'nav.import', label: 'Import order', icon: 'import' },
  { to: '/cases', key: 'nav.cases', label: 'Cases', icon: 'cases' },
  { to: '/persons', key: 'nav.persons', label: 'People', icon: 'people' },
  { to: '/drafts', key: 'nav.drafts', label: 'Drafts', icon: 'drafts' },
  { to: '/lawyer/case', key: 'nav.caseAnalyzer', label: 'Case analyzer', icon: 'cases' },
  { to: '/lawyer', key: 'nav.settlement', label: 'Settlement', icon: 'drafts' },
  { to: '/sc-return', key: 'nav.sc', label: 'SC return', icon: 'sheet' },
  { to: '/verify', key: 'nav.verify', label: 'Verifier', icon: 'verify' },
  { to: '/evidence', key: 'nav.evidence', label: 'Evidence inbox', icon: 'verify' },
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
  const role = useRole();
  // Triage and adjournments need the desktop court workspace.
  const usable = NAV.filter(item => !item.to.startsWith('/triage') || window.courtplusJudge);
  // Every feature is listed under the role it serves; the current role's group is highlighted.
  const sections = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.paths.flatMap(to => usable.filter(item => item.to === to))
      .map(item => item.to === '/' && section.group ? { ...item, key: 'dashboard.' + section.group, label: dashboardTitle(section.group) } : item),
  })).filter(section => section.items.length > 0);
  const navLink = (group: RoleGroup | undefined) => ({ to, key, label, icon }: NavItem) => <li key={(group ?? 'common') + to}>
    <NavLink to={to} end={to === '/' || to === '/triage' || to === '/lawyer'} title={t(key, label)} aria-label={t(key, label)}
      onClick={() => { if (group && group !== role) setRoleOverride(group); }}
      className={({ isActive }) => 'nav-item' + (isActive && (!group || group === role) ? ' active' : '')}>
      <Icon name={icon} /><span className="sidebar-label">{t(key, label)}</span>
    </NavLink>
  </li>;

  function dismissPrompt() {
    setDismissed(true);
    try { localStorage.setItem(promptKey, 'yes'); } catch { /* Storage may be disabled. */ }
  }

  return <WorkDataProvider page={pathname}>
    <a href="#main" className="skip-link" onClick={event => {
      event.preventDefault();
      document.getElementById('main')?.focus();
    }}>{ui("Skip to content")}</a>
    <div className={'app-shell' + (collapsed ? ' sidebar-collapsed' : '')}>
      <aside className="app-sidebar" aria-label={ui("Primary navigation")}>
        <div className="brand">
          <span className="brand-mark"><Icon name="brand" size={20} /></span>
          <strong className="sidebar-label">Court+</strong>
        </div>
        <nav aria-label={ui('Main')}>{sections.map(section => {
          const title = t('nav.section.' + (section.group ?? 'common'), section.title);
          return <details key={section.title} className="nav-section" open aria-label={title}>
            <summary className={'nav-heading sidebar-label' + (section.group === role ? ' current' : '')}>{title}</summary>
            <ul className="nav-list">{section.items.map(navLink(section.group))}</ul>
          </details>;
        })}
        </nav>
        <div className="sidebar-bottom">
          {settingsScreen && <NavLink to="/settings" title={ui("Settings")} aria-label={ui("Settings")} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <Icon name="settings" /><span className="sidebar-label">{ui("Settings")}</span>
          </NavLink>}
          <button className="nav-item collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? ui("Expand sidebar") : ui("Collapse sidebar")} aria-expanded={!collapsed}>
            <Icon name={collapsed ? 'expand' : 'collapse'} /><span className="sidebar-label">{ui("Collapse")}</span>
          </button>
        </div>
      </aside>
      <div className="app-content">
        <TopBar />
        <main id="main" tabIndex={-1} className="main-content">
          {profile === null && !dismissed && pathname === '/' && <aside className="profile-prompt" aria-label={ui("Set up your profile")}>
            <Icon name="person" /><p><strong>{ui("Personalise Court+")}</strong><span>{ui("Set your role and preferred language.")}</span></p>
            <Link to="/profile" className="button secondary" onClick={dismissPrompt}>{ui("Set up profile")}</Link>
            <button className="text-button" onClick={dismissPrompt}>{ui("Skip for now")}</button>
          </aside>}
          <Suspense fallback={<p role="status">{ui("Loading…")}</p>}>
            <RouteErrorBoundary key={pathname}>
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
                <Route path="/judge-dashboard" element={<Navigate to="/" replace />} />
                <Route path="/evidence" element={<EvidenceInbox />} />
                <Route path="/submit-proof" element={<SubmitProof initialRole="citizen" />} />
                <Route path="/file-evidence" element={<SubmitProof initialRole="lawyer" />} />
                <Route path="/hearings" element={<HearingRecorder />} />
                <Route path="/hearings/:id" element={<HearingTranscript />} />
                <Route path="/research" element={<Research />} />
                <Route path="/rights" element={<RightsAdvisor />} />
                <Route path="/track" element={<TrackCase />} />
                <Route path="/settlement-guide" element={<CitizenSettlement />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/safeguards" element={<Safeguards />} />
                <Route path="/profile" element={<ProfileScreen />} />
                {settingsScreen && <Route path="/settings" element={settingsScreen} />}
              </Routes>
            </RouteErrorBoundary>
          </Suspense>
        </main>
      </div>
    </div>
  </WorkDataProvider>;
}
