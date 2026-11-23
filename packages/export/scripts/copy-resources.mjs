import { cpSync, existsSync, mkdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const resources = new URL('../dist/resources/', import.meta.url);
for (const name of ['templates', 'data/statutes/quotes.json', 'data/i18n', 'assets/fonts']) {
  const source = new URL(name, root);
  if ((name === 'data/i18n' || name === 'assets/fonts') && !existsSync(source)) continue;
  const target = new URL(name, resources);
  mkdirSync(new URL('.', target), { recursive: true });
  cpSync(source, target, { recursive: true });
}
