import { mkdir, writeFile } from 'node:fs/promises';
import { checkHtml, printDraft } from '../dist/index.js';
import { drafts } from './fixtures.ts';

const out = new URL('../out/', import.meta.url);
await mkdir(out, { recursive: true });
const options = { localizationRoot: process.env.COURTPLUS_LOCALIZATION_ROOT };
const files = [];

for (const [kind, data] of Object.entries(drafts)) {
  for (const lang of kind === 'RIGHTS_CARD' ? ['en', 'hi', 'ur'] : ['en', 'hi']) {
    const html = await printDraft(kind, data, lang, checkHtml, options);
    const name = kind.toLowerCase().replaceAll('_', '-') + '.' + lang + '.html';
    await writeFile(new URL(name, out), html);
    files.push(name);
  }
}
console.log('Generated ' + files.length + ' fictional HTML samples in packages/export/out/.');
