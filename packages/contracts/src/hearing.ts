// Hearing recorder and stenographer (desktop only). The original audio is never changed:
// every transcript is a separate, append-only version that names the audio's SHA-256.

export type SpeakerRole = 'judge' | 'petitioner_counsel' | 'respondent_counsel' | 'witness';

export const speakerLabels: Record<SpeakerRole, string> = {
  judge: 'Judge',
  petitioner_counsel: 'Petitioner counsel',
  respondent_counsel: 'Respondent counsel',
  witness: 'Witness',
};

/** A clerk's tap during the hearing. `atMs` is on the audio timeline (pauses excluded). */
export interface SpeakerMarker { atMs: number; speaker: SpeakerRole }

export type TranscriptLanguage = 'en' | 'hi' | 'auto';

export interface RecordingProgress { durationMs: number; markers: SpeakerMarker[] }

export interface HearingRecording {
  id: string;
  caseId: string;
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  mime: string;
  audioBytes: number;
  audioSha256: string;
  markers: SpeakerMarker[];
  /** Hash of the audit-log entry that recorded the audio hash. */
  auditHash: string;
  /** Signed receipt JSON; absent while the signing key was locked at stop. */
  receipt?: string;
  receiptId?: string;
  upload?: 'uploaded' | 'skipped' | 'failed';
  /** Joined after an interruption; length and markers are as of the last saved chunk. */
  recovered?: boolean;
}

export interface HearingListItem {
  id: string;
  caseId: string;
  startedAt: string;
  /** `interrupted`: chunks exist but the recording was never stopped (for example after a crash). */
  state: 'recorded' | 'interrupted';
  durationMs?: number;
  audioSha256?: string;
  signed?: boolean;
  transcriptVersions: number;
}

export interface TranscriptSegment {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
  /** From the clerk's markers only. There is no automatic speaker identification. */
  speaker?: SpeakerRole;
}

export interface SegmentEdit { segmentId: number; machine: string; edited: string }

export interface TranscriptVersion {
  version: number;
  kind: 'machine' | 'edited';
  recordingId: string;
  audioSha256: string;
  parentVersion?: number;
  parentTextSha256?: string;
  /** SHA-256 of the RFC 8785 JSON of `segments`. */
  textSha256: string;
  segments: TranscriptSegment[];
  /** Every segment whose text differs from the machine transcript (version 1). */
  edits: SegmentEdit[];
  createdAt: string;
  model?: string;
  language?: TranscriptLanguage;
  /** Present once signed. Signs the text hash together with the audio hash. */
  receipt?: string;
}

export interface SummarySentence { text: string; segmentId: number; startMs: number; keywords: string[]; score: number }

export interface HearingSummary {
  label: 'Machine summary - verify before use';
  method: string;
  basedOnVersion: number;
  sentences: SummarySentence[];
}

export interface AudioIntegrity { audioSha256: string; unchanged: boolean; readOnly: boolean }

export interface HearingApi {
  list(): Promise<HearingListItem[]>;
  start(caseId: string, mime: string): Promise<{ id: string }>;
  /**
   * Appends one MediaRecorder chunk; written and flushed to disk before this resolves. `progress` is
   * saved alongside so an interrupted recording keeps its length and the clerk's markers.
   */
  chunk(id: string, sequence: number, bytes: Uint8Array, progress: RecordingProgress): Promise<void>;
  stop(id: string, details: RecordingProgress & { upload: boolean }): Promise<HearingRecording>;
  /** Joins the chunks of an interrupted recording, exactly as `stop` would. */
  recover(id: string): Promise<HearingRecording>;
  recording(id: string): Promise<HearingRecording>;
  /** Signs a receipt for audio recorded while the signing key was locked. */
  signRecording(id: string): Promise<HearingRecording>;
  integrity(id: string): Promise<AudioIntegrity>;
  audio(id: string): Promise<Uint8Array>;
  /** `pcm`: 16 kHz mono samples decoded from the original audio by the renderer. */
  transcribe(id: string, pcm: Float32Array, language: TranscriptLanguage): Promise<TranscriptVersion>;
  transcripts(id: string): Promise<TranscriptVersion[]>;
  saveTranscript(id: string, segments: TranscriptSegment[]): Promise<TranscriptVersion>;
  signTranscript(id: string, version: number): Promise<TranscriptVersion>;
  summary(id: string, version: number): Promise<HearingSummary>;
  exportPdf(id: string, version: number): Promise<{ pdfPath: string; receiptPath: string; manifestPath: string }>;
  modelStatus(): Promise<{ available: boolean; model: string; sizeMb: number }>;
  onProgress(callback: (progress: { id: string; done: number; total: number }) => void): () => void;
}
