import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseRecord, Person, TranscriptVersion } from '@courtplus/contracts';
import * as exports from '@courtplus/export';
import { describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/audit';
import { sha256, verifyHearingBundle, verifyHearingReceipt } from '../src/asr/receipt';
import { extractiveSummary, summarise } from '../src/asr/summary';
import { checkVersions, transcriptSha256 } from '../src/asr/transcript';
import { windows } from '../src/asr/whisper';
import { createRecorder, microphoneAllowed, registerRecorder, type RecorderPorts } from '../src/handlers/recorder';
import { createSigner } from '../src/handlers/signer';
import { openStore, type Store } from '../src/store';

const keyStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plaintext: string) => Buffer.from(plaintext),
  decryptStringAsync: async (wrapped: Buffer) => ({ result: wrapped.toString(), shouldReEncrypt: false }),
};
const person: Person = { id: 'fictional-person', alias: 'Fictional Accused-01', caseIds: [], priorConviction: 'unknown', otherHolds: 'unknown', prisonerType: 'undertrial' };
const record: CaseRecord = { id: 'fictional-case', personId: person.id, caseNo: 'FICTIONAL 1/2026', charges: [], custody: [], events: [], pendingStatus: 'trial' };

/** A 2-second 440 Hz tone as 16-bit PCM WAV: no voices. */
function tone(seconds = 2, rate = 16_000) {
  const samples = new Float32Array(seconds * rate).map((_, index) => 0.3 * Math.sin(2 * Math.PI * 440 * index / rate));
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples.length * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2));
  return { samples, wav: new Uint8Array(wav) };
}

const fictionalSegments = [
  { startMs: 0, endMs: 600, text: 'This is a fictional test hearing in a sample matter.' },
  { startMs: 600, endMs: 1300, text: 'The sample witness was examined and the evidence was noted.' },
  { startMs: 1300, endMs: 2000, text: 'The matter is adjourned and the next date of hearing is fixed by order.' },
];

