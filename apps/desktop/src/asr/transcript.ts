import type {
  SegmentEdit, SpeakerMarker, TranscriptLanguage, TranscriptSegment, TranscriptVersion,
} from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { jsonSha256 } from './receipt';

export interface RawSegment { startMs: number; endMs: number; text: string }

/** Canonical form that the text hash covers: id, times, speaker and text of every segment. */
export function transcriptSha256(segments: readonly TranscriptSegment[]): string {
  return jsonSha256(segments.map(({ id, startMs, endMs, text, speaker }) => ({ id, startMs, endMs, text, ...(speaker && { speaker }) })));
}

/**
 * Labels each segment with the clerk's most recent marker at or before the segment's midpoint.
 * Segments before the first marker stay unlabelled. Nothing is inferred from the voice itself.
 */
export function assignSpeakers(segments: readonly RawSegment[], markers: readonly SpeakerMarker[]): TranscriptSegment[] {
  const sorted = [...markers].sort((a, b) => a.atMs - b.atMs);
  return segments.map((segment, index) => {
    const middle = (segment.startMs + segment.endMs) / 2;
    const marker = sorted.filter(item => item.atMs <= middle).at(-1);
    return { id: index + 1, startMs: segment.startMs, endMs: segment.endMs, text: segment.text, ...(marker && { speaker: marker.speaker }) };
  });
}

export function machineVersion(input: {
  recordingId: string; audioSha256: string; segments: readonly RawSegment[]; markers: readonly SpeakerMarker[];
  model: string; language: TranscriptLanguage; now?: Date;
}): TranscriptVersion {
  const segments = assignSpeakers(input.segments.map(segment => ({ ...segment, text: segment.text.trim() }))
    .filter(segment => segment.text), input.markers);
  return {
    version: 1, kind: 'machine', recordingId: input.recordingId, audioSha256: input.audioSha256,
    textSha256: transcriptSha256(segments), segments, edits: [], createdAt: (input.now ?? new Date()).toISOString(),
    model: input.model, language: input.language,
  };
}

/**
 * The next version after `latest`, or `undefined` when nothing changed. Only text and speaker can be
 * edited; segment IDs and times must match the machine transcript so every line stays tied to the audio.
 */
export function editedVersion(
  machine: TranscriptVersion, latest: TranscriptVersion, segments: readonly TranscriptSegment[], now = new Date(),
): TranscriptVersion | undefined {
  if (segments.length !== machine.segments.length) throw new Error('A transcript edit must keep every segment.');
  const cleaned = segments.map((segment, index) => {
    const original = machine.segments[index];
    if (segment.id !== original.id || segment.startMs !== original.startMs || segment.endMs !== original.endMs) {
      throw new Error('Segment ' + original.id + ' must keep its time stamps.');
    }
    return { ...original, text: segment.text.replace(/\s+/g, ' ').trim(), speaker: segment.speaker };
  }).map(({ speaker, ...segment }) => ({ ...segment, ...(speaker && { speaker }) }));
  const textSha256 = transcriptSha256(cleaned);
  if (textSha256 === latest.textSha256) return undefined;
  const edits: SegmentEdit[] = cleaned.flatMap((segment, index) => segment.text === machine.segments[index].text ? []
    : [{ segmentId: segment.id, machine: machine.segments[index].text, edited: segment.text }]);
  return {
    version: latest.version + 1, kind: 'edited', recordingId: machine.recordingId, audioSha256: machine.audioSha256,
    parentVersion: latest.version, parentTextSha256: latest.textSha256, textSha256, segments: cleaned, edits,
    createdAt: now.toISOString(), model: machine.model, language: machine.language,
  };
}

/** Checks that a stored chain of versions is unbroken and that every hash matches its text. */
export function checkVersions(versions: readonly TranscriptVersion[]): boolean {
  return versions.every((version, index) => {
    const parent = versions[index - 1];
    return version.version === index + 1 && version.textSha256 === transcriptSha256(version.segments)
      && version.audioSha256 === versions[0].audioSha256
      && (index === 0 ? version.kind === 'machine' && version.parentVersion === undefined
        : version.kind === 'edited' && version.parentVersion === parent.version && version.parentTextSha256 === parent.textSha256);
  });
}
