import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import canonicalize from 'canonicalize';
import { sha3_256 as nobleSha3 } from '@noble/hashes/sha3.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { CourtPlusApi, ISODate, ScreeningResult, Status } from '@courtplus/contracts';

const mlDsa65Lengths = { publicKey: 1952, secretKey: 4032, signature: 3309 };

export interface TrustEntry {
  keyId: string;
  publicKey: string;
  pqPublicKey?: string;
  pqKeyId?: string;
  binding?: HybridSigned<KeyBinding>;
  status: 'active' | 'retired';
  label: string;
}

export interface SigningKey extends TrustEntry {
  privateKey: string;
  pqPrivateKey?: string;
}

type MaybePromise<T> = T | Promise<T>;

export interface KeyStorage {
  load(keyId: string): MaybePromise<SigningKey | undefined>;
  save(key: SigningKey): MaybePromise<void>;
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha3_256(value: Uint8Array | string): string {
  return Buffer.from(nobleSha3(typeof value === 'string' ? Buffer.from(value) : value)).toString('hex');
}

export function generatePqKeyPair(seed?: Uint8Array) {
  const { publicKey, secretKey } = ml_dsa65.keygen(seed);
  return {
    pqPublicKey: Buffer.from(publicKey).toString('base64'),
    pqPrivateKey: Buffer.from(secretKey).toString('base64'),
    pqKeyId: sha256(publicKey),
  };
}

export function requirePqKeyId(key: Pick<TrustEntry, 'pqPublicKey'>): string {
  const publicKey = decodeKey(key.pqPublicKey, mlDsa65Lengths.publicKey);
  if (!publicKey) throw new Error('ML-DSA-65 signing key is missing or malformed');
  return sha256(publicKey);
}

export function upgradeSigningKey(key: SigningKey): SigningKey {
  if (key.pqPublicKey && key.pqPrivateKey) {
    const pqKeyId = requirePqKeyId(key);
    return key.pqKeyId === pqKeyId ? key : { ...key, pqKeyId };
  }
  if (key.pqPublicKey || key.pqPrivateKey) throw new Error('Incomplete ML-DSA-65 signing key');
  return { ...key, ...generatePqKeyPair() };
}

function keyFingerprint(publicKey: KeyObject): string {
  return sha256(publicKey.export({ type: 'spki', format: 'der' }));
}

export function generateKeyPair(label: string): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    keyId: keyFingerprint(publicKey),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ...generatePqKeyPair(),
    status: 'active',
    label,
  };
}

export function exportPublicKey({ keyId, publicKey, pqPublicKey, status, label }: TrustEntry): TrustEntry {
  return { keyId, publicKey, ...(pqPublicKey && { pqPublicKey, pqKeyId: requirePqKeyId({ pqPublicKey }) }), status, label };
}

type KeyBinding = { kind: 'courtplus-key-binding-v1'; keyId: string; pqKeyId: string };
const bindingError = 'The ML-DSA-65 key is not bound to this Ed25519 key';

export function keyBinding(key: SigningKey): HybridSigned<KeyBinding> {
  return signHybrid({ kind: 'courtplus-key-binding-v1', keyId: key.keyId, pqKeyId: requirePqKeyId(key) }, key);
}

// The existing PEM file remains usable by Ed25519-only consumers.
export function encodeTrustPem(key: SigningKey | Pick<TrustEntry, 'publicKey' | 'pqPublicKey' | 'binding'>): string {
  if (!key.pqPublicKey) return key.publicKey;
  const binding = key.binding ?? ('privateKey' in key ? keyBinding(key) : undefined);
  if (!binding) throw new Error(bindingError);
  const encoded = Buffer.from(canonicalJson(binding)).toString('base64');
  return [
    key.publicKey.trimEnd(),
    '-----BEGIN ML-DSA-65 PUBLIC KEY-----',
    ...(key.pqPublicKey.match(/.{1,64}/g) ?? []),
    '-----END ML-DSA-65 PUBLIC KEY-----',
    '-----BEGIN COURTPLUS KEY BINDING-----',
    ...(encoded.match(/.{1,64}/g) ?? []),
    '-----END COURTPLUS KEY BINDING-----',
    '',
  ].join('\n');
}

