import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// The packaged exe itself is checked by tests/fuses.packaged.mjs after `npm run dist`.
it('turns off Node entry points in the packaged build', () => {
  const config = readFileSync(resolve(import.meta.dirname, '../electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');
  const block = /^electronFuses:\n((?: {2}.+\n)+)/m.exec(config)?.[1] ?? '';
  expect(block).toMatch(/^ {2}runAsNode: false$/m);
  expect(block).toMatch(/^ {2}enableNodeOptionsEnvironmentVariable: false$/m);
  expect(block).toMatch(/^ {2}enableNodeCliInspectArguments: false$/m);
  expect(block).toMatch(/^ {2}onlyLoadAppFromAsar: true$/m);
});
