import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, useLocation } from 'react-router-dom';
import { App } from '../../ui/src/App';
import { AppProvider } from '../../ui/src/lib/context';
import { loadFonts } from '../../ui/src/lib/i18n';
import { Verifier } from '../../ui/src/screens/Verifier';
import '../../ui/src/index.css';
import { api, shell } from './bridge';
import { ImportCase } from './import-case';
import { Settings, TrustSigner } from './settings';

function Desktop() {
  const { pathname } = useLocation();
  const [boardApi, setBoardApi] = useState(api);
  useEffect(() => {
    if (pathname === '/') return shell.onBoardChanged(() => setBoardApi({ ...api }));
  }, [pathname]);

  if (shell.verifier) {
    return <AppProvider api={api}><main className="mx-auto max-w-3xl p-6"><Verifier /><TrustSigner /></main></AppProvider>;
  }
  const ownPage = pathname === '/settings' || pathname === '/import';
  return (
    <AppProvider api={pathname === '/' ? boardApi : api}>
      <div className="flex justify-end gap-5 border-b bg-white px-4 py-2 text-sm text-blue-800">
        {ownPage && <Link className="underline" to="/">Action board</Link>}
        {pathname !== '/import' && ownPage && <Link className="underline" to="/import">Import order</Link>}
        {pathname !== '/settings' && <Link className="underline" to="/settings">Settings</Link>}
      </div>
      {ownPage
        ? <main className="mx-auto max-w-5xl p-4">{pathname === '/settings' ? <Settings /> : <ImportCase />}</main>
        : <App />}
    </AppProvider>
  );
}

loadFonts();
createRoot(document.getElementById('root')!).render(<StrictMode><HashRouter><Desktop /></HashRouter></StrictMode>);
