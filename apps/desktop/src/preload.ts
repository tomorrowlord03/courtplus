import type { CourtPlusApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { contextBridge, ipcRenderer } from 'electron';

function invoke<K extends keyof CourtPlusApi>(
  name: K,
  ...args: Parameters<CourtPlusApi[K]>
): ReturnType<CourtPlusApi[K]> {
  return ipcRenderer.invoke(`courtplus:${name}`, ...args) as ReturnType<CourtPlusApi[K]>;
}

const courtplus: CourtPlusApi = {
  listPersons: () => invoke('listPersons'),
  listCases: () => invoke('listCases'),
  importOrder: file => invoke('importOrder', file),
  saveCase: (person, record) => invoke('saveCase', person, record),
  screen: (caseId, asOf) => invoke('screen', caseId, asOf),
  board: asOf => invoke('board', asOf),
  updateCard: (id, patch) => invoke('updateCard', id, patch),
  exportDraft: (kind, caseId, lang) => invoke('exportDraft', kind, caseId, lang),
  exportScReturn: (asOf, format) => invoke('exportScReturn', asOf, format),
  verify: bundle => invoke('verify', bundle),
  stats: () => invoke('stats'),
  role: () => invoke('role'),
};

contextBridge.exposeInMainWorld('courtplus', courtplus);
if (process.argv.includes('--courtplus-diagnostics')) {
  contextBridge.exposeInMainWorld('courtplusDiagnostics', {
    diag: () => ipcRenderer.invoke('diag'),
  });
}

contextBridge.exposeInMainWorld('courtplusDesktop', {
  verifier: process.argv.includes('--courtplus-verifier-window'),
  boardQueue: (asOf: string) => ipcRenderer.invoke('desktop:boardQueue', asOf),
  settings: () => ipcRenderer.invoke('desktop:settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('desktop:saveSettings', settings),
  login: (username: string, password: string) => ipcRenderer.invoke('desktop:login', username, password),
  signOut: () => ipcRenderer.invoke('desktop:signOut'),
  sync: () => ipcRenderer.invoke('desktop:sync'),
  exportSigner: () => ipcRenderer.invoke('desktop:exportSigner'),
  trustSigner: () => ipcRenderer.invoke('desktop:trustSigner'),
  exportHandoff: (lang: 'en' | 'hi') => ipcRenderer.invoke('desktop:exportHandoff', lang),
  checkAnchor: (anchor: string) => ipcRenderer.invoke('desktop:checkAnchor', anchor),
  onBoardChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('courtplus:boardChanged', listener);
    return () => ipcRenderer.removeListener('courtplus:boardChanged', listener);
  },
});
