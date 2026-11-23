import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

async function allocatePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForEndpoint(url, child, timeout, log) {
  const begun = Date.now();
  let reported = begun;
  while (Date.now() - begun < timeout) {
    if (child.exitCode !== null) throw new Error('CourtPlus exited early with code ' + child.exitCode + '.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return await response.json();
    } catch {}
    if (Date.now() - reported > 15_000) {
      reported = Date.now();
      log('still waiting for CourtPlus to start (' + Math.round((reported - begun) / 1000) + ' s)');
    }
    await delay(250);
  }
  throw new Error('CourtPlus DevTools endpoint did not open within ' + timeout / 1000 + ' s.');
}

// The portable exe unpacks ~650 MB to TEMP before Electron starts: about 2 minutes on a cold run.
export const isPortable = executable => /-portable\.exe$/i.test(executable);
export const startupTimeout = executable => isPortable(executable) ? 300_000 : 60_000;

const isApp = page => page.url().startsWith('courtplus://app/');

// A new page's URL is often still blank when its 'page' event fires, so poll instead.
async function findPage(context, match, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = context.pages().find(match);
    if (page) return page;
    await delay(200);
  }
  throw new Error('No CourtPlus window matched within ' + timeout / 1000 + ' s.');
}

// Drives a packaged CourtPlus.exe (win-unpacked or portable) through Chromium's DevTools endpoint only.
// The exe is built with the EnableNodeCliInspectArguments fuse off, so --inspect (and with it
// Playwright's _electron.launch) can never reach the main process; this helper needs no such hook.
export async function launchPackaged(executable, profile, log = () => {}) {
  const port = await allocatePort();
  const origin = 'http://127.0.0.1:' + port;
  const args = ['--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1', '--courtplus-profile=' + profile];
  // The portable launcher keeps the Electron child's output to itself, so only collect it when present.
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = chunk => { output = (output + chunk).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let browser;

  function killTree() {
    if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  }

  async function close() {
    if (browser) {
      // Browser.close quits Electron cleanly so the encrypted store is closed, not torn. It can
      // stall behind an open native dialog, hence the bound and the kill below.
      await Promise.race([
        browser.newBrowserCDPSession().then(session => session.send('Browser.close')).catch(() => undefined),
        delay(5000),
      ]);
      await Promise.race([browser.close().catch(() => undefined), delay(5000)]);
    }
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(10_000)]);
    killTree();
  }

  try {
    await waitForEndpoint(origin + '/json/version', child, startupTimeout(executable), log);
    log('DevTools endpoint open on port ' + port);
    browser = await chromium.connectOverCDP(origin);
    const context = browser.contexts()[0];
    return {
      output: () => output,
      close,
      firstWindow: () => findPage(context, page => isApp(page) && !page.url().includes('#/verify')),
      // A second launch with --verifier is how a user opens the verifier from a shortcut; the
      // single-instance lock (keyed by the profile) forwards it to the running app.
      openVerifier: () => {
        const second = spawn(executable, ['--verifier', '--courtplus-profile=' + profile], { windowsHide: true, stdio: 'ignore' });
        second.on('error', () => undefined);
        // A portable second launch unpacks again before it can hand over to the running app.
        return findPage(context, page => isApp(page) && page.url().includes('#/verify'), startupTimeout(executable));
      },
    };
  } catch (error) {
    await close();
    throw new Error(error.message + (output ? '\nApp output:\n' + output : ''), { cause: error });
  }
}
