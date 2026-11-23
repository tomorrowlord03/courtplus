import type { CaseRecord, HearingApi, SpeakerRole } from '@courtplus/contracts';

declare global {
  interface Window { courtplusHearing?: HearingApi }
}

/** The recorder exists only in the desktop app. */
export function hearingBridge(): HearingApi | undefined {
  return typeof window === 'undefined' ? undefined : window.courtplusHearing;
}

export const speakerOptions: [SpeakerRole, string][] = [
  ['judge', 'Judge'], ['petitioner_counsel', 'Petitioner counsel'], ['respondent_counsel', 'Respondent counsel'], ['witness', 'Witness'],
];
export const speakerName = (role?: SpeakerRole) => speakerOptions.find(([value]) => value === role)?.[1] ?? '—';

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return (parts[0] ? [parts[0], parts[1], parts[2]] : [parts[1], parts[2]]).map(part => String(part).padStart(2, '0')).join(':');
}

export const caseLabel = (record?: CaseRecord, fallback = '') =>
  record ? [record.caseNo, record.cnr, record.court].filter(Boolean).join(' · ') || record.id : fallback;

/** Decodes the recorded audio to 16 kHz mono, the input the speech model expects. */
export async function decodeTo16k(bytes: Uint8Array): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, 16_000);
  const buffer = await context.decodeAudioData(bytes.slice().buffer);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
  }
  return mono;
}

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };

/** Word-level difference between the machine text and the edited text (longest common subsequence). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], word: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += ' ' + word;
    else parts.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i]); i += 1; j += 1; }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) { push('removed', a[i]); i += 1; }
    else { push('added', b[j]); j += 1; }
  }
  return parts;
}
