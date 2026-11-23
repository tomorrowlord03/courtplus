import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from '../../ui/src/App';
import { AppProvider } from '../../ui/src/lib/context';
import { loadFonts, ui } from '../../ui/src/lib/i18n';
import { DisplayControls } from '../../ui/src/components/DisplayControls';
import { RouteErrorBoundary } from '../../ui/src/components/RouteErrorBoundary';
import '../../ui/src/index.css';
import { api, shell } from './bridge';

const ImportCase = lazy(() => import('./import-case').then(({ ImportCase }) => ({ default: ImportCase })));
const Settings = lazy(() => import('./settings').then(({ Settings }) => ({ default: Settings })));
const TrustSigner = lazy(() => import('./settings').then(({ TrustSigner }) => ({ default: TrustSigner })));
const Verifier = lazy(() => import('../../ui/src/screens/Verifier').then(({ Verifier }) => ({ default: Verifier })));

function Desktop() {
  const [boardApi, setBoardApi] = useState(api);
  useEffect(() => {
    if (!shell.verifier) return shell.onBoardChanged(() => setBoardApi({ ...api }));
  }, []);

  if (shell.verifier) {
    return <AppProvider api={api}><div className="app-shell"><main className="mx-auto max-w-3xl p-6">
      <DisplayControls />
      <Suspense fallback={<p role="status">{ui("Loading…")}</p>}>
        <RouteErrorBoundary>
          <Verifier /><TrustSigner />
        </RouteErrorBoundary>
      </Suspense>
    </main></div></AppProvider>;
  }
  return (
    <AppProvider api={boardApi}>
      <App importScreen={<ImportCase />} settingsScreen={<Settings />} />
    </AppProvider>
  );
}

loadFonts();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteErrorBoundary>
      <HashRouter><Desktop /></HashRouter>
    </RouteErrorBoundary>
  </StrictMode>,
);