export function decodeTrustPem(pem: string): Omit<TrustEntry, 'label' | 'status'> {
  const match = pem.length <= 12 * 1024 && /^(-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+?-----END PUBLIC KEY-----)([\s\S]*)$/.exec(pem);
  if (!match) throw new Error('Choose an Ed25519 public key in PEM format.');
  const publicKey = createPublicKey(match[1]);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Choose an Ed25519 public key.');
  const entry = {
    keyId: keyFingerprint(publicKey),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  if (!match[2].trim()) return entry;
  const pq = /^\s+-----BEGIN ML-DSA-65 PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END ML-DSA-65 PUBLIC KEY-----([\s\S]*)$/.exec(match[2]);
  if (!pq) throw new Error('Invalid ML-DSA-65 public key');
  const pqPublicKey = pq[1].replace(/[\r\n]/g, '');
  const pqBytes = decodeKey(pqPublicKey, mlDsa65Lengths.publicKey);
  if (!pqBytes) throw new Error('Invalid ML-DSA-65 public key');
  const pqKeyId = sha256(pqBytes);
  const block = /^\s+-----BEGIN COURTPLUS KEY BINDING-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END COURTPLUS KEY BINDING-----\s*$/.exec(pq[2]);
  if (!block) throw new Error(bindingError);
  const encoded = block[1].replace(/[\r\n]/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error(bindingError);
  const binding = parseHybrid(bytes.toString('utf8'), (value): value is KeyBinding =>
    record(value) && Object.keys(value).length === 3 && value.kind === 'courtplus-key-binding-v1'
    && value.keyId === entry.keyId && value.pqKeyId === pqKeyId);
  if (!binding) throw new Error(bindingError);
  const checks = verifyHybrid(binding, { ...entry, pqPublicKey, pqKeyId, status: 'active', label: '' });
  if (!checks.ed25519 || !checks.mldsa65) throw new Error(bindingError);
  return { ...entry, pqPublicKey, pqKeyId, binding };
}

export async function createStoredKey(storage: KeyStorage, label: string): Promise<TrustEntry> {
  const key = generateKeyPair(label);
  await storage.save(key);
  return exportPublicKey(key);
}

export async function retireStoredKey(storage: KeyStorage, keyId: string): Promise<TrustEntry> {
  const key = await storage.load(keyId);
  if (key?.keyId !== keyId) throw new Error('Signing key not found');
  const retired = { ...key, status: 'retired' as const };
  await storage.save(retired);
  return exportPublicKey(retired);
}

function canonicalJson(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error('Expected a JSON-serializable value');
  return json;
}

function jsonDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}

const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export interface Receipt {
  kind: 'courtplus-receipt-v1';
  receiptId: string;
  issuer: string;
  keyId: string;
  ruleVersion: string;
  asOf: ISODate;
  inputsDigest: string;
  result: Status;
  resultDigest: string;
  traceDigest: string;
  createdAt: string;
}

export interface DualHashes {
  sha256: string;
  sha3_256: string;
}

export interface HybridReceipt extends Omit<Receipt, 'kind'> {
  kind: 'courtplus-receipt-v2';
  pqKeyId: string;
  hashes: DualHashes;
}

export interface Manifest {
  kind: 'courtplus-manifest-v1';
  keyId: string;
  receiptDigest: string;
  pdfDigest: string;
}

export interface HybridManifest extends Omit<Manifest, 'kind'> {
  kind: 'courtplus-manifest-v2';
  pqKeyId: string;
  pdfSha3_256: string;
}

export interface Signed<T> {
  payload: T;
  signature: string;
}

export interface HybridSigned<T> {
  payload: T;
  signatures: { ed25519: string; mldsa65: string };
}

export interface SignatureChecks {
  ed25519: boolean;
  mldsa65: boolean;
}

export const evidenceReceiptV2 = 'courtplus-evidence-receipt-v2';
export const evidenceCertificateV2 = 'courtplus-evidence-certificate-v2';

export interface ReceiptInput {
  issuer: string;
  inputs: unknown;
  result: ScreeningResult;
  createdAt?: Date;
}

export interface SignedReceipt {
  receipt: string;
  receiptId: string;
  receiptDigest: string;
}

function signingKey(key: SigningKey) {
  if (key.status !== 'active') throw new Error('Only an active key may sign');
  const privateKey = createPrivateKey(key.privateKey);
  const publicKey = createPublicKey(key.publicKey);
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519'
    || keyFingerprint(publicKey) !== key.keyId || !createPublicKey(privateKey).equals(publicKey)) {
    throw new Error('Signing key does not match its public key and identifier');
  }
  return privateKey;
}

