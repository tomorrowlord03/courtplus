import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type {
  AudioIntegrity, HearingApi, HearingListItem, HearingRecording, HearingSummary, RecordingProgress, SpeakerRole, TranscriptLanguage, TranscriptSegment, TranscriptVersion,
} from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { z } from 'zod';
import { createHearingManifest, jsonSha256, sha256, signHearingReceipt, type ReceiptFields } from '../asr/receipt';
import { summarise } from '../asr/summary';
import { checkVersions, editedVersion, machineVersion, type RawSegment } from '../asr/transcript';
import type { Store } from '../store';
import { validateArguments } from '../validation';
import { readSettings } from './settings';
import type { createSigner } from './signer';

export type Recorder = Omit<HearingApi, 'onProgress'>;
type Signer = Pick<ReturnType<typeof createSigner>, 'key'>;

export interface RecorderPorts {
  /** Folder that holds one sub-folder per hearing, inside the app data folder. */
  directory: string;
  findCase(caseId: string): { caseNo?: string; cnr?: string; court?: string } | undefined;
  transcribe(samples: Float32Array, language: TranscriptLanguage, progress: (done: number, total: number) => void):
    Promise<{ segments: RawSegment[]; model: string }>;
  modelStatus(): Promise<{ available: boolean; model: string; sizeMb: number }>;
  print(html: string): Promise<Uint8Array>;
  folder(): Promise<string | undefined>;
  encodeQr(receiptId: string, keyId: string, receiptDigest: string): Promise<string>;
  progress(event: { id: string; done: number; total: number }): void;
  fetch?: typeof fetch;
}

const speakers: Record<SpeakerRole, string> = {
  judge: 'Judge', petitioner_counsel: 'Petitioner counsel', respondent_counsel: 'Respondent counsel', witness: 'Witness',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sampleRate = 16_000;
const versionFile = (version: number) => 'v' + String(version).padStart(4, '0') + '.json';
const escape = (text: string) => text.replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';');
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
};

