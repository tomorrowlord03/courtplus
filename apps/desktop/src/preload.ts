import type { CourtWorkspaceApi, DesktopWorkspaceApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { contextBridge, ipcRenderer } from 'electron';
import type { LawyerToolsApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };

function invoke<K extends keyof DesktopWorkspaceApi>(
  name: K,
  ...args: Parameters<DesktopWorkspaceApi[K]>
): ReturnType<DesktopWorkspaceApi[K]> {
  return ipcRenderer.invoke(`courtplus:${name}`, ...args) as ReturnType<DesktopWorkspaceApi[K]>;
}

const courtplus: DesktopWorkspaceApi = {
  listPersons: () => invoke('listPersons'),
  listCases: () => invoke('listCases'),
  getProfile: () => invoke('getProfile'),
  saveProfile: profile => invoke('saveProfile', profile),
  clearProfile: () => invoke('clearProfile'),
  dashboardActivity: () => invoke('dashboardActivity'),
  previewDraft: (kind, caseId, lang) => invoke('previewDraft', kind, caseId, lang),
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
if (!process.argv.includes('--courtplus-verifier-window')) {
  contextBridge.exposeInMainWorld('courtplusLawyer', {
    pastAwards: description => ipcRenderer.invoke('desktop:lawyer:pastAwards', description),
    analyzeCase: file => ipcRenderer.invoke('desktop:lawyer:analyzeCase', file),
    exportAnalysis: (id, confirmedBy) => ipcRenderer.invoke('desktop:lawyer:exportAnalysis', id, confirmedBy),
    previewSettlement: proposal => ipcRenderer.invoke('desktop:lawyer:previewSettlement', proposal),
    exportSettlement: proposal => ipcRenderer.invoke('desktop:lawyer:exportSettlement', proposal),
  } satisfies LawyerToolsApi);
}
contextBridge.exposeInMainWorld('courtplusJudge', {
  courtWorkspace: (date, action) => ipcRenderer.invoke('desktop:courtWorkspace', date, action),
} satisfies CourtWorkspaceApi);
if (process.argv.includes('--courtplus-diagnostics')) {
  contextBridge.exposeInMainWorld('courtplusDiagnostics', {
    diag: () => ipcRenderer.invoke('diag'),
  });
}

// Hearing recorder (see HearingApi in contracts). Sandboxed preloads cannot import local files.
const hearingMethods = ['list', 'start', 'chunk', 'stop', 'recover', 'recording', 'signRecording', 'integrity', 'audio',
  'transcribe', 'transcripts', 'saveTranscript', 'signTranscript', 'summary', 'exportPdf', 'modelStatus'];
contextBridge.exposeInMainWorld('courtplusHearing', {
  ...Object.fromEntries(hearingMethods.map(name => [name, (...args: unknown[]) => ipcRenderer.invoke('hearing:' + name, ...args)])),
  onProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on('hearing:progress', listener);
    return () => ipcRenderer.removeListener('hearing:progress', listener);
  },
});

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
  signerStatus: () => ipcRenderer.invoke('desktop:signerStatus'),
  unlockSigner: (passphrase: string) => ipcRenderer.invoke('desktop:unlockSigner', passphrase),
  lockSigner: () => ipcRenderer.invoke('desktop:lockSigner'),
  setSignerPassphrase: (current: string | undefined, next: string) =>
    ipcRenderer.invoke('desktop:setSignerPassphrase', current, next),
  retireSigner: (passphrase?: string) => ipcRenderer.invoke('desktop:retireSigner', passphrase),
  exportHandoff: (lang: 'en' | 'hi') => ipcRenderer.invoke('desktop:exportHandoff', lang),
  checkAnchor: (anchor: string) => ipcRenderer.invoke('desktop:checkAnchor', anchor),
  evidenceList: (query: unknown) => ipcRenderer.invoke('desktop:evidenceList', query),
  evidenceSubmit: (data: unknown) => ipcRenderer.invoke('desktop:evidenceSubmit', data),
  evidenceStatus: (code: string) => ipcRenderer.invoke('desktop:evidenceStatus', code),
  evidenceAction: (id: string, action: string, note?: string) =>
    ipcRenderer.invoke('desktop:evidenceAction', id, action, note),
  evidenceVerify: (id: string) => ipcRenderer.invoke('desktop:evidenceVerify', id),
  evidenceFile: (id: string) => ipcRenderer.invoke('desktop:evidenceFile', id),
  evidenceCertificate: (id: string) => ipcRenderer.invoke('desktop:evidenceCertificate', id),
  onBoardChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('courtplus:boardChanged', listener);
    return () => ipcRenderer.removeListener('courtplus:boardChanged', listener);
  },
});
