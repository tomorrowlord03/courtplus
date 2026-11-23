import { ui } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AudioIntegrity, HearingPublishApi, HearingRecording, HearingSummary, SpeakerRole, TranscriptLanguage, TranscriptSegment, TranscriptVersion,
} from '@courtplus/contracts';
import { Empty, ErrorNote, btn, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import { useApp } from '../lib/context';
import { clock, hearingBridge, speakerOptions, wordDiff, type HearingBridge } from './hearing-tools';

export function HearingTranscript() {
  const hearing = hearingBridge();
  const { id = '' } = useParams();
  if (!hearing) return <ScreenPage screenId="hearing-transcript" judgeHint><Empty title={ui('Hearing transcripts open in the Court+ desktop app.')} /></ScreenPage>;
  return <Transcript hearing={hearing as HearingBridge & HearingPublishApi} id={id} />;
}

function Transcript({ hearing, id }: { hearing: HearingBridge & HearingPublishApi; id: string }) {
  const { profile } = useApp();
  const [recording, setRecording] = useState<HearingRecording | null>(null);
  const [integrity, setIntegrity] = useState<AudioIntegrity | null>(null);
  const [versions, setVersions] = useState<TranscriptVersion[]>([]);
  const [draft, setDraft] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<HearingSummary | null>(null);
  const [reviewedSummary, setReviewedSummary] = useState('');
  const [approved, setApproved] = useState(false);
  const [published, setPublished] = useState(false);
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

  const transcribe = () => run(ui('Transcribing on this computer…'), async () => {
    await hearing.transcribe(id, language);
    await load();
  });
  const save = () => run(ui('Saving…'), async () => {
    const saved = await hearing.saveTranscript(id, draft);
    await load();
    setNotice(ui('Saved as version') + ' ' + saved.version + '.');
    return saved;
  });
  const sign = () => run(ui('Signing…'), async () => {
    const target = dirty ? await hearing.saveTranscript(id, draft) : latest!;
    await hearing.signTranscript(id, target.version);
    await load();
    setNotice(ui('Version') + ' ' + target.version + ' ' + ui('signed (text hash + original audio hash).'));
  });
  const summarise = () => run(ui('Summarising…'), async () => {
    const result = await hearing.summary(id, latest!.version);
    setSummary(result);
    setReviewedSummary(result.sentences.map(sentence => sentence.text).join(' '));
    setApproved(false);
    setPublished(false);
  });
  const publish = () => run(ui('Publishing…'), async () => {
    await hearing.publishSummary(id, reviewedSummary.trim(), true);
    setPublished(true);
    setNotice(ui('Approved summary published for parties.'));
  });
  const exportPdf = () => run(ui('Exporting…'), async () => {
    const paths = await hearing.exportPdf(id, latest!.version);
    setNotice(ui('Saved') + ' ' + paths.pdfPath);
  });
  const signRecording = () => run(ui('Signing…'), async () => { setRecording(await hearing.signRecording(id)); });

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

  if (!recording) return <ScreenPage screenId="hearing-transcript" judgeHint><ErrorNote error={error} /><p role="status" className="muted">{ui("Loading…")}</p></ScreenPage>;
  return (
    <ScreenPage screenId="hearing-transcript" judgeHint note={ui("Hearing transcript. Speaker names come from the court clerk.")}>
      <p><Link to="/hearings">{ui("← All recorded hearings")}</Link></p>
      <ErrorNote error={error} />
      {notice && <p role="status" className="my-2 rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
      <section className="panel" aria-label={ui("Original audio")}>
        {integrity && (integrity.unchanged
          ? <p className="font-semibold text-emerald-800">{ui('✓ Original audio unchanged since recording')}{integrity.readOnly ? ` · ${ui('read-only')}` : ''}</p>
          : <p role="alert" className="font-semibold text-red-800">{ui("⚠ The audio file no longer matches the hash sealed at recording. Do not rely on it.")}</p>)}
        <p className="break-all text-sm">SHA-256 {recording.audioSha256} · {clock(recording.durationMs)}{recording.recovered ? ` · ${ui('recovered after an interruption')}` : ''}</p>
        {!recording.receipt && <p className="text-sm">{ui("Receipt not signed yet.") + " "}<button className="text-button" onClick={() => void signRecording()}>{ui("Sign receipt")}</button></p>}
        {audioUrl && <audio ref={player} controls src={audioUrl} className="mt-2 w-full"
          onTimeUpdate={event => { if (stopAt.current !== null && event.currentTarget.currentTime >= stopAt.current) { event.currentTarget.pause(); stopAt.current = null; } }} />}
      </section>

      {busy && <p role="status" className="my-3 font-semibold">{busy}{progress && ` ${progress.done} ${ui('of')} ${progress.total} ${ui('parts')}`}</p>}

      {!versions.length ? <section className="panel mt-4" aria-label={ui("Transcribe")}>
        <h2>{ui("Transcribe")}</h2>
        <p className="muted">{ui('Speech recognition runs on this computer')} ({model?.model ?? '…'}{model?.available ? `, ${model.sizeMb} MB` : ''}). {ui('No audio leaves the computer. A 10-minute hearing takes about 5 minutes.')}</p>
        <label className="block">{ui("Language")}<select className="field-control max-w-xs" value={language} onChange={e => setLanguage(e.target.value as TranscriptLanguage)}>
            <option value="en">{ui("English")}</option><option value="hi">{ui("Hindi")}</option><option value="auto">{ui("Detect automatically")}</option>
          </select>
        </label>
        <button data-guide="start" className={btnPrimary + ' mt-3'} disabled={!model?.available || !integrity?.unchanged || !recording.receipt || Boolean(busy)} onClick={() => void transcribe()}>{ui('Make a written record')}</button>
        {model && !model.available && <p className="muted">{ui('The speech model is not installed in this build.')}</p>}
      </section> : <>
        <section className="panel mt-4" aria-label={ui("Transcript editor")}>
          <div className="panel-heading">
            <h2>{ui('Version')} {latest!.version} {latest!.kind === 'machine' ? ui('(machine transcript)') : `(${ui('edited')}, ${latest!.edits.length} ${ui('segment(s) changed')})`}{latest!.receipt ? ` · ${ui('signed')}` : ''}</h2>
          </div>
          <p className="muted">{ui("Edits never overwrite earlier versions. Each saved version records what changed against the machine transcript and the hash of the original audio.")}</p>
          <ol className="grid gap-3">{draft.map((segment, index) => {
            const original = machine.segments[index]?.text ?? '';
            return <li key={segment.id} className={'grid gap-1 rounded border p-2' + (segment.text !== original ? ' border-amber-500' : '')}>
              <div className="flex flex-wrap items-center gap-2">
                <button className="text-button tabular-nums" onClick={() => play(segment)} aria-label={ui('Play from') + ' ' + clock(segment.startMs)}>▶ {clock(segment.startMs)}–{clock(segment.endMs)}</button>
                <select aria-label={ui('Speaker for segment') + ' ' + segment.id} value={segment.speaker ?? ''} onChange={e => edit(index, { speaker: (e.target.value || undefined) as SpeakerRole | undefined })}>
                  <option value="">—</option>
                  {speakerOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <textarea aria-label={ui('Text of segment') + ' ' + segment.id} className="field-control" rows={2} value={segment.text} onChange={e => edit(index, { text: e.target.value })} />
              {segment.text.trim() !== original && <p className="text-sm" aria-label={ui('Changes in segment') + ' ' + segment.id}>{ui('Machine:') + ' '}{wordDiff(original, segment.text).map((part, key) =>
                part.kind === 'same' ? <span key={key}>{part.text} </span>
                  : part.kind === 'removed' ? <del key={key} className="bg-red-50">{part.text} </del> : <ins key={key} className="bg-emerald-50">{part.text} </ins>)}</p>}
            </li>;
          })}</ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn} disabled={!dirty || Boolean(busy)} onClick={() => void save()}>{ui("Save as new version")}</button>
            <button className={btnPrimary} disabled={Boolean(busy) || (!dirty && Boolean(latest!.receipt))} onClick={() => void sign()}>{ui("Sign transcript")}</button>
            <button className={btn} disabled={Boolean(busy)} onClick={() => void summarise()}>{ui("Summarise")}</button>
            <button className={btn} disabled={Boolean(busy) || dirty || !latest!.receipt} onClick={() => void exportPdf()}>{ui("Export signed PDF")}</button>
          </div>
          <details className="mt-3 text-sm"><summary>{ui("Version history")}</summary><ol>{versions.map(version => <li key={version.version}>
            v{version.version} · {ui(version.kind)} · {new Date(version.createdAt).toLocaleString()} · {version.receipt ? ui('signed') : ui('not signed')} · {ui('text SHA-256')} {version.textSha256.slice(0, 16)}…
          </li>)}</ol></details>
        </section>

        {summary && <section className="panel mt-4" aria-label={ui("Hearing summary")}>
          <h2>{ui("Summary")}</h2>
          <p className="partial-note"><strong>{ui(summary.label)}.</strong> {ui('Hint - the judge decides')}. {ui('Sentences are quoted from transcript version')} {summary.basedOnVersion}, {ui('not rewritten')}.</p>
          <ul className="mt-2 grid gap-1">{summary.sentences.map(sentence => <li key={sentence.segmentId + sentence.text}>
            <button className="text-button tabular-nums" onClick={() => play({ startMs: sentence.startMs })}>{clock(sentence.startMs)}</button> {sentence.text}
            {sentence.keywords.length > 0 && <span className="muted"> ({sentence.keywords.join(', ')})</span>}
          </li>)}</ul>
          <p className="muted">{ui('Method:')} {summary.method}.</p>
          <label className="mt-3 block font-semibold">{ui('Plain-language summary for parties')}
            <textarea className="field-control mt-1" rows={6} maxLength={10000} value={reviewedSummary}
              onChange={event => { setReviewedSummary(event.target.value); setApproved(false); setPublished(false); }} />
          </label>
          <p className="text-sm">{ui('Review and remove names, contact details and other personal information before publishing. Only this text, the case reference and hearing dates are sent.')}</p>
          <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={approved}
            onChange={event => setApproved(event.target.checked)} />{ui('I am the judge and have checked and approved this masked summary for the parties.')}</label>
          {profile?.role === 'judge' && <button className={btnPrimary + ' mt-3'}
            disabled={!latest?.receipt || !approved || reviewedSummary.trim().length < 20 || Boolean(busy) || published}
            onClick={() => void publish()}>{ui('Publish summary for parties')}</button>}
          {published && <p role="status" className="text-emerald-800">{ui('Published by the court.')}</p>}
        </section>}
      </>}
    </ScreenPage>
  );
}
