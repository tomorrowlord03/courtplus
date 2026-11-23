import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CaseRecord, HearingApi, HearingListItem, HearingRecording, SpeakerMarker } from '@courtplus/contracts';
import { Empty, ErrorNote, Page, btn, btnPrimary, errMsg } from '../components/ui';
import { useApp } from '../lib/context';
import { caseLabel, clock, hearingBridge, speakerName, speakerOptions } from './hearing-tools';

type Phase = 'idle' | 'recording' | 'paused' | 'saving';
interface Session {
  id: string; media: MediaRecorder; stream: MediaStream; audio: AudioContext; sequence: number; writes: Promise<void>;
  elapsedBefore: number; resumedAt: number;
}

const preferredMime = 'audio/webm;codecs=opus';

export function HearingRecorder() {
  const hearing = hearingBridge();
  if (!hearing) {
    return <Page title="Hearing recorder"><Empty title="Recording hearings works in the CourtPlus desktop app." hint="Open the desktop app on the court computer." /></Page>;
  }
  return <Recorder hearing={hearing} />;
}

function Recorder({ hearing }: { hearing: HearingApi }) {
  const { api } = useApp();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [caseId, setCaseId] = useState('');
  const [items, setItems] = useState<HearingListItem[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [markers, setMarkers] = useState<SpeakerMarker[]>([]);
  const [upload, setUpload] = useState(false);
  const [result, setResult] = useState<HearingRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const markersRef = useRef<SpeakerMarker[]>([]);

  const refresh = useCallback(() => hearing.list().then(setItems).catch(e => setError(errMsg(e))), [hearing]);
  useEffect(() => {
    void api.listCases().then(list => { setCases(list); setCaseId(current => current || list[0]?.id || ''); }).catch(e => setError(errMsg(e)));
    void refresh();
  }, [api, refresh]);

  const now = () => {
    const active = session.current;
    if (!active) return 0;
    return active.elapsedBefore + (active.media.state === 'recording' ? performance.now() - active.resumedAt : 0);
  };
  const progress = () => ({ durationMs: Math.round(now()), markers: markersRef.current });

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = window.setInterval(() => setElapsed(now()), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => { session.current?.stream.getTracks().forEach(track => track.stop()); }, []);

  async function start() {
    setError(null); setResult(null); setMarkers([]); markersRef.current = []; setElapsed(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
      const mime = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : 'audio/webm';
      const media = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48_000 });
      const { id } = await hearing.start(caseId, mime);
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = () => {
        if (audio.state === 'closed') return;
        analyser.getFloatTimeDomainData(samples);
        setLevel(Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 5));
        requestAnimationFrame(meter);
      };
      const active: Session = { id, media, stream, audio, sequence: 0, writes: Promise.resolve(), elapsedBefore: 0, resumedAt: performance.now() };
      // Each chunk is saved to disk as it arrives, so a crash loses at most the last few seconds.
      media.ondataavailable = event => {
        if (!event.data.size) return;
        const sequence = active.sequence++;
        active.writes = active.writes.then(async () => hearing.chunk(id, sequence, new Uint8Array(await event.data.arrayBuffer()), progress()));
        active.writes.catch(e => setError('Audio could not be saved: ' + errMsg(e)));
      };
      session.current = active;
      media.start(5000);
      meter();
      setPhase('recording');
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone access was refused.' : errMsg(e));
    }
  }

  function pause() {
    const active = session.current;
    if (!active) return;
    if (active.media.state === 'recording') {
      active.elapsedBefore = now();
      active.media.pause();
      setPhase('paused');
    } else {
      active.resumedAt = performance.now();
      active.media.resume();
      setPhase('recording');
    }
  }

  async function stop() {
    const active = session.current;
    if (!active) return;
    const final = progress();
    setPhase('saving');
    try {
      await new Promise<void>(resolve => { active.media.onstop = () => resolve(); active.media.stop(); });
      await active.writes;
      setResult(await hearing.stop(active.id, { ...final, upload }));
    } catch (e) {
      setError(errMsg(e) + ' The audio saved so far can be recovered from the list below.');
    } finally {
      active.stream.getTracks().forEach(track => track.stop());
      void active.audio.close();
      session.current = null;
      setPhase('idle');
      setLevel(0);
      void refresh();
    }
  }

  function mark(speaker: SpeakerMarker['speaker']) {
    const next = [...markersRef.current, { atMs: Math.round(now()), speaker }];
    markersRef.current = next;
    setMarkers(next);
  }

  async function recover(id: string) {
    setError(null);
    try { setResult(await hearing.recover(id)); } catch (e) { setError(errMsg(e)); }
    void refresh();
  }

  const recording = phase === 'recording' || phase === 'paused';
  const byId = new Map(cases.map(record => [record.id, record]));
  return (
    <Page title="Hearing recorder" note="Records the hearing on this computer. The original audio is sealed with a SHA-256 hash, a signed receipt and an audit-log entry when you stop, and is never changed afterwards.">
      <ErrorNote error={error} />
      <section className="panel" aria-label="Recorder">
        <label className="block font-semibold">Case
          <select className="field-control" value={caseId} disabled={recording || phase === 'saving'} onChange={e => setCaseId(e.target.value)}>
            {cases.length === 0 && <option value="">No saved cases yet</option>}
            {cases.map(record => <option key={record.id} value={record.id}>{caseLabel(record)}</option>)}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!recording && <button className={btnPrimary} disabled={!caseId || phase === 'saving'} onClick={() => void start()}>Start recording</button>}
          {recording && <button className={btn} onClick={pause}>{phase === 'paused' ? 'Resume' : 'Pause'}</button>}
          {recording && <button className={btnPrimary} onClick={() => void stop()}>Stop and seal</button>}
          <span className="text-2xl font-bold tabular-nums" aria-label="Elapsed time" role="timer">{clock(elapsed)}</span>
          {phase === 'paused' && <span className="muted">Paused</span>}
          {phase === 'saving' && <span role="status" className="muted">Sealing the audio…</span>}
        </div>
        <div className="mt-3 h-3 w-full max-w-md overflow-hidden rounded-full bg-slate-200" role="meter" aria-label="Microphone level"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <div className="h-full bg-emerald-600 transition-[width] duration-75" style={{ width: Math.round(level * 100) + '%' }} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={upload} disabled={recording} onChange={e => setUpload(e.target.checked)} />
          Also send the audio and receipt to the Court+ evidence store, if the configured backend has one
        </label>
      </section>

      <section className="panel mt-4" aria-label="Speaker markers">
        <h2>Who is speaking</h2>
        <p className="muted">Tap when a new person starts speaking. The transcript uses these taps for speaker names; nothing is identified from the voice.</p>
        <div className="flex flex-wrap gap-2">
          {speakerOptions.map(([value, label]) => <button key={value} className={btn} disabled={phase !== 'recording'} onClick={() => mark(value)}>{label}</button>)}
        </div>
        {markers.length > 0 && <ol className="mt-3 text-sm">{markers.slice(-6).map((marker, index) =>
          <li key={index}><span className="tabular-nums">{clock(marker.atMs)}</span> {speakerName(marker.speaker)}</li>)}</ol>}
      </section>

      {result && <section className="panel mt-4" aria-label="Sealed recording" role="status">
        <h2>Recording sealed</h2>
        <p className="break-all text-sm">SHA-256 {result.audioSha256}</p>
        <p className="text-sm">{result.receipt ? 'Signed receipt saved.' : 'Not signed yet: unlock the signing key in Settings, then sign it from the transcript page. The hash is already in the audit log.'}
          {result.upload === 'uploaded' && ' Sent to the evidence store.'}{result.upload === 'failed' && ' The evidence store did not accept the upload; the local copy is safe.'}</p>
        <Link className={btnPrimary + ' mt-2'} to={'/hearings/' + result.id}>Open transcript</Link>
      </section>}

      <section className="panel mt-4" aria-label="Recorded hearings">
        <h2>Recorded hearings</h2>
        {items.length === 0 ? <p className="muted">No hearings recorded yet.</p> : <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Started</th><th>Case</th><th>Length</th><th>Status</th><th /></tr></thead>
          <tbody>{items.map(item => <tr key={item.id} className="border-t">
            <td>{new Date(item.startedAt).toLocaleString()}</td>
            <td>{caseLabel(byId.get(item.caseId), item.caseId)}</td>
            <td className="tabular-nums">{item.durationMs === undefined ? '—' : clock(item.durationMs)}</td>
            <td>{item.state === 'interrupted' ? 'Interrupted' : (item.signed ? 'Sealed and signed' : 'Sealed, not signed')
              + (item.transcriptVersions ? ` · ${item.transcriptVersions} transcript version(s)` : '')}</td>
            <td>{item.state === 'interrupted'
              ? <button className={btn} onClick={() => void recover(item.id)}>Recover</button>
              : <Link to={'/hearings/' + item.id}>Transcript</Link>}</td>
          </tr>)}</tbody>
        </table>}
      </section>
    </Page>
  );
}