function signJson<T>(payload: T, key: KeyObject): string {
  const signature = sign(null, Buffer.from(canonicalJson(payload)), key).toString('base64url');
  return canonicalJson({ payload, signature } satisfies Signed<T>);
}

function decodeKey(encoded: unknown, length: number): Buffer | undefined {
  if (typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil(length / 3)) return;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === length && bytes.toString('base64') === encoded) return bytes;
}

export function signHybrid<T>(payload: T, key: SigningKey): HybridSigned<T> {
  const edKey = signingKey(key);
  const publicKey = decodeKey(key.pqPublicKey, mlDsa65Lengths.publicKey);
  const secretKey = decodeKey(key.pqPrivateKey, mlDsa65Lengths.secretKey);
  if (!secretKey) throw new Error('ML-DSA-65 signing key is missing or malformed');
  if (!publicKey || !Buffer.from(ml_dsa65.getPublicKey(secretKey)).equals(publicKey)) {
    throw new Error('ML-DSA-65 signing key does not match its public key');
  }
  const bytes = Buffer.from(canonicalJson(payload));
  return {
    payload,
    signatures: {
      ed25519: sign(null, bytes, edKey).toString('base64url'),
      mldsa65: Buffer.from(ml_dsa65.sign(bytes, secretKey)).toString('base64url'),
    },
  };
}

export function parseHybrid<T>(json: string, isPayload: (value: unknown) => value is T): HybridSigned<T> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    if (record(value) && Object.keys(value).length === 2 && isPayload(value.payload)
      && record(value.signatures) && Object.keys(value.signatures).every(key => key === 'ed25519' || key === 'mldsa65')) {
      return {
        payload: value.payload,
        signatures: {
          ed25519: typeof value.signatures.ed25519 === 'string' ? value.signatures.ed25519 : '',
          mldsa65: typeof value.signatures.mldsa65 === 'string' ? value.signatures.mldsa65 : '',
        },
      };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

export function signedPayloadKind(json: string): string | undefined {
  try {
    const value: unknown = JSON.parse(json);
    if (record(value) && record(value.payload) && typeof value.payload.kind === 'string') return value.payload.kind;
  } catch {
    return undefined;
  }
}

function decodeSignature(encoded: string, length: number) {
  if (encoded.length !== Math.ceil(length * 4 / 3)) return;
  const decoded = Buffer.from(encoded, 'base64url');
  if (decoded.length === length && decoded.toString('base64url') === encoded) return decoded;
}

export function hasHybridSignatures(envelope: HybridSigned<unknown>): boolean {
  return !!decodeSignature(envelope.signatures.ed25519, 64)
    && !!decodeSignature(envelope.signatures.mldsa65, mlDsa65Lengths.signature);
}

export function verifyHybrid(envelope: HybridSigned<unknown>, key: TrustEntry): SignatureChecks {
  if (!record(envelope.payload) || !isDigest(envelope.payload.pqKeyId)) return { ed25519: false, mldsa65: false };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(canonicalJson(envelope.payload));
  } catch {
    return { ed25519: false, mldsa65: false };
  }
  const edSig = decodeSignature(envelope.signatures.ed25519, 64);
  const pqSig = decodeSignature(envelope.signatures.mldsa65, mlDsa65Lengths.signature);
  let ed25519 = false;
  let mldsa65 = false;
  try {
    const edKey = createPublicKey(key.publicKey);
    ed25519 = !!edSig && edKey.asymmetricKeyType === 'ed25519' && keyFingerprint(edKey) === key.keyId
      && verifySignature(null, bytes, edKey, edSig);
  } catch {
    // A malformed key is a failed signature.
  }
  try {
    const pqKey = decodeKey(key.pqPublicKey, mlDsa65Lengths.publicKey);
    mldsa65 = !!pqSig && !!pqKey && envelope.payload.pqKeyId === sha256(pqKey)
      && (key.pqKeyId === undefined || key.pqKeyId === envelope.payload.pqKeyId)
      && ml_dsa65.verify(pqSig, bytes, pqKey);
  } catch {
    // A malformed key or signature is a failed signature.
  }
  return { ed25519, mldsa65 };
}

