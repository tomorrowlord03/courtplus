// Runs in an Electron utility process so speech recognition never blocks the main process.
import { loadRecognizer, transcribe } from './whisper';

interface Job { asrDirectory: string; samples: Float32Array; language: 'en' | 'hi' | 'auto' }
interface Port { on(event: 'message', listener: (event: { data: Job }) => void): void; postMessage(message: unknown): void }

const port = (process as NodeJS.Process & { parentPort?: Port }).parentPort;
let loaded: ReturnType<typeof loadRecognizer> | undefined;

async function run({ asrDirectory, samples, language }: Job, reply: Port) {
  try {
    loaded ??= loadRecognizer(asrDirectory);
    const { recognize, model } = await loaded;
    const segments = await transcribe(recognize, samples, language, (done, total) => reply.postMessage({ type: 'progress', done, total }));
    reply.postMessage({ type: 'done', segments, model: model.name + ' ' + model.dtype });
  } catch (error) {
    loaded = undefined;
    reply.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

port?.on('message', ({ data }) => void run(data, port));