async function withRecorder(run: (context: {
  store: Store; recorder: ReturnType<typeof createRecorder>; directory: string; exportFolder: string;
  signer: ReturnType<typeof createSigner>; ports: RecorderPorts; printed: string[];
}) => Promise<void>, overrides: Partial<RecorderPorts> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-recorder-test-'));
  const store = await openStore(directory, keyStorage);
  store.saveCase(person, record);
  const signer = createSigner(store, exports);
  const printed: string[] = [];
  const exportFolder = join(directory, 'exports');
  await (await import('node:fs/promises')).mkdir(exportFolder);
  const ports: RecorderPorts = {
    directory: join(directory, 'hearings'),
    findCase: id => id === record.id ? record : undefined,
    transcribe: async (_samples, _language, progress) => { progress(1, 1); return { segments: fictionalSegments, model: 'test-model' }; },
    modelStatus: async () => ({ available: false, model: 'not installed', sizeMb: 0 }),
    print: async html => { printed.push(html); return new Uint8Array(Buffer.from('%PDF fictional ' + html.length)); },
    folder: async () => exportFolder,
    encodeQr: exports.encodeReceiptQr,
    progress: () => undefined,
    ...overrides,
  };
  try {
    await run({ store, recorder: createRecorder(store, signer, ports), directory, exportFolder, signer, ports, printed });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function recordTone(recorder: ReturnType<typeof createRecorder>, upload = false) {
  const { wav } = tone();
  const { id } = await recorder.start(record.id, 'audio/webm;codecs=opus');
  const markers = [{ atMs: 0, speaker: 'judge' as const }, { atMs: 700, speaker: 'witness' as const }, { atMs: 1400, speaker: 'judge' as const }];
  const parts = [wav.subarray(0, 20_000), wav.subarray(20_000, 50_000), wav.subarray(50_000)];
  for (const [index, part] of parts.entries()) await recorder.chunk(id, index, part, { durationMs: (index + 1) * 600, markers: markers.slice(0, index + 1) });
  const result = await recorder.stop(id, { durationMs: 2000, markers, upload });
  return { id, wav, result };
}

describe('hearing recorder', () => {
  it('joins the chunks, hashes the original audio, signs a receipt and records it in the audit chain', () => withRecorder(async ({ store, recorder, signer, ports }) => {
    const { id, wav, result } = await recordTone(recorder);
    expect(result.audioSha256).toBe(sha256(wav));
    expect(result.audioBytes).toBe(wav.byteLength);
    const saved = join(ports.directory, id, 'audio.webm');
    expect(new Uint8Array(await readFile(saved))).toEqual(wav);
    expect(await readdir(join(ports.directory, id))).not.toContain('chunks');

    const receipt = verifyHearingReceipt(result.receipt!, signer.trustStore());
    expect(receipt).toMatchObject({ subject: 'audio', recordingId: id, caseId: record.id, audioSha256: sha256(wav), durationMs: 2000 });
    expect(verifyHearingReceipt(result.receipt!.replace(result.audioSha256, '0'.repeat(64)), signer.trustStore())).toBeUndefined();

    const entries = store.auditEntries();
    expect(verifyAuditChain(entries)).toBe(true);
    expect(entries.map(entry => entry.action)).toEqual(expect.arrayContaining(['hearing.start', 'hearing.record', 'hearing.sign']));
    expect(entries.find(entry => entry.action === 'hearing.record')?.hash).toBe(result.auditHash);
    expect(await recorder.integrity(id)).toEqual({ audioSha256: result.audioSha256, unchanged: true, readOnly: true });
  }));

  it('keeps the original read-only and detects any change to it', () => withRecorder(async ({ recorder, ports }) => {
    const { id } = await recordTone(recorder);
    const saved = join(ports.directory, id, 'audio.webm');
    await expect(writeFile(saved, 'overwritten')).rejects.toThrow();
    await chmod(saved, 0o644);
    await writeFile(saved, 'tampered');
    expect((await recorder.integrity(id)).unchanged).toBe(false);
    await expect(recorder.audio(id)).rejects.toThrow(/no longer matches/);
    await expect(recorder.transcribe(id, tone().samples, 'en')).rejects.toThrow(/no longer matches/);
  }));

  it('stops without a receipt while the key is locked and signs once unlocked', () => withRecorder(async ({ recorder, signer, store }) => {
    signer.setPassphrase(undefined, 'fictional test passphrase');
    const { id, result } = await recordTone(recorder);
    expect(result.receipt).toBeUndefined();
    expect(store.auditEntries().some(entry => entry.action === 'hearing.record')).toBe(true);
    await expect(recorder.signRecording(id)).rejects.toThrow(/Unlock/);
    signer.unlock('fictional test passphrase');
    expect(verifyHearingReceipt((await recorder.signRecording(id)).receipt!, signer.trustStore())?.audioSha256).toBe(result.audioSha256);
  }));

  it('recovers an interrupted recording with its markers, and rejects chunks out of order', () => withRecorder(async ({ store, signer, ports, recorder }) => {
    const { wav } = tone();
    const { id } = await recorder.start(record.id, 'audio/webm');
    await expect(recorder.chunk(id, 1, wav, { durationMs: 1, markers: [] })).rejects.toThrow(/out of order/);
    await recorder.chunk(id, 0, wav.subarray(0, 30_000), { durationMs: 900, markers: [{ atMs: 100, speaker: 'petitioner_counsel' }] });
    await recorder.chunk(id, 1, wav.subarray(30_000), { durationMs: 2000, markers: [{ atMs: 100, speaker: 'petitioner_counsel' }] });
    // A fresh recorder stands in for the app after a crash.
    const restarted = createRecorder(store, signer, ports);
    expect(await restarted.list()).toEqual([expect.objectContaining({ id, state: 'interrupted' })]);
    const recovered = await restarted.recover(id);
    expect(recovered).toMatchObject({ recovered: true, durationMs: 2000, audioSha256: sha256(wav), markers: [{ atMs: 100, speaker: 'petitioner_counsel' }] });
    expect(await restarted.list()).toEqual([expect.objectContaining({ id, state: 'recorded', signed: true })]);
  }));

  it('versions transcripts: machine first, edits as new versions tied to the audio hash, then signed', () => withRecorder(async ({ recorder, signer, ports }) => {
    const { id, result } = await recordTone(recorder);
    await expect(recorder.transcribe(id, new Float32Array(16_000 * 30), 'en')).rejects.toThrow(/length does not match/);
    const machine = await recorder.transcribe(id, tone().samples, 'en');
    expect(machine).toMatchObject({ version: 1, kind: 'machine', audioSha256: result.audioSha256, edits: [] });
    expect(machine.segments.map(segment => segment.speaker)).toEqual(['judge', 'witness', 'judge']);
    await expect(recorder.transcribe(id, tone().samples, 'en')).rejects.toThrow(/already has/);

    const corrected = machine.segments.map(segment => segment.id === 2 ? { ...segment, text: 'The sample witness was examined and exhibit A was noted.' } : segment);
    const edited = await recorder.saveTranscript(id, corrected);
    expect(edited).toMatchObject({ version: 2, kind: 'edited', parentVersion: 1, parentTextSha256: machine.textSha256, audioSha256: result.audioSha256 });
    expect(edited.edits).toEqual([{ segmentId: 2, machine: fictionalSegments[1].text, edited: corrected[1].text }]);
    expect(await recorder.saveTranscript(id, corrected)).toMatchObject({ version: 2 });
    await expect(recorder.saveTranscript(id, corrected.map(segment => ({ ...segment, startMs: segment.startMs + 1 })))).rejects.toThrow(/time stamps/);

    const signed = await recorder.signTranscript(id, 2);
    expect(verifyHearingReceipt(signed.receipt!, signer.trustStore())).toMatchObject({
      subject: 'transcript', transcriptVersion: 2, textSha256: transcriptSha256(edited.segments), audioSha256: result.audioSha256,
    });
    const history = await recorder.transcripts(id);
    expect(history.map(item => [item.version, Boolean(item.receipt)])).toEqual([[1, false], [2, true]]);
    expect(checkVersions(history)).toBe(true);

    // Editing a stored version outside the app breaks the chain.
    const file = join(ports.directory, id, 'v0002.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as TranscriptVersion;
    stored.segments[0].text = 'Changed outside the app.';
    await chmod(file, 0o644);
    await writeFile(file, JSON.stringify(stored));
    await expect(recorder.transcripts(id)).rejects.toThrow(/changed outside/);
  }));

  it('exports a signed summary and transcript PDF whose bundle verifies', () => withRecorder(async ({ recorder, signer, printed }) => {
    const { id } = await recordTone(recorder);
    await recorder.transcribe(id, tone().samples, 'en');
    await expect(recorder.exportPdf(id, 1)).rejects.toThrow(/Sign this transcript/);
    await recorder.signTranscript(id, 1);
    const paths = await recorder.exportPdf(id, 1);
    expect(printed[0]).toContain('Machine summary - verify before use');
    expect(printed[0]).toContain('Hint - the judge decides');
    expect(printed[0]).toContain('data:image/png;base64,');
    const bundle = { pdf: await readFile(paths.pdfPath), receipt: await readFile(paths.receiptPath, 'utf8'), manifest: await readFile(paths.manifestPath, 'utf8'), trustStore: signer.trustStore() };
    expect(verifyHearingBundle(bundle)).toEqual({ signature: 'valid', pdf: 'unchanged' });
    expect(verifyHearingBundle({ ...bundle, pdf: Buffer.from('changed') })).toEqual({ signature: 'valid', pdf: 'changed' });
    expect(verifyHearingBundle({ ...bundle, trustStore: [] }).signature).toBe('unknown_signer');
  }));

  it('uploads to the evidence store only when the backend has one, and skips silently otherwise', async () => {
    for (const [status, expected] of [[404, 'skipped'], [201, 'uploaded'], [500, 'failed']] as const) {
      const calls: string[] = [];
      await withRecorder(async ({ recorder, store }) => {
        store.writeSettings({ backendUrl: 'https://fictional-backend.invalid' });
        const { result } = await recordTone(recorder, true);
        expect(result.upload).toBe(expected);
        expect(calls).toEqual(['https://fictional-backend.invalid/evidence']);
      }, { fetch: async input => { calls.push(String(input)); return new Response(null, { status }); } });
    }
    await withRecorder(async ({ recorder }) => {
      expect((await recordTone(recorder, true)).result.upload).toBe('skipped');
    }, { fetch: async () => { throw new Error('No backend is configured, so nothing may be sent.'); } });
  });
});

describe('microphone permission', () => {
  const origins = ['courtplus://app/'];
  it('allows audio capture only for the app origin', () => {
    expect(microphoneAllowed('media', 'courtplus://app/#/hearings', ['audio'], origins)).toBe(true);
    expect(microphoneAllowed('media', 'courtplus://app/', ['audio', 'video'], origins)).toBe(false);
    expect(microphoneAllowed('media', 'courtplus://app/', [], origins)).toBe(false);
    expect(microphoneAllowed('media', 'courtplus://print/x', ['audio'], origins)).toBe(false);
    expect(microphoneAllowed('media', 'https://fictional-backend.invalid/', ['audio'], origins)).toBe(false);
    expect(microphoneAllowed('media', 'courtplus://user@app/', ['audio'], origins)).toBe(false);
    expect(microphoneAllowed('geolocation', 'courtplus://app/', ['audio'], origins)).toBe(false);
    expect(microphoneAllowed('notifications', 'courtplus://app/', [], origins)).toBe(false);
    expect(microphoneAllowed('media', 'http://localhost:5173/', ['audio'], origins)).toBe(false);
    expect(microphoneAllowed('media', 'http://localhost:5173/', ['audio'], [...origins, 'http://localhost:5173/'])).toBe(true);
  });
});

describe('hearing IPC', () => {
  it('rejects untrusted senders and invalid arguments', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener) };
    let trusted = false;
    const calls: unknown[][] = [];
    const recorder = new Proxy({}, { get: () => (...args: unknown[]) => { calls.push(args); return 'ok'; } });
    registerRecorder(ipc as never, () => trusted, recorder as never);
    expect(handlers.has('hearing:transcribe')).toBe(true);
    expect(() => handlers.get('hearing:list')!({})).toThrow('FORBIDDEN');
    trusted = true;
    expect(() => handlers.get('hearing:audio')!({}, '../../escape')).toThrow('INVALID_ARGUMENT');
    expect(() => handlers.get('hearing:start')!({}, 'fictional-case', 'video/webm')).toThrow('INVALID_ARGUMENT');
    expect(() => handlers.get('hearing:chunk')!({}, crypto.randomUUID(), 0, 'not bytes', { durationMs: 0, markers: [] })).toThrow('INVALID_ARGUMENT');
    expect(handlers.get('hearing:start')!({}, 'fictional-case', 'audio/webm;codecs=opus')).toBe('ok');
    expect(calls).toEqual([['fictional-case', 'audio/webm;codecs=opus']]);
  });
});