export function createReceipt(input: ReceiptInput, key: SigningKey, options?: { legacy?: boolean }): SignedReceipt {
  const { issuer, inputs, result, createdAt = new Date() } = input;
  if (!issuer.trim()) throw new Error('A receipt needs an issuer');
  const receiptId = randomUUID();
  const fields: Omit<Receipt, 'kind'> = {
    receiptId,
    issuer,
    keyId: key.keyId,
    ruleVersion: result.ruleVersion,
    asOf: result.asOf,
    inputsDigest: jsonDigest(inputs),
    result: result.status,
    resultDigest: jsonDigest(result),
    traceDigest: jsonDigest(result.trace),
    createdAt: createdAt.toISOString(),
  };
  if (options?.legacy) {
    const receipt = signJson<Receipt>({ kind: 'courtplus-receipt-v1', ...fields }, signingKey(key));
    return { receipt, receiptId, receiptDigest: sha256(receipt) };
  }
  if (!key.pqPublicKey || !key.pqPrivateKey) throw new Error('ML-DSA-65 signing key is missing');
  const versioned = { kind: 'courtplus-receipt-v2' as const, ...fields, pqKeyId: requirePqKeyId(key) };
  const canonicalFields = canonicalJson(versioned);
  const payload: HybridReceipt = {
    ...versioned, hashes: { sha256: sha256(canonicalFields), sha3_256: sha3_256(canonicalFields) },
  };
  const receipt = canonicalJson(signHybrid(payload, key));
  return { receipt, receiptId, receiptDigest: sha256(receipt) };
}

export function createManifest(pdf: Uint8Array, receipt: string, key: SigningKey, options?: { legacy?: boolean }): string {
  if (!options?.legacy) {
    if (!key.pqPublicKey || !key.pqPrivateKey) throw new Error('ML-DSA-65 signing key is missing');
    const hybrid = parseHybrid(receipt, isHybridReceipt);
    if (!hybrid) throw new Error('The receipt must be signed by the manifest key');
    const signatures = verifyHybrid(hybrid, key);
    if (hybrid.payload.keyId !== key.keyId || !signatures.ed25519 || !signatures.mldsa65) {
      throw new Error('The receipt must be signed by the manifest key');
    }
    if (pdf.byteLength === 0) throw new Error('Cannot sign empty PDF bytes');
    return canonicalJson(signHybrid<HybridManifest>({
      kind: 'courtplus-manifest-v2',
      keyId: key.keyId,
      pqKeyId: requirePqKeyId(key),
      receiptDigest: jsonDigest(hybrid),
      pdfDigest: sha256(pdf),
      pdfSha3_256: sha3_256(pdf),
    }, key));
  }
  const parsed = parseSigned(receipt, isReceipt);
  const privateKey = signingKey(key);
  if (!parsed || parsed.payload.keyId !== key.keyId || !matchesSignature(parsed, createPublicKey(privateKey))) {
    throw new Error('The receipt must be signed by the manifest key');
  }
  if (pdf.byteLength === 0) throw new Error('Cannot sign empty PDF bytes');
  return signJson<Manifest>({
    kind: 'courtplus-manifest-v1',
    keyId: key.keyId,
    receiptDigest: jsonDigest(parsed),
    pdfDigest: sha256(pdf),
  }, privateKey);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value);
}

