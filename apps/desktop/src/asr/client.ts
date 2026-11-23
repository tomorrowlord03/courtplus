import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { TranscriptLanguage } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type { RawSegment } from './transcript';
import { modelSizeMb, readModelInfo } from './whisper';

type Reply = { type: 'progress'; done: number; total: number } | { type: 'done'; segments: RawSegment[]; model: string }
  | { type: 'error'; message: string };

/** Main-process side of the speech engine: one utility process, one job at a time. */
export function createAsrClient(asrDirectory: string) {
  let child: UtilityProcess | undefined;
  let busy = false;

  async function transcribe(samples: Float32Array, language: TranscriptLanguage, progress: (done: number, total: number) => void) {
    if (busy) throw new Error('Another hearing is being transcribed. Try again when it finishes.');
    busy = true;
    const worker = child ??= utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'CourtPlus speech', stdio: 'ignore' });
    try {
      return await new Promise<{ segments: RawSegment[]; model: string }>((resolve, reject) => {
        const exited = () => {
          child = undefined;
          reject(new Error('The speech engine stopped unexpectedly.'));
        };
        const message = (reply: Reply) => {
          if (reply.type === 'progress') return progress(reply.done, reply.total);
          worker.off('message', message);
          worker.off('exit', exited);
          if (reply.type === 'done') resolve(reply);
          else reject(new Error(reply.message));
        };
        worker.on('message', message);
        worker.once('exit', exited);
        worker.postMessage({ asrDirectory, samples, language });
      });
    } finally {
      busy = false;
    }
  }

  async function status() {
    const model = await readModelInfo(asrDirectory);
    return { available: Boolean(model), model: model ? model.name + ' ' + model.dtype : 'not installed', sizeMb: await modelSizeMb(asrDirectory) };
  }

  return { transcribe, status, stop: () => child?.kill() };
}
