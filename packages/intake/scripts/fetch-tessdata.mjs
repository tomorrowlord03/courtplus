import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

const release = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/';
const destination = new URL('../assets/tessdata/', import.meta.url);
const assets = {
  'eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  'hin.traineddata': '4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825',
  LICENSE: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

await mkdir(destination, { recursive: true });
for (const [name, expected] of Object.entries(assets)) {
  const output = new URL(name, destination);
  const existing = await readFile(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing && sha256(existing) === expected) {
    console.log(name + ' verified');
    continue;
  }

  const response = await fetch(release + name);
  if (!response.ok) throw new Error('Download failed for ' + name + ' (HTTP ' + response.status + ')');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error('SHA-256 mismatch for ' + name);
  const temporary = new URL(name + '.' + process.pid + '.tmp', destination);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(name + ' downloaded and verified');
}