const statuses = new Set(['APPLY_NOW', 'DUE_IN_N_DAYS', 'NEEDS_LAWYER_REVIEW', 'OUTSIDE_SCREEN']);

function isReceipt(value: unknown): value is Receipt {
  return record(value) && value.kind === 'courtplus-receipt-v1'
    && typeof value.receiptId === 'string' && idPattern.test(value.receiptId)
    && typeof value.issuer === 'string' && value.issuer.trim().length > 0
    && typeof value.ruleVersion === 'string' && typeof value.asOf === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.result === 'string' && statuses.has(value.result)
    && isDigest(value.keyId) && isDigest(value.inputsDigest)
    && isDigest(value.resultDigest) && isDigest(value.traceDigest);
}

function isHybridReceipt(value: unknown): value is HybridReceipt {
  if (!record(value) || value.kind !== 'courtplus-receipt-v2' || !isDigest(value.pqKeyId)) return false;
  const { hashes, ...fields } = value;
  if (!isReceipt({ ...fields, kind: 'courtplus-receipt-v1' })
    || !record(hashes) || !isDigest(hashes.sha256) || !isDigest(hashes.sha3_256)) return false;
  try {
    const bytes = canonicalJson(fields);
    return hashes.sha256 === sha256(bytes) && hashes.sha3_256 === sha3_256(bytes);
  } catch {
    return false;
  }
}

function isHybridManifest(value: unknown): value is HybridManifest {
  return record(value) && value.kind === 'courtplus-manifest-v2' && isDigest(value.pdfSha3_256)
    && isDigest(value.pqKeyId)
    && isManifest({ ...value, kind: 'courtplus-manifest-v1' });
}

function isManifest(value: unknown): value is Manifest {
  return record(value) && value.kind === 'courtplus-manifest-v1'
    && isDigest(value.keyId) && isDigest(value.receiptDigest) && isDigest(value.pdfDigest);
}

