// Checks the fuses on a packaged CourtPlus.exe and that the app still starts with them.
// Usage: node --test tests/fuses.packaged.mjs  (COURTPLUS_EXE=path\to\win-unpacked\CourtPlus.exe)
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fuses from '@electron/fuses';

const { FuseV1Options, getCurrentFuseWire } = fuses;
// FuseState is a type-only const enum in @electron/fuses: the wire stores ASCII '0' / '1'.
const FuseState = { DISABLE: 48, ENABLE: 49 };

const executable = process.env.COURTPLUS_EXE
  ?? resolve(import.meta.dirname, '../release/win-unpacked/CourtPlus.exe');

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

async function reachable(url, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return await response.json();
    } catch {}
    await delay(200);
  }
  return undefined;
}

async function run(args, env, collect) {
  const profile = mkdtempSync(join(tmpdir(), 'courtplus-fuse-profile-'));
  const child = spawn(executable, [...args, '--courtplus-profile=' + profile], {
    env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    return await collect(() => output);
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([once(child, 'exit'), delay(5000)]);
    await delay(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

test('Node entry-point fuses are burnt into the packaged exe', async () => {
  const wire = await getCurrentFuseWire(executable);
  assert.equal(wire[FuseV1Options.RunAsNode], FuseState.DISABLE);
  assert.equal(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable], FuseState.DISABLE);
  assert.equal(wire[FuseV1Options.EnableNodeCliInspectArguments], FuseState.DISABLE);
  assert.equal(wire[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
});

test('the packaged app starts, ignores --inspect and ELECTRON_RUN_AS_NODE', async () => {
  const [inspect, browser] = await Promise.all([freePort(), freePort()]);
  const marker = 'courtplus-ran-as-node-' + inspect;
  await run([
    '-e', 'console.log("' + marker + '")', '--inspect=127.0.0.1:' + inspect,
    '--remote-debugging-port=' + browser, '--remote-debugging-address=127.0.0.1',
  ], { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect=127.0.0.1:' + inspect }, async output => {
    // The app window proves it still loads from the asar with the fuses set.
    let page;
    for (let i = 0; i < 300 && !page; i += 1) {
      const targets = await reachable('http://127.0.0.1:' + browser + '/json/list', 1);
      page = targets?.find(target => target.url.startsWith('courtplus://app/'));
      if (!page) await delay(200);
    }
    assert.ok(page, 'CourtPlus window did not open. Output: ' + output());
    assert.equal(await reachable('http://127.0.0.1:' + inspect + '/json/list', 3), undefined, 'main-process inspector is open');
    assert.ok(!output().includes(marker), 'exe ran as plain Node');
  });
});
