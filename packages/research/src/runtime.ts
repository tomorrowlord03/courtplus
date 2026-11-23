import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import type { InferenceSession } from 'onnxruntime-node';

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export interface ModelManifest<Label> {
  labels: Label[];
  length: number;
  stride: number;
  threshold: number | null;
  source: string;
}

export function tokenWindows(ids: readonly number[], length: number, stride: number): number[][] {
  const width = length - 2;
  if (!Number.isInteger(width) || !Number.isInteger(stride) || width <= stride || stride < 0) {
    throw new Error('Invalid local model window.');
  }
  const result = [ids.slice(0, width)];
  if (stride === 0) return result;
  for (let start = width - stride; start + stride < ids.length; start += width - stride) {
    result.push(ids.slice(start, start + width));
  }
  return result;
}

export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => pending ??= load().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}

class LocalModel {
  constructor(
    private readonly session: InferenceSession,
    private readonly Tensor: (typeof import('onnxruntime-node'))['Tensor'],
    private readonly tokenizer: Tokenizer,
    private readonly manifest: ModelManifest<unknown>,
    private readonly special: { cls: number; sep: number; pad: number },
  ) {}

  async *run(texts: Iterable<string>, output: 'logits' | 'embedding'): AsyncGenerator<Float32Array> {
    const encode = (text: string) => tokenWindows(
      this.tokenizer.encode(text, { add_special_tokens: false }).ids,
      this.manifest.length, this.manifest.stride,
    ).map(row => [this.special.cls, ...row, this.special.sep]);
    const batch: number[][] = [];
    for (const text of texts) {
      for (const row of encode(text)) {
        batch.push(row);
        if (batch.length < 8) continue;
        yield* await this.infer(batch, output);
        batch.length = 0;
      }
    }
    if (batch.length) yield* await this.infer(batch, output);
  }

  private async infer(batch: number[][], output: string): Promise<Float32Array[]> {
    const width = Math.max(...batch.map(row => row.length));
    const ids = new BigInt64Array(batch.length * width).fill(BigInt(this.special.pad));
    const mask = new BigInt64Array(ids.length);
    batch.forEach((row, i) => row.forEach((id, j) => {
      ids[i * width + j] = BigInt(id);
      mask[i * width + j] = 1n;
    }));
    const shape = [batch.length, width];
    const result = (await this.session.run({
      input_ids: new this.Tensor('int64', ids, shape),
      attention_mask: new this.Tensor('int64', mask, shape),
    }))[output];
    const dimensions = result?.dims[1];
    if (!result || !(result.data instanceof Float32Array) || !dimensions ||
      result.dims.length !== 2 || result.dims[0] !== batch.length) {
      throw new Error('Unexpected local model output.');
    }
    const data = result.data;
    return batch.map((_, i) => data.subarray(i * dimensions, (i + 1) * dimensions));
  }
}

export async function loadModel<Label>(dir: string, quantized = false) {
  const int8 = join(dir, 'model_quantized.onnx');
  const useInt8 = quantized && await access(int8).then(() => true, () => false);
  const [manifest, tokenizer, config, ort] = await Promise.all([
    readJson<ModelManifest<Label>>(join(dir, 'manifest.json')),
    readJson<object>(join(dir, 'tokenizer.json')),
    readJson<object>(join(dir, 'tokenizer_config.json')),
    import('onnxruntime-node'),
  ]);
  const encoder = new Tokenizer(tokenizer, config);
  const id = (token: string) => {
    const value = encoder.token_to_id(token);
    if (value === undefined) throw new Error(`Missing BERT token ${token}.`);
    return value;
  };
  const special = { cls: id('[CLS]'), sep: id('[SEP]'), pad: id('[PAD]') };
  const session = await ort.InferenceSession.create(useInt8 ? int8 : join(dir, 'model.onnx'), {
    executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1,
  });
  return { model: new LocalModel(session, ort.Tensor, encoder, manifest, special), manifest };
}
