import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CaseRecord, CourtPlusApi, TranscriptVersion } from '@courtplus/contracts';
import type { HearingBridge } from '../screens/hearing-tools';
import { AppProvider } from '../lib/context';
import { HearingRecorder } from '../screens/HearingRecorder';
import { HearingTranscript } from '../screens/HearingTranscript';
import { clock, wordDiff } from '../screens/hearing-tools';

vi.mock('../../../../data/i18n/hi.json', () => ({ default: { _meta: { reviewed: false } } }));

// Fictional fixtures only.
const fictionalCase: CaseRecord = { id: 'fictional-case', personId: 'p', caseNo: 'FICTIONAL 7/2026', charges: [], custody: [], events: [], pendingStatus: 'trial' };
const api = { listCases: vi.fn(async () => [fictionalCase]), role: vi.fn(async () => 'utrc') } as unknown as CourtPlusApi;
const hash = 'a'.repeat(64);
const machine: TranscriptVersion = {
  version: 1, kind: 'machine', recordingId: 'r1', audioSha256: hash, textSha256: 'b'.repeat(64), edits: [], createdAt: '2026-11-23T05:00:00Z',
  segments: [{ id: 1, startMs: 0, endMs: 4000, text: 'The fictional matter is adjourned.', speaker: 'judge' }],
};

function bridge(overrides: Partial<HearingBridge> = {}): HearingBridge {
  return {
    list: vi.fn(async () => [
      { id: 'r1', caseId: 'fictional-case', startedAt: '2026-11-23T05:00:00Z', state: 'recorded' as const, durationMs: 65_000, signed: true, transcriptVersions: 1 },
      { id: 'r2', caseId: 'fictional-case', startedAt: '2026-11-23T04:00:00Z', state: 'interrupted' as const, transcriptVersions: 0 },
    ]),
    recover: vi.fn(async () => ({ id: 'r2', caseId: 'fictional-case', startedAt: '', stoppedAt: '', durationMs: 5000, mime: 'audio/webm', audioBytes: 1, audioSha256: hash, markers: [], auditHash: hash, recovered: true })),
    recording: vi.fn(async () => ({ id: 'r1', caseId: 'fictional-case', startedAt: '', stoppedAt: '', durationMs: 4000, mime: 'audio/webm', audioBytes: 1, audioSha256: hash, markers: [], auditHash: hash, receipt: '{}' })),
    integrity: vi.fn(async () => ({ audioSha256: hash, unchanged: true, readOnly: true })),
    transcripts: vi.fn(async () => [machine]),
    modelStatus: vi.fn(async () => ({ available: true, model: 'whisper-small q8', sizeMb: 251.8 })),
    audio: vi.fn(async () => new Uint8Array([1, 2, 3])),
    onProgress: vi.fn(() => () => undefined),
    saveTranscript: vi.fn(async (_id, segments) => ({ ...machine, version: 2, kind: 'edited' as const, segments })),
    signTranscript: vi.fn(async () => ({ ...machine, receipt: '{}' })),
    summary: vi.fn(async () => ({ label: 'Machine summary - verify before use' as const, method: 'TextRank', basedOnVersion: 1,
      sentences: [{ text: 'The fictional matter is adjourned.', segmentId: 1, startMs: 0, keywords: ['adjourned'], score: 1 }] })),
    ...overrides,
  } as HearingBridge;
}

function renderAt(path: string) {
  render(<AppProvider api={api}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/hearings" element={<HearingRecorder />} />
    <Route path="/hearings/:id" element={<HearingTranscript />} />
  </Routes></MemoryRouter></AppProvider>);
}

afterEach(() => { delete window.courtplusHearing; localStorage.removeItem('courtplus.uiLanguage'); });

describe('hearing recorder screens', () => {
  it('explains that recording needs the desktop app when no recorder bridge exists', () => {
    renderAt('/hearings');
    expect(screen.getByText('Recording hearings works in the Court+ desktop app.')).toBeInTheDocument();
  });

  it('lists recordings, offers recovery for interrupted ones and keeps markers disabled until recording', async () => {
    window.courtplusHearing = bridge();
    renderAt('/hearings');
    expect(await screen.findByRole('option', { name: 'FICTIONAL 7/2026' })).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Recorded hearings' });
    expect(await within(table).findByText('Sealed and signed · 1 transcript version(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Judge' })).toBeDisabled();
    await userEvent.click(within(table).getByRole('button', { name: 'Recover' }));
    expect(window.courtplusHearing.recover).toHaveBeenCalledWith('r2');
    expect(await screen.findByText('Recording sealed')).toBeInTheDocument();
  });

  it('shows integrity, tracks edits as a diff, and labels the machine summary', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fictional');
    URL.revokeObjectURL = vi.fn();
    const hearing = bridge();
    window.courtplusHearing = hearing;
    renderAt('/hearings/r1');
    expect(await screen.findByText(/Original audio unchanged since recording · read-only/)).toBeInTheDocument();
    const text = await screen.findByRole('textbox', { name: 'Text of segment 1' });
    await userEvent.clear(text);
    await userEvent.type(text, 'The fictional matter is adjourned to Monday.');
    expect(screen.getByLabelText('Changes in segment 1')).toHaveTextContent('Machine: The fictional matter is adjourned. adjourned to Monday.');
    expect(screen.getByRole('button', { name: 'Export signed PDF' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save as new version' }));
    expect(hearing.saveTranscript).toHaveBeenCalledWith('r1', [expect.objectContaining({ text: 'The fictional matter is adjourned to Monday.' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Summarise' }));
    const summary = await screen.findByRole('region', { name: 'Hearing summary' });
    expect(summary).toHaveTextContent('Machine summary - verify before use. Hint - the judge decides.');
  });

  it('shows the Hindi editor and the original transcript text together', async () => {
    localStorage.setItem('courtplus.uiLanguage', 'hi');
    window.courtplusHearing = bridge();
    renderAt('/hearings/r1');
    expect(screen.getByRole('heading', { name: 'सुनवाई का प्रतिलेख' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'खंड का पाठ 1' })).toHaveValue(machine.segments[0].text);
  });

  it('formats clock times and word differences', () => {
    expect(clock(65_000)).toBe('01:05');
    expect(clock(3_726_000)).toBe('01:02:06');
    expect(wordDiff('next date is Monday', 'next date is Tuesday')).toEqual([
      { kind: 'same', text: 'next date is' }, { kind: 'removed', text: 'Monday' }, { kind: 'added', text: 'Tuesday' },
    ]);
  });
});
