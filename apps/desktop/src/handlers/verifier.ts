import type { CourtPlusApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import { z } from 'zod';
import { canonicalJson, sha256, verifiesSignature, verifyHearingBundle } from '../asr/receipt';

const signing: typeof import('@courtplus/export/signing', { with: { 'resolution-mode': 'import' } }) =
  require('@courtplus/export/signing');
type Bundle = Parameters<CourtPlusApi['verify']>[0];
type Verification = Export.Verification;
type Details = { type: string; keyId?: string; time?: string; hash?: string; sha3_256?: string };
type Result = Verification & { details: Details };
const certificate = 'courtplus-evidence-certificate-v1';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const envelope = z.strictObject({
  payload: z.record(z.string(), z.unknown()),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
const evidenceReceipt = z.object({
  id: z.uuid(), sha256: digest, receivedAt: z.iso.datetime(),
  mode: z.enum(['identified', 'anonymous']), caseRef: z.string(), size: z.number().int().nonnegative(), mime: z.string(),
  keyId: digest.optional(),
});
const certificateReceipt = z.object({
  kind: z.literal(certificate), keyId: digest, sha256: digest, createdAt: z.iso.datetime(), evidenceId: z.uuid(),
});
const hybridEvidence = evidenceReceipt.extend({
  kind: z.literal(signing.evidenceReceiptV2), keyId: digest, pqKeyId: digest, sha3_256: digest,
}).strict();
const hybridCertificate = certificateReceipt.extend({
  kind: z.literal(signing.evidenceCertificateV2), pqKeyId: digest, sha3_256: digest,
}).strict();
const invalid = { signature: 'invalid', pdf: 'changed', chain: 'not_checked' } as const;
function parse(json: string) {
  try {
    return envelope.safeParse(JSON.parse(json)).data;
  } catch {
    return undefined;
  }
}

function details(type: string, keyId: unknown, time: unknown, hash: unknown): Details {
  return { type, keyId: digest.safeParse(keyId).data, time: z.iso.datetime().safeParse(time).data, hash: digest.safeParse(hash).data };
}

export function signEvidenceCertificate(pdf: Uint8Array, evidenceId: string, key: Export.SigningKey) {
  return canonicalJson(signing.signHybrid({
    kind: signing.evidenceCertificateV2, evidenceId, keyId: key.keyId, sha256: sha256(pdf),
    pqKeyId: signing.requirePqKeyId(key),
    sha3_256: signing.sha3_256(pdf), createdAt: new Date().toISOString(),
  }, key));
}

export function readEvidenceReceipt(json: string) {
  return signing.parseHybrid(json, (value): value is z.infer<typeof hybridEvidence> => hybridEvidence.safeParse(value).success);
}

function verifyHybridEvidence(input: Bundle, trustStore: readonly Export.TrustEntry[], isCertificate: boolean): Result {
  const type = isCertificate ? 'Evidence s.63 certificate' : 'Evidence receipt';
  const receipt = isCertificate
    ? signing.parseHybrid(input.receipt, (value): value is z.infer<typeof hybridCertificate> => hybridCertificate.safeParse(value).success)
    : readEvidenceReceipt(input.receipt);
  if (!receipt) return { ...invalid, details: { type } };
  const { payload } = receipt;
  const info = details(type, payload.keyId, 'receivedAt' in payload ? payload.receivedAt : payload.createdAt, payload.sha256);
  const key = trustStore.find(entry => entry.keyId === payload.keyId);
  if (!key) {
    const complete = signing.hasHybridSignatures(receipt);
    return { ...invalid, signature: complete ? 'unknown_signer' : 'invalid', details: info };
  }
  const signatures = signing.verifyHybrid(receipt, key);
  if (!key.pqPublicKey && signing.hasHybridSignatures(receipt)) {
    return { ...invalid, signature: 'unknown_signer', signatures, details: info };
  }
  if (!signatures.ed25519 || !signatures.mldsa65) return { ...invalid, signatures, details: info };
  const hashes = { sha256: payload.sha256, sha3_256: payload.sha3_256 };
  const unchanged = sha256(input.pdf) === hashes.sha256 && signing.sha3_256(input.pdf) === hashes.sha3_256;
  return { signature: 'valid', pdf: unchanged ? 'unchanged' : 'changed', chain: 'not_checked',
    signatures, hashes, details: { ...info, sha3_256: hashes.sha3_256 } };
}

export async function verifyBundle(
  input: Bundle,
  exports: Pick<typeof Export, 'verify'>,
  trustStore: readonly Export.TrustEntry[],
  remote: (envelopes: Omit<Bundle, 'pdf'> & { pdfDigest: string; pdfSha3_256?: string }) => Promise<Verification | undefined>,
): Promise<Result> {
  const kind = signing.signedPayloadKind(input.receipt);
  if (kind === signing.evidenceReceiptV2 || kind === signing.evidenceCertificateV2) {
    return verifyHybridEvidence(input, trustStore, kind === signing.evidenceCertificateV2);
  }
  if (kind === 'courtplus-receipt-v2') {
    let result = exports.verify({ ...input, trustStore });
    if (result.signature === 'unknown_signer') {
      const { pdf, ...envelopes } = input;
      result = await remote({ ...envelopes, pdfDigest: sha256(pdf), pdfSha3_256: signing.sha3_256(pdf) }) ?? result;
    }
    const parsePayload = (value: unknown): value is Record<string, unknown> => envelope.shape.payload.safeParse(value).success;
    const payload = signing.parseHybrid(input.receipt, parsePayload)?.payload;
    const type = payload?.ruleVersion === 'lawyer-tools-v1' ? 'Settlement / case analysis PDF' : 'Draft PDF';
    return { ...result, details: {
      ...details(type, payload?.keyId, payload?.createdAt, result.hashes?.sha256), sha3_256: result.hashes?.sha3_256,
    } };
  }
  const receipt = parse(input.receipt);
  const manifest = parse(input.manifest);
  if (!receipt) return { ...invalid, details: { type: 'Unrecognized bundle' } };
  const { payload } = receipt;
  if (payload.kind === 'courtplus-hearing-receipt-v1') {
    const result = verifyHearingBundle({ ...input, trustStore });
    return { ...result, chain: 'not_checked', details: details('Hearing PDF', payload.keyId, payload.createdAt, manifest?.payload.pdfSha256) };
  }
  if (payload.kind === 'courtplus-receipt-v1') {
    let result = exports.verify({ ...input, trustStore });
    const { pdf, ...envelopes } = input;
    if (result.signature === 'unknown_signer') result = await remote({ ...envelopes, pdfDigest: sha256(pdf) }) ?? result;
    // Existing lawyer exports sign the same ruleVersion for settlement and case analysis.
    const type = payload.ruleVersion === 'lawyer-tools-v1' ? 'Settlement / case analysis PDF' : 'Draft PDF';
    return { ...result, details: details(type, payload.keyId, payload.createdAt, manifest?.payload.pdfDigest) };
  }
  const isCertificate = payload.kind === certificate;
  const type = isCertificate ? 'Evidence s.63 certificate' : 'Evidence receipt';
  if (!isCertificate && payload.kind !== undefined) return { ...invalid, details: { type: 'Unrecognized bundle' } };
  const parsed = isCertificate ? certificateReceipt.safeParse(payload).data : evidenceReceipt.safeParse(payload).data;
  if (!parsed) return { ...invalid, details: { type: isCertificate ? type : 'Unrecognized bundle' } };
  const candidates = parsed.keyId ? trustStore.filter(key => key.keyId === parsed.keyId) : trustStore;
  const key = candidates.find(entry => verifiesSignature(receipt, entry));
  const info = details(type, key?.keyId ?? parsed.keyId, isCertificate ? payload.createdAt : payload.receivedAt, parsed.sha256);
  if (!key) return { ...invalid, signature: candidates.length > 0 && parsed.keyId ? 'invalid' : 'unknown_signer', details: info };
  return { signature: 'valid', pdf: sha256(input.pdf) === parsed.sha256 ? 'unchanged' : 'changed', chain: 'not_checked', details: info };
}
