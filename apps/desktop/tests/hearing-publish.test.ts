import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { canonicalJson } from '../src/asr/receipt';
import { registerHearingPublish } from '../src/handlers/hearing-publish';

const profile = vi.hoisted(() => ({ role: 'judge' as string }));
vi.mock('../src/handlers/settings', () => ({
  readProfile: () => ({ role: profile.role }),
  readSettings: () => ({ backendUrl: 'https://fictional-court.test', issuer: 'Fictional Court' }),
}));
vi.mock('@courtplus/intake', () => ({
  runNer: vi.fn(async () => []),
  anonymise: (text: string) => ({ text: text.replace('Fictional Private Name', '[Person]') }),
}));

describe('judge hearing publication', () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const recordingId = '55555555-5555-4555-8555-555555555555';
  const audit = vi.fn();
  const fetch = vi.fn(async () => new Response('{}', { status: 201 }));
  let invoke: (...args: unknown[]) => Promise<unknown>;
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    profile.role = 'judge';
    audit.mockClear(); fetch.mockClear();
    vi.stubGlobal('fetch', fetch);
    const ipc = { handle: (_channel: string, handler: (...args: unknown[]) => Promise<unknown>) => { invoke = handler; } };
    const store = { listCases: () => [{ id: 'c123', cnr: 'FICTIONAL-123', events: [{ kind: 'hearing', on: '2026-12-01' }] }], audit };
    const hearing = {
      recording: async () => ({ id: recordingId, caseId: 'c123', startedAt: '2026-11-20T08:00:00.000Z' }),
      transcripts: async () => [{ receipt: 'fictional signed receipt' }],
    };
    registerHearingPublish(
      ipc as unknown as IpcMain, () => true,
      store as unknown as Parameters<typeof registerHearingPublish>[2],
      hearing as unknown as Parameters<typeof registerHearingPublish>[3],
      { key: () => ({ keyId, publicKey, privateKey }) }, () => 'fictional-token', 'fictional-model-dir',
    );
  });

  test('sends only masked approved text and dates under a verifiable signature', async () => {
    await invoke({}, recordingId, 'Fictional Private Name attended the hearing today.', true);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://fictional-court.test/api/hearings/summary');
    const signed = JSON.parse(String(options.body)) as {
      payload: Record<string, unknown>; hash: string; signature: string; publicKey: string;
    };
    expect(signed.payload).toMatchObject({ caseRef: 'FICTIONAL-123', hearingDate: '2026-11-20',
      nextDate: '2026-12-01', summary: '[Person] attended the hearing today.' });
    expect(JSON.stringify(signed)).not.toContain('Fictional Private Name');
    expect(JSON.stringify(signed)).not.toContain('audio');
    expect(verify(null, Buffer.from(canonicalJson(signed.payload)), keys.publicKey,
      Buffer.from(signed.signature, 'base64url'))).toBe(true);
    expect(audit).toHaveBeenCalledOnce();
  });

  test('refuses publication by a non-judge profile', async () => {
    profile.role = 'lawyer';
    await expect(invoke({}, recordingId, 'A long fictional summary of this hearing.', true)).rejects.toThrow('Only a judge');
    expect(fetch).not.toHaveBeenCalled();
  });
});
