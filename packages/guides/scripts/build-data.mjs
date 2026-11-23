import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const guidesDir = path.join(rootDir, 'data', 'guides');

const files = fs.readdirSync(guidesDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const guides = files.map((f) => {
  const content = fs.readFileSync(path.join(guidesDir, f), 'utf8');
  return JSON.parse(content);
});

const outPath = path.resolve(__dirname, '../src/builtin-guides.ts');
const fileContent = `// Auto-generated from data/guides/*.json. Do not edit directly.
import type { Guide } from './types.js';

export const BUILTIN_GUIDES: Guide[] = ${JSON.stringify(guides, null, 2)};
`;

fs.writeFileSync(outPath, fileContent, 'utf8');
console.log(`Successfully generated ${outPath} with ${guides.length} guides.`);
