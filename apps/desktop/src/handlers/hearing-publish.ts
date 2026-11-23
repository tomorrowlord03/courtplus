import { createPrivateKey, sign } from 'node:crypto';
import { join } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { HearingApi, HearingPublicationPayload, SignedHearingPublication } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { canonicalJson, jsonSha256 } from '../asr/receipt';
import type { Store } from '../store';
import { readProfile, readSettings } from './settings';

const args = z.tuple([z.uuid(), z.string().trim().min(20).max(10_000), z.literal(true)]);

export function registerHearingPublish(ipcMain: IpcMain, isTrusted: (event: IpcMainInvokeEvent, method: string) => boolean,
  store: Store, hearing: Pick<HearingApi, 'recording' | 'transcripts'>,
  signer: { key(label: string): { keyId: string; publicKey: string; privateKey: string } },
  token: () => string | undefined, resourceDirectory: string) {
  ipcMain.handle('hearing:publishSummary', async (event, ...values: unknown[]) => {
    if (!isTrusted(event, 'hearing:publishSummary')) throw new Error('FORBIDDEN');
    const [id, summary] = args.parse(values);
    if (readProfile(store)?.role !== 'judge') throw new Error('Only a judge can publish a hearing summary.');
    const sessionToken = token();
    const { backendUrl, issuer } = readSettings(store);
    if (!sessionToken || !backendUrl) throw new Error('Sign in to the configured court backend first.');
    const recording = await hearing.recording(id);
    const versions = await hearing.transcripts(id);
    if (!versions.some(version => version.receipt)) throw new Error('Sign the transcript before publishing a summary.');
    const record = store.listCases().find(item => item.id === recording.caseId);
    const caseRef = record?.cnr ?? record?.caseNo ?? record?.id;
    if (!caseRef) throw new Error('A saved case reference is required.');
    const hearingDate = recording.startedAt.slice(0, 10);
    const nextDate = record?.events.filter(item => item.kind === 'hearing' && item.on > hearingDate)
      .sort((a, b) => a.on.localeCompare(b.on))[0]?.on ?? null;
    const { anonymise, runNer } = await import('@courtplus/intake');
    const entities = await runNer(summary, join(resourceDirectory, 'model')).catch(() => []);
    const payload: HearingPublicationPayload = {
      kind: 'courtplus-hearing-summary-v1', caseRef, recordingId: id, hearingDate, nextDate,
      summary: anonymise(summary, entities).text, approvedAt: new Date().toISOString(),
    };
    const key = signer.key(issuer);
    const signed: SignedHearingPublication = {
      payload, hash: jsonSha256(payload), keyId: key.keyId, publicKey: key.publicKey,
      signature: sign(null, Buffer.from(canonicalJson(payload)), createPrivateKey(key.privateKey)).toString('base64url'),
    };
    const response = await fetch(backendUrl + '/api/hearings/summary', {
      method: 'POST', headers: { authorization: 'Bearer ' + sessionToken, 'content-type': 'application/json' },
      body: JSON.stringify(signed), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Court backend rejected the summary (' + response.status + ').');
    store.audit('hearing.summary.publish', { recordingId: id, caseRef, hash: signed.hash });
    return { published: true };
  });
}
