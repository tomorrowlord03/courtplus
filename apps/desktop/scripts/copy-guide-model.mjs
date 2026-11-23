import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';
const expectedSha256 = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e';
const source = resolve(process.env.COURTPLUS_GUIDE_MODEL ?? `E:/AI-cache/models/guide/${filename}`);
const directory = new URL('../resources/models/guide/', import.meta.url);
const target = fileURLToPath(new URL(filename, directory));
const hash = createHash('sha256');

try {
  if (!(await stat(source)).isFile()) throw new Error('Expected a GGUF file.');
  for await (const chunk of createReadStream(source)) hash.update(chunk);
} catch (cause) {
  throw new Error(`Cannot read the CourtPlus guide model at ${source}. Set COURTPLUS_GUIDE_MODEL to the GGUF file.`, { cause });
}

if (hash.digest('hex') !== expectedSha256) {
  throw new Error(`SHA-256 mismatch for the CourtPlus guide model at ${source}. Set COURTPLUS_GUIDE_MODEL to the correct GGUF file.`);
}

await mkdir(directory, { recursive: true });
if (source !== target) await copyFile(source, target);
