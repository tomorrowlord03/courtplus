import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from '../../ui/src/App';
import { AppProvider } from '../../ui/src/lib/context';
import { loadFonts } from '../../ui/src/lib/i18n';
import { Verifier } from '../../ui/src/screens/Verifier';
import '../../ui/src/index.css';
import { api, shell } from './bridge';
import { ImportCase } from './import-case';
import { Settings, TrustSigner } from './settings';

function Desktop() {
  const [boardApi, setBoardApi] = useState(api);
  useEffect(() => {
    if (!shell.verifier) return shell.onBoardChanged(() => setBoardApi({ ...api }));
  }, []);

  if (shell.verifier) {
    return <AppProvider api={api}><div className="app-shell"><main className="mx-auto max-w-3xl p-6"><Verifier /><TrustSigner /></main></div></AppProvider>;
  }
  return (
    <AppProvider api={boardApi}>
      <App importScreen={<ImportCase />} settingsScreen={<Settings />} />
    </AppProvider>
  );
}

loadFonts();
createRoot(document.getElementById('root')!).render(<StrictMode><HashRouter><Desktop /></HashRouter></StrictMode>);
