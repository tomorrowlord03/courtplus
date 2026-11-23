import { access, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(process.env.COURTPLUS_MODEL_SOURCE
  ?? 'D:/Projects/Court plus/repo.wt/w3-ml/ml/ner/artifacts/courtplus-legalner');
const target = fileURLToPath(new URL('../resources/model/', import.meta.url));

try {
  await Promise.all(['config.json', 'tokenizer.json', 'onnx/model.onnx',
    'onnx/model_quantized.onnx'].map(file => access(resolve(source, file))));
} catch {
  throw new Error('Cannot find the trained CourtPlus model at ' + source + '. Set COURTPLUS_MODEL_SOURCE to its ONNX export directory.');
}
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
