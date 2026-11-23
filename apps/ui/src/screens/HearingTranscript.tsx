import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AudioIntegrity, HearingApi, HearingRecording, HearingSummary, SpeakerRole, TranscriptLanguage, TranscriptSegment, TranscriptVersion,
} from '@courtplus/contracts';
import { Empty, ErrorNote, Page, btn, btnPrimary, errMsg } from '../components/ui';
import { clock, decodeTo16k, hearingBridge, speakerOptions, wordDiff } from './hearing-tools';

export function HearingTranscript() {
  const hearing = hearingBridge();
  const { id = '' } = useParams();
  if (!hearing) return <Page title="Hearing transcript"><Empty title="Hearing transcripts open in the CourtPlus desktop app." /></Page>;
  return <Transcript hearing={hearing} id={id} />;
}

function Transcript({ hearing, id }: { hearing: HearingApi; id: string }) {
  const [recording, setRecording] = useState<HearingRecording | null>(null);
  const [integrity, setIntegrity] = useState<AudioIntegrity | null>(null);
  const [versions, setVersions] = useState<TranscriptVersion[]>([]);
  const [draft, setDraft] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<HearingSummary | null>(null);
  const [model, setModel] = useState<{ available: boolean; model: string; sizeMb: number } | null>(null);
  const [language, setLanguage] = useState<TranscriptLanguage>('en');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [current, check, history, status] = await Promise.all([hearing.recording(id), hearing.integrity(id), hearing.transcripts(id), hearing.modelStatus()]);
    setRecording(current); setIntegrity(check); setVersions(history); setModel(status);
    setDraft(history.at(-1)?.segments ?? []);
    return check;
  }, [hearing, id]);

  useEffect(() => {
    let url: string | undefined;
    void load().then(async check => {
      if (!check.unchanged) return;
      url = URL.createObjectURL(new Blob([(await hearing.audio(id)).slice()], { type: 'audio/webm' }));
      setAudioUrl(url);
    }).catch(e => setError(errMsg(e)));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [hearing, id, load]);

  useEffect(() => hearing.onProgress(event => { if (event.id === id) setProgress(event); }), [hearing, id]);

  const latest = versions.at(-1);
  const machine = versions[0];
  const dirty = useMemo(() => latest !== undefined && draft.some((segment, index) =>
    segment.text !== latest.segments[index]?.text || segment.speaker !== latest.segments[index]?.speaker), [draft, latest]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label); setError(null); setNotice(null);
    try { await action(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); setProgress(null); }
  }

  const transcribe = () => run('Transcribing on this computer…', async () => {
    const samples = await decodeTo16k(await hearing.audio(id));
    await hearing.transcribe(id, samples, language);
    await load();
  });
  const save = () => run('Saving…', async () => {
    const saved = await hearing.saveTranscript(id, draft);
    await load();
    setNotice('Saved as version ' + saved.version + '.');
    return saved;
  });
  const sign = () => run('Signing…', async () => {
    const target = dirty ? await hearing.saveTranscript(id, draft) : latest!;
    await hearing.signTranscript(id, target.version);
    await load();
    setNotice('Version ' + target.version + ' signed (text hash + original audio hash).');
  });
  const summarise = () => run('Summarising…', async () => setSummary(await hearing.summary(id, latest!.version)));
  const exportPdf = () => run('Exporting…', async () => {
    const paths = await hearing.exportPdf(id, latest!.version);
    setNotice('Saved ' + paths.pdfPath);
  });
  const signRecording = () => run('Signing…', async () => { setRecording(await hearing.signRecording(id)); });

  function play(segment: { startMs: number; endMs?: number }) {
    const audio = player.current;
    if (!audio) return;
    audio.currentTime = segment.startMs / 1000;
    stopAt.current = segment.endMs === undefined ? null : segment.endMs / 1000;
    void audio.play();
  }

  function edit(index: number, patch: { text?: string; speaker?: SpeakerRole }) {
    setDraft(current => current.map((segment, position) => position === index ? { ...segment, ...patch } : segment));
  }

  if (!recording) return <Page title="Hearing transcript"><ErrorNote error={error} /><p role="status" className="muted">Loading…</p></Page>;
  return (
    <Page title="Hearing transcript" note="Speaker names come from the clerk's markers during the hearing. They are not identified from voices.">
      <p><Link to="/hearings">← All recorded hearings</Link></p>
      <ErrorNote error={error} />
      {notice && <p role="status" className="my-2 rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
      <section className="panel" aria-label="Original audio">
        {integrity && (integrity.unchanged
          ? <p className="font-semibold text-emerald-800">✓ Original audio unchanged since recording{integrity.readOnly ? ' · read-only' : ''}</p>
          : <p role="alert" className="font-semibold text-red-800">⚠ The audio file no longer matches the hash sealed at recording. Do not rely on it.</p>)}
        <p className="break-all text-sm">SHA-256 {recording.audioSha256} · {clock(recording.durationMs)}{recording.recovered ? ' · recovered after an interruption' : ''}</p>
        {!recording.receipt && <p className="text-sm">Receipt not signed yet. <button className="text-button" onClick={() => void signRecording()}>Sign receipt</button></p>}
        {audioUrl && <audio ref={player} controls src={audioUrl} className="mt-2 w-full"
          onTimeUpdate={event => { if (stopAt.current !== null && event.currentTarget.currentTime >= stopAt.current) { event.currentTarget.pause(); stopAt.current = null; } }} />}
      </section>

      {busy && <p role="status" className="my-3 font-semibold">{busy}{progress && ` ${progress.done} of ${progress.total} parts`}</p>}

      {!versions.length ? <section className="panel mt-4" aria-label="Transcribe">
        <h2>Transcribe</h2>
        <p className="muted">Speech recognition runs on this computer ({model?.model ?? '…'}{model?.available ? `, ${model.sizeMb} MB` : ''}). No audio leaves the computer. A 10-minute hearing takes about 5 minutes.</p>
        <label className="block">Language
          <select className="field-control max-w-xs" value={language} onChange={e => setLanguage(e.target.value as TranscriptLanguage)}>
            <option value="en">English</option><option value="hi">Hindi</option><option value="auto">Detect automatically</option>
          </select>
        </label>
        <button className={btnPrimary + ' mt-3'} disabled={!model?.available || !integrity?.unchanged || Boolean(busy)} onClick={() => void transcribe()}>Transcribe on this computer</button>
        {model && !model.available && <p className="muted">The speech model is not installed in this build.</p>}
      </section> : <>
        <section className="panel mt-4" aria-label="Transcript editor">
          <div className="panel-heading">
            <h2>Version {latest!.version} {latest!.kind === 'machine' ? '(machine transcript)' : `(edited, ${latest!.edits.length} segment(s) changed)`}{latest!.receipt ? ' · signed' : ''}</h2>
          </div>
          <p className="muted">Edits never overwrite earlier versions. Each saved version records what changed against the machine transcript and the hash of the original audio.</p>
          <ol className="grid gap-3">{draft.map((segment, index) => {
            const original = machine.segments[index]?.text ?? '';
            return <li key={segment.id} className={'grid gap-1 rounded border p-2' + (segment.text !== original ? ' border-amber-500' : '')}>
              <div className="flex flex-wrap items-center gap-2">
                <button className="text-button tabular-nums" onClick={() => play(segment)} aria-label={'Play from ' + clock(segment.startMs)}>▶ {clock(segment.startMs)}–{clock(segment.endMs)}</button>
                <select aria-label={'Speaker for segment ' + segment.id} value={segment.speaker ?? ''} onChange={e => edit(index, { speaker: (e.target.value || undefined) as SpeakerRole | undefined })}>
                  <option value="">—</option>
                  {speakerOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <textarea aria-label={'Text of segment ' + segment.id} className="field-control" rows={2} value={segment.text} onChange={e => edit(index, { text: e.target.value })} />
              {segment.text.trim() !== original && <p className="text-sm" aria-label={'Changes in segment ' + segment.id}>Machine: {wordDiff(original, segment.text).map((part, key) =>
                part.kind === 'same' ? <span key={key}>{part.text} </span>
                  : part.kind === 'removed' ? <del key={key} className="bg-red-50">{part.text} </del> : <ins key={key} className="bg-emerald-50">{part.text} </ins>)}</p>}
            </li>;
          })}</ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn} disabled={!dirty || Boolean(busy)} onClick={() => void save()}>Save as new version</button>
            <button className={btnPrimary} disabled={Boolean(busy) || (!dirty && Boolean(latest!.receipt))} onClick={() => void sign()}>Sign transcript</button>
            <button className={btn} disabled={Boolean(busy)} onClick={() => void summarise()}>Summarise</button>
            <button className={btn} disabled={Boolean(busy) || dirty || !latest!.receipt} onClick={() => void exportPdf()}>Export signed PDF</button>
          </div>
          <details className="mt-3 text-sm"><summary>Version history</summary><ol>{versions.map(version => <li key={version.version}>
            v{version.version} · {version.kind} · {new Date(version.createdAt).toLocaleString()} · {version.receipt ? 'signed' : 'not signed'} · text SHA-256 {version.textSha256.slice(0, 16)}…
          </li>)}</ol></details>
        </section>

        {summary && <section className="panel mt-4" aria-label="Hearing summary">
          <h2>Summary</h2>
          <p className="partial-note"><strong>{summary.label}.</strong> Hint - the judge decides. Sentences are quoted from transcript version {summary.basedOnVersion}, not rewritten.</p>
          <ul className="mt-2 grid gap-1">{summary.sentences.map(sentence => <li key={sentence.segmentId + sentence.text}>
            <button className="text-button tabular-nums" onClick={() => play({ startMs: sentence.startMs })}>{clock(sentence.startMs)}</button> {sentence.text}
            {sentence.keywords.length > 0 && <span className="muted"> ({sentence.keywords.join(', ')})</span>}
          </li>)}</ul>
          <p className="muted">Method: {summary.method}.</p>
        </section>}
      </>}
    </Page>
  );
}
