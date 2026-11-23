import { cp, mkdir } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const resources = new URL('../resources/', import.meta.url);
const files = ['data/stats', 'data/i18n', 'assets/fonts', 'templates'];
for (const name of files) {
  const target = new URL(name, resources);
  await mkdir(new URL('.', target), { recursive: true });
  await cp(new URL(name, root), target, { recursive: true });
}
for (const name of ['data/i18n', 'assets/fonts']) {
  const target = new URL('ui/' + name, resources);
  await mkdir(new URL('.', target), { recursive: true });
  await cp(new URL(name, root), target, { recursive: true });
}
