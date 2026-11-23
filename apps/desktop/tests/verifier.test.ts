import type { ScreeningResult } from '@courtplus/contracts';
import * as exports from '@courtplus/export';
import { evidenceReceiptV2, requirePqKeyId, sha3_256, signHybrid } from '@courtplus/export/signing';
import { describe, expect, it, vi } from 'vitest';
import { createHearingManifest, privateKeyOf, seal, sha256, signHearingReceipt } from '../src/asr/receipt';
import { signEvidenceCertificate, verifyBundle } from '../src/handlers/verifier';

const issuer = 'Fictional Court for Test Fixtures';
const key = exports.generateKeyPair(issuer);
const trusted = [exports.exportPublicKey(key)];
const time = new Date('2026-01-02T03:04:05.000Z');
const bytes = Buffer.from('%PDF fictional document');
const evidenceId = 'a0000000-0000-4000-8000-000000000001';
const result: ScreeningResult = {
  personId: 'fictional-person', caseId: 'fictional-case', asOf: '2026-01-02', ruleVersion: 'fictional-draft-v1',
  dayConvention: 'Asia/Kolkata civil date', status: 'OUTSIDE_SCREEN', rawCustodyDays: 0, countedCustodyDays: 0,
  ceilingUrgent: false, reasons: [], alerts: [], nalsaCategories: [], trace: [],
};

function draft(ruleVersion: string, kind: string) {
  const { receipt } = exports.createReceipt({ issuer, result: { ...result, ruleVersion }, inputs: { kind }, createdAt: time }, key);
  return { receipt, manifest: exports.createManifest(bytes, receipt, key) };
}

const hearing = signHearingReceipt(issuer, {
  subject: 'export', recordingId: 'fictional-recording', caseId: result.caseId, audioSha256: sha256('fictional hearing'),
}, key, time);
const evidenceReceipt = seal({
  id: evidenceId, mode: 'identified', caseRef: result.caseId, receivedAt: time.toISOString(),
  sha256: sha256(bytes), mime: 'application/pdf', size: bytes.length,
}, privateKeyOf(key));
const certificateReceipt = signEvidenceCertificate(bytes, evidenceId, key);
const hybridEvidenceReceipt = JSON.stringify(signHybrid({
  ...JSON.parse(evidenceReceipt).payload, kind: evidenceReceiptV2, sha3_256: sha3_256(bytes), keyId: key.keyId,
  pqKeyId: requirePqKeyId(key),
}, key));

describe('offline verification', () => {
  it.each([
    ['Draft PDF', draft(result.ruleVersion, 'draft')],
    ['Settlement / case analysis PDF', draft('lawyer-tools-v1', 'settlement')],
    ['Settlement / case analysis PDF', draft('lawyer-tools-v1', 'analysis')],
    ['Hearing PDF', { receipt: hearing.receipt, manifest: createHearingManifest(bytes, hearing.receipt, key) }],
    ['Evidence s.63 certificate', { receipt: certificateReceipt, manifest: '{}' }],
    ['Evidence receipt', { receipt: evidenceReceipt, manifest: '{}' }],
    ['Evidence receipt', { receipt: hybridEvidenceReceipt, manifest: '{}' }],
  ] as const)('checks signatures and original bytes for %s', async (type, files) => {
    const remote = async () => undefined;
    const bundle = { pdf: bytes, ...files };
    const checked = await verifyBundle(bundle, exports, trusted, remote);
    expect(checked).toMatchObject({
      signature: 'valid', pdf: 'unchanged', chain: 'not_checked', details: { type, keyId: key.keyId, hash: sha256(bytes) },
    });
    expect(checked.details.time).toBe(type === 'Evidence s.63 certificate'
      ? JSON.parse(certificateReceipt).payload.createdAt : time.toISOString());
    expect(await verifyBundle({ ...bundle, pdf: Buffer.from('changed') }, exports, trusted, remote)).toMatchObject({
      signature: 'valid', pdf: 'changed',
    });
    expect((await verifyBundle(bundle, exports, [], remote)).signature).toBe('unknown_signer');
    const changed = JSON.parse(files.receipt);
    if (changed.signatures) {
      expect(checked).toMatchObject({
        signatures: { ed25519: true, mldsa65: true }, details: { sha3_256: sha3_256(bytes) },
      });
      delete changed.signatures.mldsa65;
    } else {
      changed.signature = (changed.signature.startsWith('A') ? 'B' : 'A') + changed.signature.slice(1);
    }
    const tampered = await verifyBundle({ ...bundle, receipt: JSON.stringify(changed) }, exports, trusted, remote);
    expect(tampered.signature).not.toBe('valid');
  });

  it('rejects mixing signed receipt and manifest files', async () => {
    const bundle = { pdf: bytes, ...draft(result.ruleVersion, 'draft') };
    const another = draft(result.ruleVersion, 'draft');
    expect(await verifyBundle({ ...bundle, manifest: another.manifest }, exports, trusted, async () => undefined))
      .toMatchObject({ signature: 'invalid' });
  });
});

it('falls back to remote verification of an unknown v2 draft with both PDF digests', async () => {
  const envelopes = draft(result.ruleVersion, 'draft');
  const hashes = { sha256: sha256(bytes), sha3_256: sha3_256(bytes) };
  const remoteResult = {
    signature: 'valid', pdf: 'unchanged', chain: 'not_checked',
    signatures: { ed25519: true, mldsa65: true }, hashes,
  } as const;
  const remote = vi.fn(async () => remoteResult);
  expect(await verifyBundle({ pdf: bytes, ...envelopes }, exports, [], remote)).toEqual({
    ...remoteResult, details: { type: 'Draft PDF', keyId: key.keyId, time: time.toISOString(), hash: hashes.sha256, sha3_256: hashes.sha3_256 },
  });
  expect(remote).toHaveBeenCalledExactlyOnceWith({ ...envelopes, pdfDigest: hashes.sha256, pdfSha3_256: hashes.sha3_256 });
});