/** Writes a file that may never change again: create-only, flushed, then marked read-only. */
async function writeOnce(path: string, data: string | Uint8Array) {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(path, 0o444);
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Allows microphone capture only for the app's own pages, audio only. Camera, screen and every
 * other permission stay denied.
 */
export function microphoneAllowed(permission: string, requestingUrl: string, mediaTypes: readonly string[], appOrigins: readonly string[]) {
  const url = URL.parse(requestingUrl);
  return permission === 'media' && url !== null && !url.username && !url.password
    && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio')
    && appOrigins.some(origin => {
      const allowed = new URL(origin);
      return url.protocol === allowed.protocol && url.host === allowed.host;
    });
}

export function createRecorder(store: Store, signer: Signer, ports: RecorderPorts): Recorder {
  const active = new Map<string, { caseId: string; next: number; queue: Promise<unknown> }>();
  const folder = (id: string) => {
    if (!uuid.test(id)) throw new Error('Unknown hearing recording.');
    return join(ports.directory, id);
  };
  const audioPath = (id: string) => join(folder(id), 'audio.webm');
  const issuer = () => readSettings(store).issuer;

  async function recording(id: string): Promise<HearingRecording> {
    const base = await readJson<HearingRecording>(join(folder(id), 'recording.json'));
    if (!base) throw new Error('This hearing has no finished recording.');
    const receipt = await readJson<{ receipt: string; receiptId: string }>(join(folder(id), 'receipt.json'));
    const upload = await readJson<{ upload: HearingRecording['upload'] }>(join(folder(id), 'upload.json'));
    return { ...base, ...receipt, ...upload };
  }

  async function hashFile(path: string) {
    const hash = createHash('sha256');
    const file = await open(path, 'r');
    try {
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    } finally {
      await file.close();
    }
    return hash.digest('hex');
  }

  async function integrity(id: string): Promise<AudioIntegrity> {
    const { audioSha256 } = await recording(id);
    const readOnly = await access(audioPath(id), constants.W_OK).then(() => false, () => true);
    return { audioSha256, unchanged: await hashFile(audioPath(id)) === audioSha256, readOnly };
  }

  async function requireUnchanged(id: string) {
    if (!(await integrity(id)).unchanged) throw new Error('The audio no longer matches the hash recorded when it was stopped.');
  }

  async function signRecording(id: string): Promise<HearingRecording> {
    const current = await recording(id);
    if (current.receipt) return current;
    const fields: ReceiptFields = {
      subject: 'audio', recordingId: id, caseId: current.caseId, audioSha256: current.audioSha256, audioBytes: current.audioBytes,
      durationMs: current.durationMs, mime: current.mime, startedAt: current.startedAt, stoppedAt: current.stoppedAt,
      markersSha256: jsonSha256(current.markers),
    };
    const { receipt, receiptId } = signHearingReceipt(issuer(), fields, signer.key(issuer()));
    await writeOnce(join(folder(id), 'receipt.json'), JSON.stringify({ receipt, receiptId }));
    store.audit('hearing.sign', { recordingId: id, receiptId, audioSha256: current.audioSha256 });
    return recording(id);
  }

  async function upload(id: string) {
    const backend = readSettings(store).backendUrl;
    let status: HearingRecording['upload'] = 'skipped';
    if (backend) {
      const current = await recording(id);
      const found = ports.findCase(current.caseId);
      const form = new FormData();
      form.set('file', new Blob([await readFile(audioPath(id))], { type: 'audio/webm' }), 'hearing-' + id + '.webm');
      form.set('caseRef', found?.cnr || found?.caseNo || current.caseId);
      form.set('description', 'Hearing audio recorded in Court+. SHA-256 ' + current.audioSha256);
      form.set('mode', 'identified');
      form.set('name', issuer());
      if (current.receipt) form.set('receipt', current.receipt);
      try {
        const response = await (ports.fetch ?? fetch)(backend.replace(/\/+$/, '') + '/evidence', {
          method: 'POST', body: form, signal: AbortSignal.timeout(120_000),
        });
        // No evidence store on this backend yet: skip without bothering the clerk.
        status = response.ok ? 'uploaded' : [404, 405, 501].includes(response.status) ? 'skipped' : 'failed';
      } catch {
        status = 'failed';
      }
      if (status === 'uploaded') store.audit('hearing.upload', { recordingId: id, audioSha256: current.audioSha256 });
    }
    await writeOnce(join(folder(id), 'upload.json'), JSON.stringify({ upload: status }));
    return status;
  }

  async function finish(id: string, progress: RecordingProgress, recovered: boolean): Promise<HearingRecording> {
    const session = await readJson<{ caseId: string; startedAt: string; mime: string }>(join(folder(id), 'session.json'));
    if (!session) throw new Error('Unknown hearing recording.');
    if (await exists(join(folder(id), 'recording.json'))) return recording(id);
    const chunks = join(folder(id), 'chunks');
    const parts = (await readdir(chunks).catch(() => [])).filter(name => /^\d{6}\.part$/.test(name)).sort();
    if (!parts.length) throw new Error('No audio was recorded.');
    // Join the chunks in order into the original audio, hashing exactly the bytes written.
    const hash = createHash('sha256');
    let audioBytes = 0;
    const output = await open(audioPath(id), 'wx');
    try {
      for (const part of parts) {
        const bytes = await readFile(join(chunks, part));
        hash.update(bytes);
        audioBytes += bytes.byteLength;
        await output.write(bytes);
      }
      await output.sync();
    } finally {
      await output.close();
    }
    await chmod(audioPath(id), 0o444);
    const audioSha256 = hash.digest('hex');
    const markers = [...progress.markers].filter(marker => marker.atMs <= progress.durationMs).sort((a, b) => a.atMs - b.atMs);
    const entry = store.audit('hearing.record', {
      recordingId: id, caseId: session.caseId, audioSha256, audioBytes, durationMs: progress.durationMs, markersSha256: jsonSha256(markers),
    });
    const result: HearingRecording = {
      id, caseId: session.caseId, startedAt: session.startedAt, stoppedAt: new Date().toISOString(), durationMs: progress.durationMs,
      mime: session.mime, audioBytes, audioSha256, markers, auditHash: entry.hash, ...(recovered && { recovered }),
    };
    await writeOnce(join(folder(id), 'recording.json'), JSON.stringify(result, null, 2));
    await rm(chunks, { recursive: true, force: true });
    try {
      return await signRecording(id);
    } catch {
      return result; // The key is locked: the hash is already in the audit chain; sign later.
    }
  }

  async function versions(id: string): Promise<TranscriptVersion[]> {
    const names = (await readdir(folder(id)).catch(() => [])).filter(name => /^v\d{4}\.json$/.test(name)).sort();
    const list = await Promise.all(names.map(async name => {
      const version = (await readJson<TranscriptVersion>(join(folder(id), name)))!;
      const signed = await readJson<{ receipt: string }>(join(folder(id), name.replace('.json', '.receipt.json')));
      return signed ? { ...version, receipt: signed.receipt } : version;
    }));
    if (!checkVersions(list)) throw new Error('The transcript history was changed outside CourtPlus.');
    return list;
  }

  async function version(id: string, number: number) {
    const found = (await versions(id)).find(item => item.version === number);
    if (!found) throw new Error('Transcript version ' + number + ' not found.');
    return found;
  }

  async function storeVersion(id: string, next: TranscriptVersion) {
    const { receipt: _unsigned, ...stored } = next;
    await writeOnce(join(folder(id), versionFile(next.version)), JSON.stringify(stored, null, 2));
  }

  function renderPdf(recordingInfo: HearingRecording, transcript: TranscriptVersion, summary: HearingSummary, qr: string, receiptId: string) {
    const found = ports.findCase(recordingInfo.caseId);
    const caseName = [found?.court, found?.caseNo, found?.cnr].filter(Boolean).join(' · ') || recordingInfo.caseId;
    const rows = transcript.segments.map(segment => '<tr><td>' + clock(segment.startMs) + '</td><td>'
      + escape(segment.speaker ? speakers[segment.speaker] : '—') + '</td><td>' + escape(segment.text) + '</td></tr>').join('');
    const points = summary.sentences.map(sentence => '<li><span class="t">' + clock(sentence.startMs) + '</span> '
      + escape(sentence.text) + '</li>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><style>'
      + 'body{font-family:"Noto Sans","Nirmala UI","Segoe UI",sans-serif;font-size:11pt;margin:18mm}h1{font-size:16pt}'
      + 'h2{font-size:12pt;margin-top:18px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ccc;padding:4px;vertical-align:top}'
      + 'td:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}.label{background:#fff4d6;border:1px solid #d9a400;padding:6px}'
      + '.meta{font-size:9pt;color:#333;word-break:break-all}.t{color:#555}.receipt{margin-top:18px;font-size:9pt}.receipt img{width:110px;display:block}'
      + '</style></head><body><main><h1>Hearing record</h1>'
      + '<p class="meta">Case: ' + escape(caseName) + '<br>Recorded: ' + escape(recordingInfo.startedAt) + ' · length ' + clock(recordingInfo.durationMs)
      + '<br>Original audio SHA-256: ' + recordingInfo.audioSha256 + '<br>Transcript version ' + transcript.version
      + ' (' + transcript.edits.length + ' segment(s) corrected by hand) · text SHA-256: ' + transcript.textSha256
      + '<br>Speaker names come from the clerk\'s markers during the hearing, not from voice recognition.</p>'
      + '<h2>Summary</h2><p class="label"><strong>' + escape(summary.label) + '.</strong> Sentences quoted from the transcript by '
      + escape(summary.method) + '. Hint - the judge decides.</p><ul>' + points + '</ul>'
      + '<h2>Transcript</h2><table>' + rows + '</table>'
      + '<div class="receipt"><img alt="Receipt QR code" src="' + qr + '">Receipt ' + receiptId + '</div></main></body></html>';
  }

  return {
    list: async () => {
      const names = await readdir(ports.directory).catch(() => [] as string[]);
      const items = await Promise.all(names.filter(name => uuid.test(name) && !active.has(name)).map(async (id): Promise<HearingListItem | undefined> => {
        const session = await readJson<{ caseId: string; startedAt: string }>(join(folder(id), 'session.json'));
        if (!session) return undefined;
        const transcriptVersions = (await readdir(folder(id))).filter(name => /^v\d{4}\.json$/.test(name)).length;
        const done = await readJson<HearingRecording>(join(folder(id), 'recording.json'));
        if (!done) return { id, caseId: session.caseId, startedAt: session.startedAt, state: 'interrupted', transcriptVersions };
        return {
          id, caseId: done.caseId, startedAt: done.startedAt, state: 'recorded', durationMs: done.durationMs, audioSha256: done.audioSha256,
          signed: await exists(join(folder(id), 'receipt.json')), transcriptVersions,
        };
      }));
      return items.filter((item): item is HearingListItem => item !== undefined).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    start: async (caseId, mime) => {
      if (!ports.findCase(caseId)) throw new Error('Choose a saved case before recording.');
      const id = randomUUID();
      await mkdir(join(folder(id), 'chunks'), { recursive: true });
      await writeOnce(join(folder(id), 'session.json'), JSON.stringify({ id, caseId, startedAt: new Date().toISOString(), mime }));
      active.set(id, { caseId, next: 0, queue: Promise.resolve() });
      store.audit('hearing.start', { recordingId: id, caseId });
      return { id };
    },
    chunk: (id, sequence, bytes, progress) => {
      const session = active.get(id);
      if (!session) return Promise.reject(new Error('This hearing is not being recorded.'));
      const write = session.queue.then(async () => {
        if (sequence !== session.next) throw new Error('Audio chunk ' + sequence + ' arrived out of order.');
        await writeOnce(join(folder(id), 'chunks', String(sequence).padStart(6, '0') + '.part'), bytes);
        session.next += 1;
        await writeFile(join(folder(id), 'progress.json'), JSON.stringify(progress));
      });
      session.queue = write.catch(() => undefined);
      return write;
    },
    stop: async (id, { upload: send, ...progress }) => {
      const session = active.get(id);
      if (!session) throw new Error('This hearing is not being recorded.');
      await session.queue;
      active.delete(id);
      const result = await finish(id, progress, false);
      if (send) return { ...result, upload: await upload(id) };
      return result;
    },
    recover: async id => {
      if (active.has(id)) throw new Error('This hearing is still being recorded.');
      const progress = await readJson<RecordingProgress>(join(folder(id), 'progress.json')) ?? { durationMs: 0, markers: [] };
      return finish(id, progress, true);
    },
    recording,
    signRecording,
    integrity,
    audio: async id => {
      await requireUnchanged(id);
      return new Uint8Array(await readFile(audioPath(id)));
    },
    transcribe: async (id, samples, language) => {
      const current = await recording(id);
      if ((await versions(id)).length) throw new Error('This hearing already has a machine transcript (version 1).');
      await requireUnchanged(id);
      const seconds = samples.length / sampleRate;
      if (current.durationMs > 0 && Math.abs(seconds * 1000 - current.durationMs) > Math.max(3000, current.durationMs * 0.1)) {
        throw new Error('The decoded audio length does not match the recording.');
      }
      const { segments, model } = await ports.transcribe(samples, language, (done, total) => ports.progress({ id, done, total }));
      const machine = machineVersion({
        recordingId: id, audioSha256: current.audioSha256, segments, markers: current.markers, model, language,
      });
      await storeVersion(id, machine);
      store.audit('hearing.transcribe', { recordingId: id, version: 1, textSha256: machine.textSha256, model });
      return machine;
    },
    transcripts: versions,
    saveTranscript: async (id, segments: TranscriptSegment[]) => {
      const list = await versions(id);
      if (!list.length) throw new Error('Transcribe the hearing first.');
      const next = editedVersion(list[0], list.at(-1)!, segments);
      if (!next) return list.at(-1)!;
      await storeVersion(id, next);
      store.audit('hearing.transcript.edit', {
        recordingId: id, version: next.version, textSha256: next.textSha256, parentTextSha256: next.parentTextSha256, edits: next.edits.length,
      });
      return next;
    },
    signTranscript: async (id, number) => {
      const target = await version(id, number);
      if (target.receipt) return target;
      const current = await recording(id);
      const { receipt, receiptId } = signHearingReceipt(issuer(), {
        subject: 'transcript', recordingId: id, caseId: current.caseId, audioSha256: target.audioSha256,
        transcriptVersion: target.version, textSha256: target.textSha256, parentTextSha256: target.parentTextSha256,
      }, signer.key(issuer()));
      await writeOnce(join(folder(id), versionFile(number).replace('.json', '.receipt.json')), JSON.stringify({ receipt, receiptId }));
      store.audit('hearing.transcript.sign', { recordingId: id, version: number, receiptId, textSha256: target.textSha256 });
      return { ...target, receipt };
    },
    summary: async (id, number) => summarise(await version(id, number)),
    exportPdf: async (id, number) => {
      const target = await version(id, number);
      if (!target.receipt) throw new Error('Sign this transcript version before exporting it.');
      const current = await recording(id);
      const summary = await summarise(target);
      const directory = await ports.folder();
      if (!directory) throw new Error('Export cancelled.');
      const key = signer.key(issuer());
      const { receipt, receiptId, receiptDigest } = signHearingReceipt(issuer(), {
        subject: 'export', recordingId: id, caseId: current.caseId, audioSha256: current.audioSha256,
        transcriptVersion: target.version, textSha256: target.textSha256, summarySha256: jsonSha256(summary),
      }, key);
      const qr = await ports.encodeQr(receiptId, key.keyId, receiptDigest);
      const pdf = await ports.print(renderPdf(current, target, summary, qr, receiptId));
      const manifest = createHearingManifest(pdf, receipt, key);
      const paths = { pdfPath: join(directory, receiptId + '.pdf'), receiptPath: join(directory, receiptId + '.json'), manifestPath: join(directory, receiptId + '.manifest.json') };
      await writeFile(paths.pdfPath, pdf, { flag: 'wx' });
      await writeFile(paths.receiptPath, receipt, { flag: 'wx' });
      await writeFile(paths.manifestPath, manifest, { flag: 'wx' });
      store.audit('hearing.export', { recordingId: id, version: number, receiptId, pdfSha256: sha256(pdf) });
      return paths;
    },
    modelStatus: () => ports.modelStatus(),
  };
}

const id = z.string().regex(uuid);
const day = 24 * 3600_000;
const marker = z.strictObject({ atMs: z.number().int().min(0).max(day), speaker: z.enum(['judge', 'petitioner_counsel', 'respondent_counsel', 'witness']) });
const progress = z.strictObject({ durationMs: z.number().int().min(0).max(day), markers: z.array(marker).max(10_000) });
const segment = z.strictObject({
  id: z.number().int().min(1), startMs: z.number().int().min(0), endMs: z.number().int().min(0),
  text: z.string().max(10_000), speaker: marker.shape.speaker.optional(),
});
const version = z.number().int().min(1).max(100_000);
const schemas: { [K in keyof Recorder]: z.ZodType<Parameters<Recorder[K]>> } = {
  list: z.tuple([]),
  start: z.tuple([z.string().min(1).max(200), z.string().regex(/^audio\/webm(;\s*codecs=opus)?$/)]),
  chunk: z.tuple([id, z.number().int().min(0).max(1_000_000), z.instanceof(Uint8Array).refine(bytes => bytes.byteLength <= 32 * 1024 * 1024), progress]),
  stop: z.tuple([id, progress.extend({ upload: z.boolean() })]),
  recover: z.tuple([id]),
  recording: z.tuple([id]),
  signRecording: z.tuple([id]),
  integrity: z.tuple([id]),
  audio: z.tuple([id]),
  // Three hours of 16 kHz audio at most.
  transcribe: z.tuple([id, z.instanceof(Float32Array).refine(samples => samples.length <= 3 * 3600 * sampleRate), z.enum(['en', 'hi', 'auto'])]),
  transcripts: z.tuple([id]),
  saveTranscript: z.tuple([id, z.array(segment).max(50_000)]),
  signTranscript: z.tuple([id, version]),
  summary: z.tuple([id, version]),
  exportPdf: z.tuple([id, version]),
  modelStatus: z.tuple([]),
};

export function registerRecorder(ipcMain: IpcMain, isTrusted: (event: IpcMainInvokeEvent, method: string) => boolean, recorder: Recorder) {
  for (const name of Object.keys(schemas) as (keyof Recorder)[]) {
    ipcMain.handle('hearing:' + name, (event, ...args: unknown[]) => {
      if (!isTrusted(event, 'hearing:' + name)) throw new Error('FORBIDDEN');
      const method = recorder[name] as (...input: unknown[]) => unknown;
      return method(...validateArguments(schemas[name] as z.ZodType<unknown[]>, args));
    });
  }
}
