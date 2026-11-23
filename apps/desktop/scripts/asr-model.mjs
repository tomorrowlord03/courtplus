// Dev-time only. Downloads a multilingual Whisper ONNX export into the model cache on E:
// and copies the chosen one into resources/asr so electron-builder bundles it.
//   node scripts/asr-model.mjs fetch whisper-base [q8|fp32]
//   node scripts/asr-model.mjs copy whisper-base [q8|fp32]
// COURTPLUS_ASR_CACHE overrides the cache folder (default E:\AI-cache\courtplus-ml\asr).
import { access, copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, name = 'whisper-base', dtype = 'q8'] = process.argv.slice(2);
const cache = resolve(process.env.COURTPLUS_ASR_CACHE ?? 'E:/AI-cache/courtplus-ml/asr');
const suffix = { q8: '_quantized', fp32: '' }[dtype];
if (!/^whisper-(tiny|base|small)$/.test(name) || suffix === undefined || !['fetch', 'copy'].includes(command)) {
  console.error('Usage: node scripts/asr-model.mjs fetch|copy whisper-tiny|whisper-base|whisper-small [q8|fp32]');
  process.exit(2);
}
const files = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  `onnx/encoder_model${suffix}.onnx`, `onnx/decoder_model_merged${suffix}.onnx`];
const source = join(cache, name);

if (command === 'fetch') {
  for (const file of files) {
    const target = join(source, file);
    if (await access(target).then(() => true, () => false)) continue;
    await mkdir(dirname(target), { recursive: true });
    const response = await fetch(`https://huggingface.co/onnx-community/${name}/resolve/main/${file}`);
    if (!response.ok) throw new Error(file + ': HTTP ' + response.status);
    await writeFile(target, new Uint8Array(await response.arrayBuffer()));
    console.log('fetched', file);
  }
} else {
  const target = fileURLToPath(new URL('../resources/asr/', import.meta.url));
  await rm(target, { recursive: true, force: true });
  let bytes = 0;
  for (const file of files) {
    await mkdir(dirname(join(target, 'whisper', file)), { recursive: true });
    await copyFile(join(source, file), join(target, 'whisper', file));
    bytes += (await stat(join(source, file))).size;
  }
  await writeFile(join(target, 'model.json'), JSON.stringify({ name, dtype, source: 'onnx-community/' + name, bytes }, null, 2));
  console.log(`copied ${name} (${dtype}) into resources/asr: ${(bytes / 1e6).toFixed(1)} MB`);
}