describe('speech windows and summary', () => {
  it('cuts long audio at the quietest point after 20 s and marks silent windows', () => {
    const samples = new Float32Array(16_000 * 70).map((_, index) => 0.2 * Math.sin(index / 5));
    samples.fill(0, 16_000 * 25, 16_000 * 25.5);
    samples.fill(0, 16_000 * 50, 16_000 * 70);
    const parts = windows(samples);
    expect(parts[0].end / 16_000).toBeGreaterThanOrEqual(25);
    expect(parts[0].end / 16_000).toBeLessThanOrEqual(25.5);
    expect(parts.every(part => part.end - part.start <= 16_000 * 29.5)).toBe(true);
    expect(parts.at(-1)?.silent).toBe(true);
    expect(parts.at(-1)?.end).toBe(samples.length);
  });

  it('quotes key sentences and prefers the research summariser when present', async () => {
    const version = {
      version: 3, segments: [
        { id: 1, startMs: 0, endMs: 1, text: 'Good morning to everyone in this fictional court room today. The weather is pleasant outside the hall.' },
        { id: 2, startMs: 1, endMs: 2, text: 'The witness was examined on the sample evidence. Counsel then spoke about lunch plans for the day.' },
        { id: 3, startMs: 2, endMs: 3, text: 'The matter is adjourned and the next date is fixed by this order. Section 480 was argued by both sides.' },
      ],
    } as TranscriptVersion;
    const local = extractiveSummary(version, 3);
    expect(local.label).toBe('Machine summary - verify before use');
    expect(local.basedOnVersion).toBe(3);
    expect(local.sentences.map(sentence => sentence.text)).toEqual([
      'The witness was examined on the sample evidence.', 'The matter is adjourned and the next date is fixed by this order.', 'Section 480 was argued by both sides.',
    ]);
    expect(local.sentences[1].keywords).toEqual(['order', 'adjourned', 'next date']);
    expect((await summarise(version, async () => { throw new Error('not installed'); })).method).toMatch(/TextRank/);
    const viaResearch = await summarise(version, async () => ({ summarise: () => ['Section 480 was argued by both sides.'] }));
    expect(viaResearch.method).toMatch(/research summariser/);
    expect(viaResearch.sentences.map(sentence => sentence.segmentId)).toEqual([3]);
  });
});
