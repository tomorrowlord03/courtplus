import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, session, type Session } from 'electron';
import { microphoneAllowed } from './handlers/recorder';

export const appUrl = 'courtplus://app/';
export const pdfUrl = 'courtplus://diagnostics/devanagari.html';
const printUrl = 'courtplus://print/';
const printDocuments = new Map<string, string>();

protocol.registerSchemesAsPrivileged([
  { scheme: 'courtplus', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

export const webPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
};

export function lockDownWindow(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function isSameOrigin(url: string, target: string): boolean {
  const parsed = URL.parse(url);
  const origin = new URL(target);
  return parsed !== null && parsed.protocol === origin.protocol && parsed.host === origin.host
    && parsed.username === '' && parsed.password === '';
}

export function developmentUrl(): URL | undefined {
  if (app.isPackaged) return undefined;
  const configured = process.env.COURTPLUS_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
  if (!configured) return undefined;
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) {
    throw new Error('COURTPLUS_RENDERER_URL must be a loopback HTTP(S) URL');
  }
  return url;
}

export function diagnosticResources(): string {
  return app.isPackaged ? join(process.resourcesPath, 'diag') : join(app.getAppPath(), 'resources', 'diag');
}

function uiDirectory(): string {
  const dir = app.isPackaged ? join(process.resourcesPath, 'ui') : join(app.getAppPath(), 'resources', 'ui');
  return existsSync(join(dir, 'index.html')) ? dir : join(app.getAppPath(), 'resources', 'shell');
}

function contentPolicy(backend: string, devUrl?: URL): string {
  const scriptSources = devUrl
    ? "'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=' 'sha256-8ZgGo/nOlaDknQkDUYiedLuFRSGJwIz6LAzsOrNxhmU='"
    : "'self'";
  const devSocket = devUrl && (devUrl.protocol === 'https:' ? 'wss://' : 'ws://') + devUrl.host;
  return [
    "default-src 'none'",
    "script-src " + scriptSources,
    devUrl ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src " + ([backend, devSocket].filter(Boolean).join(' ') || "'none'"),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function assetPath(root: string, pathname: string): string | undefined {
  const parts = pathname.slice(1).split('/').map(decodeURIComponent);
  if (parts.some(part => /[\\:\u0000/]/u.test(part) || /[. ]$/u.test(part))) return undefined;
  const file = resolve(root, ...(pathname === '/' ? ['index.html'] : parts));
  const fromRoot = relative(root, file);
  if (fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\') || isAbsolute(fromRoot)) {
    return undefined;
  }
  return file;
}

export async function makeRendererSession(devUrl?: URL, backend = () => ''): Promise<Session> {
  const isolated = session.fromPartition('courtplus');
  await isolated.setProxy({ mode: 'direct' });
  // Only the hearing recorder's microphone, only for the app's own pages; everything else is denied.
  const appOrigins = devUrl ? [appUrl, devUrl.href] : [appUrl];
  isolated.setPermissionCheckHandler((_contents, permission, origin, details) =>
    microphoneAllowed(permission, origin, [details.mediaType ?? ''], appOrigins));
  isolated.setPermissionRequestHandler((_contents, permission, callback, details) => callback(microphoneAllowed(
    permission, details.requestingUrl, 'mediaTypes' in details ? details.mediaTypes ?? [] : [], appOrigins)));
  isolated.setDevicePermissionHandler(() => false);
  isolated.setDisplayMediaRequestHandler((_request, respond) => respond({}));
  isolated.on('will-download', event => event.preventDefault());

  const root = uiDirectory();
  isolated.protocol.handle('courtplus', async request => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.username || url.password) return new Response(null, { status: 403 });
    if (url.host === 'print') {
      const html = printDocuments.get(url.pathname);
      return html === undefined ? new Response(null, { status: 404 }) : new Response(html, { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; frame-ancestors 'none'",
        'Cache-Control': 'no-store',
      } });
    }
    const isDiagnosticFile = url.pathname === '/devanagari.html' || url.pathname === '/devanagari.css';
    const assets = url.host === 'app' ? root
      : url.host === 'diagnostics' && isDiagnosticFile ? diagnosticResources()
      : undefined;
    if (!assets) return new Response(null, { status: 404 });
    try {
      const path = assetPath(assets, url.pathname);
      if (!path) return new Response(null, { status: 404 });
      const asset = await net.fetch(pathToFileURL(path).href);
      const headers = new Headers(asset.headers);
      headers.set('Content-Security-Policy', contentPolicy(url.host === 'app' ? backend() : ''));
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-DNS-Prefetch-Control', 'off');
      return new Response(asset.body, { status: asset.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  const devSocket = devUrl && (devUrl.protocol === 'https:' ? 'wss://' : 'ws://') + devUrl.host;
  isolated.webRequest.onBeforeRequest(({ url }, callback) => {
    const origin = backend();
    const allowed = isSameOrigin(url, appUrl) || isSameOrigin(url, pdfUrl) || isSameOrigin(url, printUrl)
      || url.startsWith('blob:') || url.startsWith('data:')
      || Boolean(origin && isSameOrigin(url, origin))
      || Boolean(devUrl && isSameOrigin(url, devUrl.href))
      || Boolean(devSocket && isSameOrigin(url, devSocket));
    callback({ cancel: !allowed });
  });
  if (devUrl) {
    isolated.webRequest.onHeadersReceived(({ url, responseHeaders }, callback) => {
      if (!isSameOrigin(url, devUrl.href)) return callback({});
      const headers = { ...responseHeaders };
      const key = Object.keys(headers).find(name => name.toLowerCase() === 'content-security-policy')
        ?? 'Content-Security-Policy';
      headers[key] = [...(headers[key] ?? []), contentPolicy(backend(), devUrl)];
      callback({ responseHeaders: headers });
    });
  }
  return isolated;
}

export async function printDocument(isolated: Session, html: string): Promise<Uint8Array> {
  const id = randomUUID();
  printDocuments.set('/' + id, html);
  let window: BrowserWindow | undefined;
  try {
    window = new BrowserWindow({ show: false, webPreferences: { ...webPreferences, session: isolated } });
    lockDownWindow(window);
    await window.loadURL(printUrl + id);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  } finally {
    printDocuments.delete('/' + id);
    window?.destroy();
  }
}
