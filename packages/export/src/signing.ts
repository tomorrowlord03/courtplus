import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import canonicalize from 'canonicalize';
import type { CourtPlusApi, ISODate, ScreeningResult, Status } from '@courtplus/contracts';

export interface TrustEntry {
  keyId: string;
  publicKey: string;
  status: 'active' | 'retired';
  label: string;
}

export interface SigningKey extends TrustEntry {
  privateKey: string;
}

type MaybePromise<T> = T | Promise<T>;

export interface KeyStorage {
  load(keyId: string): MaybePromise<SigningKey | undefined>;
  save(key: SigningKey): MaybePromise<void>;
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
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
    status: 'active',
    label,
  };
}

export function exportPublicKey({ keyId, publicKey, status, label }: SigningKey): TrustEntry {
  return { keyId, publicKey, status, label };
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

export interface Manifest {
  kind: 'courtplus-manifest-v1';
  keyId: string;
  receiptDigest: string;
  pdfDigest: string;
}

export interface Signed<T> {
  payload: T;
  signature: string;
}

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

export function createReceipt(input: ReceiptInput, key: SigningKey): SignedReceipt {
  const { issuer, inputs, result, createdAt = new Date() } = input;
  if (!issuer.trim()) throw new Error('A receipt needs an issuer');
  const receiptId = randomUUID();
  const payload: Receipt = {
    kind: 'courtplus-receipt-v1',
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
  const receipt = signJson(payload, signingKey(key));
  return { receipt, receiptId, receiptDigest: sha256(receipt) };
}

export function createManifest(pdf: Uint8Array, receipt: string, key: SigningKey): string {
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

export type Verification = Awaited<ReturnType<CourtPlusApi['verify']>>;

export function verify(input: VerifyInput): Verification {
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
    };
  } catch {
    return invalid;
  }
}
