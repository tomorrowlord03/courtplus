import { readFile, readdir, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { RawSegment } from './transcript';

// The package's own declarations do not compile under this app's Node16 settings, so only the
// part used here is typed.
interface Transformers {
  env: { allowRemoteModels: boolean; allowLocalModels: boolean; useFSCache: boolean; localModelPath: string };
  pipeline(task: 'automatic-speech-recognition', model: string, options: Record<string, unknown>): Promise<unknown>;
}
type Language = 'en' | 'hi' | 'auto';
export interface ModelInfo { name: string; dtype: 'q8' | 'fp32'; source: string; bytes: number }
type Recognizer = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

export const sampleRate = 16_000;
const longest = 29.5 * sampleRate;
const shortest = 20 * sampleRate;
const frame = sampleRate / 10;
// Below this RMS a window is treated as silence and not sent to the model, which would otherwise
// tend to invent filler text for silent audio.
const silenceRms = 0.004;

export async function readModelInfo(asrDirectory: string): Promise<ModelInfo | undefined> {
  try {
    return JSON.parse(await readFile(join(asrDirectory, 'model.json'), 'utf8')) as ModelInfo;
  } catch {
    return undefined;
  }
}

export async function modelSizeMb(asrDirectory: string): Promise<number> {
  let bytes = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else bytes += (await stat(path)).size;
    }
  };
  await walk(asrDirectory).catch(() => undefined);
  return Math.round(bytes / 1e5) / 10;
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Splits audio into windows of at most 29.5 s, cutting at the quietest 100 ms after 20 s. */
export function windows(samples: Float32Array): { start: number; end: number; silent: boolean }[] {
  const result: { start: number; end: number; silent: boolean }[] = [];
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(samples.length, start + longest);
    if (end < samples.length) {
      let quietest = Infinity;
      for (let cut = start + shortest; cut + frame <= start + longest; cut += frame) {
        const level = rms(samples, cut, cut + frame);
        if (level < quietest) {
          quietest = level;
          end = cut + frame / 2;
        }
      }
    }
    result.push({ start, end, silent: rms(samples, start, end) < silenceRms });
    start = end;
  }
  return result;
}

export async function loadRecognizer(asrDirectory: string): Promise<{ recognize: Recognizer; model: ModelInfo }> {
  const model = await readModelInfo(asrDirectory);
  if (!model) throw new Error('The speech model is not installed. Run "npm run asr-model" in apps/desktop.');
  const runtimeName = '@huggingface/transformers';
  const runtime = await import(runtimeName) as Transformers;
  runtime.env.allowRemoteModels = false;
  runtime.env.allowLocalModels = true;
  runtime.env.useFSCache = false;
  runtime.env.localModelPath = asrDirectory;
  const recognize = await runtime.pipeline('automatic-speech-recognition', 'whisper', {
    dtype: { encoder_model: model.dtype, decoder_model_merged: model.dtype },
    local_files_only: true,
    device: 'cpu',
    session_options: { intraOpNumThreads: Math.max(1, availableParallelism() - 1), interOpNumThreads: 1 },
  });
  return { recognize: recognize as unknown as Recognizer, model };
}

/** Transcribes 16 kHz mono audio window by window, reporting progress after each window. */
export async function transcribe(
  recognize: Recognizer, samples: Float32Array, language: Language,
  progress: (done: number, total: number) => void = () => undefined,
): Promise<RawSegment[]> {
  const parts = windows(samples);
  const segments: RawSegment[] = [];
  for (const [index, part] of parts.entries()) {
    if (!part.silent) {
      const output = await recognize(samples.subarray(part.start, part.end), {
        return_timestamps: true, task: 'transcribe', ...(language !== 'auto' && { language }),
      });
      const offset = part.start / sampleRate * 1000;
      const windowEnd = part.end / sampleRate * 1000;
      for (const chunk of output.chunks ?? [{ text: output.text, timestamp: [0, null] as [number, null] }]) {
        const text = chunk.text.trim();
        if (!text) continue;
        const startMs = Math.round(offset + chunk.timestamp[0] * 1000);
        const endMs = Math.round(Math.min(windowEnd, chunk.timestamp[1] === null ? windowEnd : offset + chunk.timestamp[1] * 1000));
        segments.push({ startMs, endMs: Math.max(startMs, endMs), text });
      }
    }
    progress(index + 1, parts.length);
  }
  return segments;
}
