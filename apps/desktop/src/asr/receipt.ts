import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import canonicalize from 'canonicalize';
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };

/**
 * Hearing receipts use the same envelope as draft receipts (`{ payload, signature }`, RFC 8785 JSON,
 * Ed25519 by the office signing key, key ID = SHA-256 of the SPKI public key). Only the payload kind
 * differs, because a hearing has no screening result to sign.
 */
export interface HearingReceipt {
  kind: 'courtplus-hearing-receipt-v1';
  receiptId: string;
  issuer: string;
  keyId: string;
  subject: 'audio' | 'transcript' | 'export';
  recordingId: string;
  caseId: string;
  audioSha256: string;
  audioBytes?: number;
  durationMs?: number;
  mime?: string;
  startedAt?: string;
  stoppedAt?: string;
  markersSha256?: string;
  transcriptVersion?: number;
  textSha256?: string;
  parentTextSha256?: string;
  summarySha256?: string;
  createdAt: string;
}

export interface HearingManifest { kind: 'courtplus-hearing-manifest-v1'; keyId: string; receiptSha256: string; pdfSha256: string }

type Envelope<T> = { payload: T; signature: string };
export type ReceiptFields = Omit<HearingReceipt, 'kind' | 'receiptId' | 'keyId' | 'createdAt' | 'issuer'>;

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('Expected a JSON-serializable value');
  return json;
}

export const jsonSha256 = (value: unknown): string => sha256(canonicalJson(value));
const digest = /^[a-f0-9]{64}$/;

export function privateKeyOf(key: Export.SigningKey): KeyObject {
  if (key.status !== 'active') throw new Error('Only an active key may sign');
  const privateKey = createPrivateKey(key.privateKey);
  const publicKey = createPublicKey(key.publicKey);
  if (privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).equals(publicKey)
    || sha256(publicKey.export({ type: 'spki', format: 'der' })) !== key.keyId) {
    throw new Error('Signing key does not match its public key and identifier');
  }
  return privateKey;
}

export function seal<T>(payload: T, key: KeyObject): string {
  return canonicalJson({ payload, signature: sign(null, Buffer.from(canonicalJson(payload)), key).toString('base64url') });
}

export function signHearingReceipt(issuer: string, fields: ReceiptFields, key: Export.SigningKey, now = new Date()) {
  if (!issuer.trim()) throw new Error('Set the issuing office in Settings before signing.');
  if (!digest.test(fields.audioSha256)) throw new Error('A hearing receipt needs the audio SHA-256.');
  const payload: HearingReceipt = {
    kind: 'courtplus-hearing-receipt-v1', receiptId: randomUUID(), issuer, keyId: key.keyId, ...fields,
    createdAt: now.toISOString(),
  };
  const receipt = seal(payload, privateKeyOf(key));
  return { receipt, receiptId: payload.receiptId, receiptDigest: sha256(receipt), payload };
}

export function createHearingManifest(pdf: Uint8Array, receipt: string, key: Export.SigningKey): string {
  if (pdf.byteLength === 0) throw new Error('Cannot sign empty PDF bytes');
  const parsed = parse<HearingReceipt>(receipt, 'courtplus-hearing-receipt-v1');
  if (!parsed || parsed.payload.keyId !== key.keyId) throw new Error('The receipt must be signed by the manifest key');
  return seal<HearingManifest>({
    kind: 'courtplus-hearing-manifest-v1', keyId: key.keyId, receiptSha256: jsonSha256(parsed), pdfSha256: sha256(pdf),
  }, privateKeyOf(key));
}

function parse<T extends { kind: string; keyId: string }>(json: string, kind: T['kind']): Envelope<T> | undefined {
  try {
    const value = JSON.parse(json) as Partial<Envelope<T>> | null;
    if (value && typeof value === 'object' && Object.keys(value).length === 2 && typeof value.signature === 'string'
      && value.payload && typeof value.payload === 'object' && value.payload.kind === kind
      && typeof value.payload.keyId === 'string' && digest.test(value.payload.keyId)) {
      return { payload: value.payload, signature: value.signature };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return undefined;
}

function signedBy<T extends { keyId: string }>(envelope: Envelope<T>, trustStore: readonly Export.TrustEntry[]) {
  const entry = trustStore.find(item => item.keyId === envelope.payload.keyId);
  if (!entry) return 'unknown_signer' as const;
  return verifiesSignature(envelope, entry) ? 'valid' as const : 'invalid' as const;
}

export function verifiesSignature(envelope: Envelope<unknown>, entry: Export.TrustEntry) {
  try {
    const publicKey = createPublicKey(entry.publicKey);
    const signature = Buffer.from(envelope.signature, 'base64url');
    return publicKey.asymmetricKeyType === 'ed25519'
      && sha256(publicKey.export({ type: 'spki', format: 'der' })) === entry.keyId
      && signature.toString('base64url') === envelope.signature
      && verify(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, signature);
  } catch {
    return false;
  }
}

/** Returns the payload only when a trusted key signed it. */
export function verifyHearingReceipt(receipt: string, trustStore: readonly Export.TrustEntry[]): HearingReceipt | undefined {
  const parsed = parse<HearingReceipt>(receipt, 'courtplus-hearing-receipt-v1');
  return parsed && signedBy(parsed, trustStore) === 'valid' ? parsed.payload : undefined;
}

export function verifyHearingBundle(input: { pdf: Uint8Array; receipt: string; manifest: string; trustStore: readonly Export.TrustEntry[] }) {
  const receipt = parse<HearingReceipt>(input.receipt, 'courtplus-hearing-receipt-v1');
  const manifest = parse<HearingManifest>(input.manifest, 'courtplus-hearing-manifest-v1');
  if (!receipt || receipt.payload.subject !== 'export' || !manifest || receipt.payload.keyId !== manifest.payload.keyId
    || typeof manifest.payload.pdfSha256 !== 'string' || !digest.test(manifest.payload.pdfSha256)
    || manifest.payload.receiptSha256 !== jsonSha256(receipt)) return { signature: 'invalid', pdf: 'changed' } as const;
  const receiptSignature = signedBy(receipt, input.trustStore);
  const signature = receiptSignature === 'valid' ? signedBy(manifest, input.trustStore) : receiptSignature;
  if (signature !== 'valid') return { signature, pdf: 'changed' } as const;
  return { signature, pdf: manifest.payload.pdfSha256 === sha256(input.pdf) ? 'unchanged' : 'changed' } as const;
}
