import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AppProvider } from './lib/context';
import { getApi } from './lib/api';
import { loadFonts } from './lib/i18n';
import './index.css';

loadFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider api={getApi()}>
      {/* HashRouter works under file:// in Electron and behind any appliance path */}
      <HashRouter>
        <App />
      </HashRouter>
    </AppProvider>
  </StrictMode>,
);
