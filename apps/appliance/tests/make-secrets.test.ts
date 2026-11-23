import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeTrustPem, generateKeyPair, generatePqKeyPair } from '@courtplus/export/signing';
import { expect, test } from 'vitest';

test('rotation sets ownership from the signing key before archiving or publishing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'courtplus-make-secrets-'));
  try {
    const seed = Buffer.alloc(32, 3);
    const key = generateKeyPair('Fictional Rotation Office');
    const active = join(dir, 'pq_signing_key');
    const archive = join(dir, 'pq_retired');
    const publicArchive = join(archive, 'public');
    mkdirSync(publicArchive, { recursive: true });
    writeFileSync(join(dir, 'signing_key'), key.privateKey);
    writeFileSync(active, seed.toString('hex'));

    const script = readFileSync(new URL('../../../deploy/make-secrets.sh', import.meta.url), 'utf8');
    const rotation = script.split("<<'NODE'\n")[1].split('\nNODE')[0];
    const mockOwnership = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { relative } from 'node:path';
      const operations = [];
      const { linkSync: link, statSync: stat } = fs;
      fs.statSync = path => relative(process.argv[2], path) === 'signing_key'
        ? { uid: 1234, gid: 5678 } : stat(path);
      fs.chownSync = (path, uid, gid) => operations.push([relative(process.argv[2], path), uid, gid]);
      fs.linkSync = (source, target) => {
        operations.push(['link']);
        link(source, target);
      };
      syncBuiltinESMExports();
      process.on('exit', () => console.log(JSON.stringify(operations)));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-', dir], {
      cwd: new URL('../../../', import.meta.url), input: mockOwnership + rotation, encoding: 'utf8',
    });

    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toEqual([
      [expect.stringMatching(/^\.rotate-pq-.+[/\\]seed$/), 1234, 5678],
      [expect.stringMatching(/^\.rotate-pq-.+[/\\]binding\.pem$/), 1234, 5678],
      ['pq_retired', 1234, 5678],
      [join('pq_retired', 'seeds'), 1234, 5678],
      [join('pq_retired', 'public'), 1234, 5678],
      ['link'],
      ['link'],
    ]);
    const { pqKeyId } = generatePqKeyPair(seed);
    expect(readFileSync(join(archive, 'seeds', pqKeyId + '.seed'), 'utf8')).toBe(seed.toString('hex'));
    expect(decodeTrustPem(readFileSync(join(publicArchive, pqKeyId + '.pem'), 'utf8')))
      .toMatchObject({ keyId: key.keyId, pqKeyId });
    const currentSeed = readFileSync(active, 'utf8').trim();
    expect(currentSeed).toMatch(/^[a-f0-9]{64}$/);
    expect(currentSeed).not.toBe(seed.toString('hex'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
