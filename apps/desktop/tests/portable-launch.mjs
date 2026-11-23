import { spawn } from 'node:child_process';
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

async function waitForEndpoint(url) {
  for (let attempts = 0; attempts < 300; attempts += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return await response.json();
    } catch {}
    await delay(150);
  }
  throw new Error('Portable Electron debugging endpoint timed out.');
}

// The NSIS launcher forwards switches but keeps the Electron child's stderr off Playwright's pipe.
export async function launchPortable(executable, profile) {
  const [mainPort, browserPort] = await Promise.all([allocatePort(), allocatePort()]);
  const browserOrigin = 'http://127.0.0.1:' + browserPort;
  const mainOrigin = 'http://127.0.0.1:' + mainPort;
  const child = spawn(executable, [
    '--inspect=127.0.0.1:' + mainPort,
    '--remote-debugging-port=' + browserPort,
    '--remote-debugging-address=127.0.0.1',
    '--courtplus-profile=' + profile,
  ], { windowsHide: true, stdio: 'ignore' });
  let socket;
  let browser;
  let messageId = 0;

  const mainModule = 'process.getBuiltinModule("module").createRequire(process.resourcesPath + "/app.asar/package.json")("electron")';
  function evaluate(fn, arg) {
    const id = ++messageId;
    const expression = '(' + fn.toString() + ')(' + mainModule + ', ' + JSON.stringify(arg) + ')';
    return new Promise((resolve, reject) => {
      function receive(event) {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener('message', receive);
        if (message.error || message.result.exceptionDetails) {
          reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
        } else resolve(message.result.result.value);
      }
      const timer = setTimeout(() => {
        socket.removeEventListener('message', receive);
        reject(new Error('Portable Electron main process did not respond.'));
      }, 5000);
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  }

  async function close() {
    if (socket?.readyState === WebSocket.OPEN) {
      await evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => undefined);
      socket.close();
    }
    await browser?.close().catch(() => undefined);
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(5000)]);
    if (child.exitCode === null) child.kill();
  }

  try {
    const [targets] = await Promise.all([
      waitForEndpoint(mainOrigin + '/json/list'), waitForEndpoint(browserOrigin + '/json/version'),
    ]);
    socket = new WebSocket(targets[0].webSocketDebuggerUrl);
    await Promise.race([
      once(socket, 'open'),
      delay(5000).then(() => { throw new Error('Portable Electron main debugger did not connect.'); }),
    ]);
    browser = await chromium.connectOverCDP(browserOrigin);
    const context = browser.contexts()[0];
    return {
      evaluate, close,
      firstWindow: () => context.pages().find(page => page.url().startsWith('courtplus://app/'))
        ?? context.waitForEvent('page'),
      waitForEvent: event => context.waitForEvent(event === 'window' ? 'page' : event),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
