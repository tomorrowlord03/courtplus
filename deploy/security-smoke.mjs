import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'courtplus-security-'));
const key = join(directory, 'db_key');
const override = join(directory, 'compose.yml');
const config = fileURLToPath(new URL('./docker-compose.yml', import.meta.url));
const project = 'courtplus-security-' + randomBytes(4).toString('hex');
const env = { ...process.env, COURTPLUS_SITE: 'localhost', COURTPLUS_DB_KEY_FILE: key };

function docker(args, input) {
  const stdio = ['pipe', 'pipe', 'pipe'];
  return execFileSync('docker', args, { encoding: 'utf8', env, input, stdio, timeout: 120_000 });
}

function compose(...args) {
  return docker(['compose', '-p', project, '-f', config, '-f', override, ...args]);
}

try {
  writeFileSync(key, randomBytes(32).toString('hex'), { mode: 0o644 });
  writeFileSync(override, 'services:\n  caddy:\n    ports: !reset []\nnetworks:\n  edge:\n    internal: true\n');
  const guide = readFileSync(new URL('./aws/README.md', import.meta.url), 'utf8');
  assert.match(guide, /Session Manager/);
  assert.doesNotMatch(guide, /\|\s*TCP 22\s*\|/);

  compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '40');
  for (const [service, memoryMiB, cpus, tmpMiB] of [['cloud', 640, 1, 256], ['caddy', 64, 0.25, 16]]) {
    const id = compose('ps', '-q', service).trim();
    const [container] = JSON.parse(docker(['inspect', id]));
    const host = container.HostConfig;
    assert.equal(host.Memory, memoryMiB * 1024 * 1024);
    assert.equal(host.NanoCpus, cpus * 1e9);
    assert.equal(host.ReadonlyRootfs, true);
    assert.match(host.Tmpfs['/tmp'], new RegExp('size=' + tmpMiB + 'm(?:,|$)'));
    compose('exec', '-T', service, 'sh', '-ec', 'touch /tmp/security-smoke && rm /tmp/security-smoke');
  }

  const chain = '/data/caddy/pki/authorities/local/root.crt';
  let localCa = '';
  for (let attempt = 0; !localCa && attempt < 20; attempt += 1) {
    localCa = compose('exec', '-T', 'caddy', 'sh', '-c', 'if test -r "$1"; then cat "$1"; fi', 'sh', chain).trim();
    if (!localCa) await setTimeout(250);
  }
  assert.match(localCa, /BEGIN CERTIFICATE/);

  const result = docker(['compose', '-p', project, '-f', config, '-f', override, 'exec', '-T',
    'cloud', 'node', '--input-type=module', '-'], `
      import assert from 'node:assert/strict';
      import { get } from 'node:https';
      import { printDraft } from './apps/appliance/dist/exports.js';
      await new Promise((resolve, reject) => {
        get({
          host: 'caddy', servername: 'localhost', path: '/health', headers: { host: 'localhost' },
          ca: ${JSON.stringify(localCa)}, signal: AbortSignal.timeout(5000),
        }, response => {
          try {
            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.headersDistinct['strict-transport-security'],
              ['max-age=31536000; includeSubDomains; preload']);
            response.resume();
            response.once('end', resolve);
          } catch (error) { reject(error); }
        }).once('error', reject);
      });
      const pdf = await printDraft('<!doctype html><html><head><title>Fictional sandbox smoke</title>'
        + "<script>document.title = 'Fictional script ran'</script></head>"
        + '<body><p>Fictional draft used for a security test.</p></body></html>');
      assert.equal(pdf.toString('ascii', 0, 5), '%PDF-');
      assert.ok(pdf.includes('Fictional sandbox smoke'));
      assert.ok(!pdf.includes('Fictional script ran'));
      console.log('PASS local CA, HSTS, sandboxed PDF and blocked JavaScript');
    `);
  console.log(result.trim());
  console.log('PASS container CPU and memory limits, writable tmpfs mounts and Session Manager guide');
} finally {
  try {
    compose('down', '-v', '--timeout', '5');
  } finally {
    for (const path of [key, override]) {
      try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rmdirSync(directory);
  }
}