function parseSigned<T>(json: string, isPayload: (value: unknown) => value is T): Signed<T> | undefined {
  try {
    const value: unknown = JSON.parse(json);
    if (record(value) && Object.keys(value).length === 2 && isPayload(value.payload)
      && typeof value.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(value.signature)) {
      return { payload: value.payload, signature: value.signature };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return undefined;
}

function matchesSignature<T>(envelope: Signed<T>, publicKey: KeyObject): boolean {
  const signature = Buffer.from(envelope.signature, 'base64url');
  return signature.toString('base64url') === envelope.signature
    && verifySignature(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, signature);
}

export interface VerifyInput {
  pdf: Uint8Array;
  receipt: string;
  manifest: string;
  trustStore: readonly TrustEntry[];
  anchor?: string;
  auditLogHead?: string;
}

export type Verification = Awaited<ReturnType<CourtPlusApi['verify']>> & {
  signatures?: SignatureChecks;
  hashes?: DualHashes;
  legacy?: boolean;
};

export function verifyHybridDraft(input: Omit<VerifyInput, 'pdf'> & {
  pdfDigest: string;
  pdfSha3_256: string;
}): Verification | undefined {
  if (signedPayloadKind(input.receipt) !== 'courtplus-receipt-v2') return undefined;
  return verifyV2(input);
}

function verifyV2(input: Omit<VerifyInput, 'pdf'> & { pdfDigest: string; pdfSha3_256: string }): Verification {
  const chain = input.anchor === undefined || input.auditLogHead === undefined
    ? 'not_checked'
    : isDigest(input.anchor) && input.anchor === input.auditLogHead ? 'intact' : 'mismatch';
  const invalid = { signature: 'invalid', pdf: 'changed', chain } as const;
  const receipt = parseHybrid(input.receipt, isHybridReceipt);
  const manifest = parseHybrid(input.manifest, isHybridManifest);
  if (!receipt || !manifest || receipt.payload.keyId !== manifest.payload.keyId
    || receipt.payload.pqKeyId !== manifest.payload.pqKeyId) return invalid;
  const entry = input.trustStore.find(({ keyId }) => keyId === receipt.payload.keyId);
  if (!entry) return [receipt, manifest].every(hasHybridSignatures)
    ? { ...invalid, signature: 'unknown_signer' } : invalid;
  const receiptChecks = verifyHybrid(receipt, entry);
  const manifestChecks = verifyHybrid(manifest, entry);
  const signatures = {
    ed25519: receiptChecks.ed25519 && manifestChecks.ed25519,
    mldsa65: receiptChecks.mldsa65 && manifestChecks.mldsa65,
  };
  if (!entry.pqPublicKey && [receipt, manifest].every(hasHybridSignatures)) {
    return { ...invalid, signature: 'unknown_signer', signatures };
  }
  if (!signatures.ed25519 || !signatures.mldsa65 || manifest.payload.receiptDigest !== jsonDigest(receipt)) {
    return { ...invalid, signatures };
  }
  const hashes = { sha256: manifest.payload.pdfDigest, sha3_256: manifest.payload.pdfSha3_256 };
  const unchanged = hashes.sha256 === input.pdfDigest && hashes.sha3_256 === input.pdfSha3_256;
  return { signature: 'valid', pdf: unchanged ? 'unchanged' : 'changed', chain, signatures, hashes };
}

export function verify(input: VerifyInput): Verification {
  if (signedPayloadKind(input.receipt) !== 'courtplus-receipt-v2') return verifyV1(input);
  return verifyV2({
    ...input, pdfDigest: sha256(input.pdf), pdfSha3_256: sha3_256(input.pdf),
  });
}

function verifyV1(input: VerifyInput): Verification {
  const chain = input.anchor === undefined || input.auditLogHead === undefined
    ? 'not_checked'
    : isDigest(input.anchor) && input.anchor === input.auditLogHead ? 'intact' : 'mismatch';
  const invalid = { signature: 'invalid', pdf: 'changed', chain } as const;
  const receipt = parseSigned(input.receipt, isReceipt);
  const manifest = parseSigned(input.manifest, isManifest);
  if (!receipt || !manifest || receipt.payload.keyId !== manifest.payload.keyId) return invalid;
  const entry = input.trustStore.find(({ keyId }) => keyId === receipt.payload.keyId);
  if (!entry) return { ...invalid, signature: 'unknown_signer' };
  try {
    const publicKey = createPublicKey(entry.publicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519' || keyFingerprint(publicKey) !== entry.keyId
      || !matchesSignature(receipt, publicKey) || !matchesSignature(manifest, publicKey)
      || manifest.payload.receiptDigest !== jsonDigest(receipt)) return invalid;
    return {
      signature: 'valid',
      pdf: manifest.payload.pdfDigest === sha256(input.pdf) ? 'unchanged' : 'changed',
      chain,
      ...(entry.pqPublicKey && { legacy: true, signatures: { ed25519: true, mldsa65: false } }),
    };
  } catch {
    return invalid;
  }
}
