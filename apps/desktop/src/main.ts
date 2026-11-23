import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { diagnosticsPassed, runDiagnostics, type DiagnosticsReport } from './diagnostics';
import { createAsrClient } from './asr/client';
import { createHandlers } from './handlers';
import { createRecorder, registerRecorder } from './handlers/recorder';
import { createResearchHints, registerResearch } from './handlers/research-adapter';
import { readSettings, saveSettings } from './handlers/settings';
import { courtArguments } from './handlers/triage';
import { registerHandlers } from './ipc';
import { appUrl, developmentUrl, isSameOrigin, lockDownWindow, makeRendererSession, printDocument, webPreferences } from './renderer';
import { openStore, type Store } from './store';
import { argumentSchemas, validateArguments } from './validation';

const diagnosticsFlag = '--courtplus-diagnostics';
const diagnosticsMode = process.argv.includes(diagnosticsFlag);
const verifierMode = process.argv.includes('--verifier');
const profiles = ['--courtplus-profile=', '--courtplus-diagnostics-profile='];
const profile = process.argv.find(arg => profiles.some(prefix => arg.startsWith(prefix)))?.split(/=(.*)/s)[1];

app.setName('CourtPlus');
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
if (profile) {
  const directory = resolve(profile);
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

let store: Store | undefined;
let mainWindow: BrowserWindow | undefined;
let verifierWindow: BrowserWindow | undefined;
let showVerifier: (() => void) | undefined;
let stopCloud: (() => unknown) | undefined;
let stopAsr: (() => unknown) | undefined;

function chooseFolder(): Promise<string | undefined> {
  return dialog.showOpenDialog(mainWindow!, {
    title: 'Choose a folder for the signed draft bundle', properties: ['openDirectory', 'createDirectory'],
  }).then(result => result.canceled ? undefined : result.filePaths[0]);
}

function savePath(filename: string): Promise<string | undefined> {
  return dialog.showSaveDialog(mainWindow!, { title: 'Save ' + filename, defaultPath: filename })
    .then(result => result.canceled ? undefined : result.filePath);
}

async function start(): Promise<void> {
  const devUrl = diagnosticsMode ? undefined : developmentUrl();
  const rendererUrl = devUrl?.href ?? appUrl;
  const directory = app.getPath('userData');
  const resourceDirectory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  mkdirSync(directory, { recursive: true });
  const database = await openStore(directory, safeStorage);
  store = database;
  const backend = () => readSettings(database).backendUrl;
  const rendererSession = await makeRendererSession(devUrl, backend);
  const notify = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('courtplus:boardChanged');
  };
  const { handlers, cloud, signer, anchor, evidence, boardQueue, courtWorkspace } = await createHandlers(database, {
    resourceDirectory, boardChanged: notify, folder: chooseFolder, savePath,
    print: html => printDocument(rendererSession, html),
  });
  stopCloud = cloud.disconnect;

  const isTrusted = (event: IpcMainInvokeEvent, method: string): boolean => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !isSameOrigin(frame.url, rendererUrl)) return false;
    if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) return true;
    return ['verify', 'trustSigner'].includes(method) && verifierWindow && !verifierWindow.isDestroyed()
      ? event.sender === verifierWindow.webContents : false;
  };
  registerHandlers(handlers, isTrusted);
  const asr = createAsrClient(join(resourceDirectory, 'asr'));
  stopAsr = asr.stop;
  const { encodeReceiptQr } = await import('@courtplus/export');
  registerRecorder(ipcMain, isTrusted, createRecorder(database, signer, {
    directory: join(directory, 'hearings'), findCase: id => database.listCases().find(item => item.id === id),
    transcribe: asr.transcribe, modelStatus: asr.status, folder: chooseFolder, encodeQr: encodeReceiptQr,
    print: html => printDocument(rendererSession, html),
    progress: event => mainWindow?.webContents.send('hearing:progress', event),
  }));
  registerResearch(ipcMain, isTrusted, createResearchHints({ resourceDirectory, audit: database.audit }));

  function desktop<Args extends unknown[]>(name: string, schema: z.ZodType<Args>, run: (...args: NoInfer<Args>) => unknown) {
    ipcMain.handle('desktop:' + name, (event, ...args: unknown[]) => {
      if (!isTrusted(event, name)) throw new Error('FORBIDDEN');
      return run(...validateArguments(schema, args));
    });
  }

  const noArgs = z.tuple([]);
  desktop('courtWorkspace', courtArguments, courtWorkspace);
  desktop('boardQueue', argumentSchemas.board, boardQueue);
  desktop('settings', noArgs, () => ({ ...readSettings(database), cloud: cloud.status() }));
  desktop('saveSettings', z.tuple([z.unknown()]), input => {
    const before = backend();
    const settings = saveSettings(database, input);
    if (before !== settings.backendUrl) {
      void cloud.signOut();
      // A fresh response replaces the active document's CSP after an origin change.
      setTimeout(() => mainWindow?.webContents.reload(), 150);
    }
    notify();
    return settings;
  });
  desktop('login', z.tuple([z.string().trim().min(1).max(64), z.string().min(1).max(256)]), cloud.login);
  desktop('signOut', noArgs, cloud.signOut);
  desktop('sync', noArgs, cloud.schedule);
  desktop('exportSigner', noArgs, async () => {
    const { issuer } = readSettings(database);
    const path = await savePath('courtplus-issuer.pem');
    if (!path) return '';
    const key = signer.publicKey(issuer);
    await writeFile(path, key.publicKey);
    database.audit('signer.export', { keyId: key.keyId });
    return basename(path);
  });
  const passphrase = z.string().min(1).max(256);
  desktop('signerStatus', noArgs, signer.status);
  desktop('unlockSigner', z.tuple([passphrase]), signer.unlock);
  desktop('lockSigner', noArgs, signer.lock);
  desktop('setSignerPassphrase', z.tuple([passphrase.optional(), passphrase]), signer.setPassphrase);
  desktop('retireSigner', z.tuple([passphrase.optional()]), signer.retire);
  desktop('exportHandoff', z.tuple([z.enum(['en', 'hi'])]), anchor.exportHandoff);
  desktop('checkAnchor', z.tuple([z.string().regex(/^[0-9a-f]{64}$/)]), anchor.checkAnchor);
  desktop('evidenceList', z.tuple([z.unknown()]), (query: unknown) => evidence.listEvidence((query || {}) as any));
  desktop('evidenceSubmit', z.tuple([z.unknown()]), (input: unknown) => evidence.submitEvidence(input as any));
  desktop('evidenceStatus', z.tuple([z.string()]), (code: string) => evidence.checkEvidenceStatus(code));
  desktop('evidenceAction', z.tuple([z.string(), z.string(), z.string().optional()]), (id: string, action: string, note?: string) => evidence.updateEvidenceAction(id, action as any, note));
  desktop('evidenceVerify', z.tuple([z.string()]), (id: string) => evidence.verifyEvidence(id));
  desktop('evidenceFile', z.tuple([z.string()]), (id: string) => evidence.getEvidenceFile(id));
  desktop('evidenceCertificate', z.tuple([z.string()]), (id: string) => evidence.exportEvidenceCertificate(id));
  desktop('trustSigner', noArgs, async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? verifierWindow;
    const options = { title: 'Trust a verified office’s public key', properties: ['openFile' as const],
      filters: [{ name: 'Ed25519 public key', extensions: ['pem'] }] };
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    if (result.canceled || !result.filePaths[0]) return '';
    const path = result.filePaths[0];
    return signer.trust(await readFile(path, 'utf8'), basename(path, '.pem'));
  });

  const newWindow = (verifier = false) => {
    const window = new BrowserWindow({
      width: verifier ? 860 : 1280,
      height: verifier ? 740 : 820,
      show: !diagnosticsMode,
      title: verifier ? 'Court+ Verifier' : 'Court+',
      webPreferences: {
        ...webPreferences, session: rendererSession, preload: join(__dirname, 'preload.js'),
        additionalArguments: diagnosticsMode ? [diagnosticsFlag] : verifier ? ['--courtplus-verifier-window'] : [],
      },
    });
    lockDownWindow(window);
    return window;
  };

  showVerifier = () => {
    if (verifierWindow && !verifierWindow.isDestroyed()) {
      verifierWindow.focus();
      return;
    }
    const window = newWindow(true);
    verifierWindow = window;
    void window.loadURL(rendererUrl + '#/verify').catch(() => window.destroy());
  };
  const go = (hash: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    void mainWindow.loadURL(rendererUrl + hash).catch(() => undefined);
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'CourtPlus', submenu: [
      ...(!verifierMode ? [
        { label: 'Action board', click: () => go('#/') },
        { label: 'Import order', click: () => go('#/import') },
        { label: 'Settings', click: () => go('#/settings') },
      ] : []),
      { label: 'Open verifier', click: () => showVerifier?.() },
      { role: 'quit' },
    ] },
    { role: 'editMenu' },
  ]));

  const report = app.isPackaged || diagnosticsMode ? runDiagnostics(directory, rendererSession) : undefined;
  if (diagnosticsMode && report) {
    ipcMain.handle('diag', (event, ...args: unknown[]) => {
      if (!isTrusted(event, 'diag')) throw new Error('FORBIDDEN');
      validateArguments(argumentSchemas.role, args);
      return report;
    });
  }
  if (verifierMode && !diagnosticsMode) {
    showVerifier();
  } else {
    mainWindow = newWindow();
    await mainWindow.loadURL(rendererUrl);
    if (diagnosticsMode) {
      const results = await mainWindow.webContents.executeJavaScript('window.courtplusDiagnostics.diag()') as DiagnosticsReport;
      store.close();
      store = undefined;
      app.exit(diagnosticsPassed(results) ? 0 : 1);
    }
  }
  await report;
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  stopCloud?.();
  stopAsr?.();
  store?.close();
});
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--verifier')) showVerifier?.();
    else mainWindow?.focus();
  });
  void app.whenReady().then(start).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (!diagnosticsMode) dialog.showErrorBox('CourtPlus could not start', message);
    app.exit(1);
  });
} else {
  app.exit(diagnosticsMode ? 1 : 0);
}
