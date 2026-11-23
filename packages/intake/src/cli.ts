import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { importOrder } from './index.js';

const [file, flag, modelDir, ...rest] = process.argv.slice(2);
if (!file || flag !== '--model' || !modelDir || rest.length) {
  console.error('Usage: node dist/cli.js <file> --model <dir>');
  process.exitCode = 2;
} else {
  try {
    const result = await importOrder({ name: basename(file), bytes: await readFile(file) }, modelDir);
    const suggestions = result.suggestions.map(({ field, value, sentence, page, confidence }) =>
      ({ field, value, sentence, page, confidence }));
    process.stdout.write(JSON.stringify({ entities: result.entities, pages: result.pages, ocr: result.ocr, suggestions, redactedText: result.redactedText }, null, 2) + '\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
