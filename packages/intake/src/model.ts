import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { groupTokens } from './ner.js';
import { wordPieceOffsets } from './wordpiece.js';

type Transformers = typeof import('@huggingface/transformers');
type OrtWeb = typeof import('onnxruntime-web');
const ortSymbol = Symbol.for('onnxruntime');
const transformersEntry = fileURLToPath(import.meta.resolve('@huggingface/transformers'));
const requireFromTransformers = createRequire(transformersEntry);
let webRuntime: Promise<Transformers> | undefined;

function offline(env: Transformers['env']): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'file:') throw new Error('Order intake only loads local model files.');
    try {
      return new Response(new Uint8Array(await readFile(url)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
      throw error;
    }
  };
}

async function loadWebRuntime(): Promise<Transformers> {
  const ortRoot = dirname(requireFromTransformers.resolve('onnxruntime-web'));
  // The web build can use the WASM backend in Node when supplied the same runtime
  // that it uses to construct ONNX tensors. The native addon may be missing entirely.
  const ort = await import(pathToFileURL(join(ortRoot, 'ort.node.min.mjs')).href) as OrtWeb;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: pathToFileURL(join(ortRoot, 'ort-wasm-simd-threaded.mjs')).href,
    wasm: pathToFileURL(join(ortRoot, 'ort-wasm-simd-threaded.wasm')).href,
  };

  const globals = globalThis as typeof globalThis & { [ortSymbol]?: OrtWeb };
  const previous = Object.getOwnPropertyDescriptor(globals, ortSymbol);
  Object.defineProperty(globals, ortSymbol, { value: ort, configurable: true });
  try {
    const runtime = await import(pathToFileURL(join(dirname(transformersEntry), 'transformers.web.js')).href) as Transformers;
    offline(runtime.env);
    // The Transformers web build asks for ONNX paths when running in Node.
    // Expose the bundled weights as a read-only file lookup, without copying them.
    const localPrefix = 'courtplus-local/';
    runtime.env.remoteHost = localPrefix;
    runtime.env.remotePathTemplate = '{model}';
    runtime.env.useCustomCache = true;
    runtime.env.customCache = {
      async match(key) {
        const file = key.startsWith(localPrefix) ? key.slice(localPrefix.length) : key;
        if (!file.startsWith('file:') || !file.endsWith('.onnx')) return;
        const path = fileURLToPath(file);
        return access(path).then(() => path, () => undefined);
      },
      async put() {},
    };
    return runtime;
  } finally {
    if (previous) Object.defineProperty(globals, ortSymbol, previous);
    else delete globals[ortSymbol];
  }
}

async function loadPipeline(modelDir: string, filename: string, native: boolean) {
  const runtime = native
    ? await import('@huggingface/transformers')
    : await (webRuntime ??= loadWebRuntime());
  offline(runtime.env);
  // Absolute paths keep concurrent imports independent of the shared environment.
  runtime.env.localModelPath = parse(modelDir).root;
  const modelPath = native ? modelDir : pathToFileURL(modelDir).href;
  return runtime.pipeline('token-classification', modelPath, {
    dtype: 'fp32',
    model_file_name: filename,
    local_files_only: true,
    // Transformers.js leaves its device list empty when an explicit ORT is injected.
    device: native ? 'cpu' : 'auto',
    session_options: native ? { intraOpNumThreads: 2, interOpNumThreads: 1 } : {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      extra: { session: { disable_prepacking: '1' } },
    },
  });
}

export async function loadClassifier(modelDir: string) {
  const directory = resolve(modelDir);
  const onnx = join(directory, 'onnx');
  const exists = (filename: string) => access(join(onnx, filename + '.onnx')).then(() => true, () => false);
  const [fp32, quantized] = await Promise.all([exists('model'), exists('model_quantized')]);
  if (!fp32 && !quantized) throw new Error('The local NER directory is missing an ONNX model.');
  let pipeline;
  try {
    pipeline = await loadPipeline(directory, fp32 ? 'model' : 'model_quantized', true);
  } catch (nativeError) {
    try {
      pipeline = await loadPipeline(directory, quantized ? 'model_quantized' : 'model', false);
    } catch (wasmError) {
      throw new AggregateError([nativeError, wasmError], 'Could not load the local NER model with native ONNX or WASM.');
    }
  }

  const tokenizer = pipeline.tokenizer;
  const tokenizerLimit: unknown = tokenizer.model_max_length;
  const config = pipeline.model.config as { max_position_embeddings?: number };
  const maxTokens = Math.min(typeof tokenizerLimit === 'number' ? tokenizerLimit : Infinity, config.max_position_embeddings ?? 512);

  return {
    maxTokens,
    countTokens: (text: string) => tokenizer.encode(text).length,
    async classify(text: string) {
      // Apply simple BIO aggregation to the indexed predictions. The library's
      // grouped output drops indices as well as offsets.
      const raw = await pipeline(text, { aggregation_strategy: 'none' });
      return groupTokens(text, raw, wordPieceOffsets(text, tokenizer));
    },
    dispose: () => pipeline.dispose(),
  };
}
