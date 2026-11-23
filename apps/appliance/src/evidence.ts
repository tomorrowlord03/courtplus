import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  generateKeyPairSync, randomBytes, randomUUID, verify, type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type {
  EvidenceActionEntry, EvidenceItem, EvidenceMode, EvidenceQuery,
  EvidenceReceiptPayload, EvidenceReceiptResponse, EvidenceStatus, EvidenceStatusResponse,
  EvidenceVerification, SubmitterInfo,
} from '@courtplus/contracts';
import {
  decodeTrustPem, encodeTrustPem, evidenceReceiptV2, generatePqKeyPair, parseHybrid, sha3_256, signedPayloadKind,
  signHybrid, verifyHybrid, type SigningKey, type TrustEntry,
} from '@courtplus/export/signing';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toDataURL } from 'qrcode';
import { z } from 'zod';
import type { Options } from './app.js';
import type { Session } from './auth.js';
import { audit, canonical, genesis, sha256, type Db } from './db.js';
import { html, HttpError, parse } from './http.js';
import { printDraft } from './exports.js';
import type { Role } from './inputs.js';

// Citation: Bharatiya Sakshya Adhiniyam, 2023 (Act No. 47 of 2023), Section 63(4)(c) and THE SCHEDULE (Part A & Part B) [indiacode.nic.in]

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
/** Roles that may read the evidence feed and act on items. */
export const EVIDENCE_ROLES: readonly Role[] = ['superintendent', 'dlsa', 'legal_aid', 'utrc_member', 'admin', 'judge'];
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'mp3', 'm4a', 'wav', 'webm', 'mp4'] as const;

export interface MagicByteResult {
  mime: string;
  ext: string;
}

/**
 * Checks the initial bytes of a buffer against the allowlisted file types.
 * Allowlist: jpg, png, webp, pdf, mp3, m4a, wav, webm, mp4.
 */
export function detectMagicBytes(buf: Uint8Array): MagicByteResult | null {
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return { mime: 'image/png', ext: 'png' };
  }
  // PDF: 25 50 44 46 (%PDF)
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  // RIFF container (WEBP or WAV)
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    const sub = String.fromCharCode(...buf.slice(8, 12));
    if (sub === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
    if (sub === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  }
  // MP3: ID3 header or MPEG frame sync
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  // WEBM: EBML header 1A 45 DF A3
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
    return { mime: 'video/webm', ext: 'webm' };
  }
  // MP4 / M4A: byte 4..7 is 'ftyp'
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.length >= 12 ? String.fromCharCode(...buf.slice(8, 12)).trim() : '';
    if (brand.startsWith('M4A') || brand === 'mp42' && brand.includes('m4a')) {
      return { mime: 'audio/mp4', ext: 'm4a' };
    }
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  return null;
}

export function validateFileBytes(buf: Uint8Array, filename: string): MagicByteResult {
  if (buf.byteLength > MAX_FILE_SIZE) {
    throw new HttpError(413, 'FILE_TOO_LARGE');
  }
  if (buf.byteLength === 0) {
    throw new HttpError(400, 'FILE_EMPTY');
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const detected = detectMagicBytes(buf);
  if (!detected) {
    throw new HttpError(422, 'INVALID_MAGIC_BYTES');
  }
  // Ensure extension category matches magic bytes
  const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  const isAudio = ['mp3', 'm4a', 'wav'].includes(ext);
  const isVideo = ['mp4', 'webm'].includes(ext);
  const isPdf = ext === 'pdf';

  if (isImage && !detected.mime.startsWith('image/')) throw new HttpError(422, 'MAGIC_BYTE_MISMATCH');
  if (isAudio && !detected.mime.startsWith('audio/') && detected.mime !== 'video/mp4') throw new HttpError(422, 'MAGIC_BYTE_MISMATCH');
  if (isVideo && !detected.mime.startsWith('video/') && detected.mime !== 'audio/mp4') throw new HttpError(422, 'MAGIC_BYTE_MISMATCH');
  if (isPdf && detected.mime !== 'application/pdf') throw new HttpError(422, 'MAGIC_BYTE_MISMATCH');

  return detected;
}

/**
 * AES-256-GCM encryption at rest.
 * Key must be 32 bytes.
 * Envelope layout: [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
 */
export function encryptBuffer(data: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(encryptedEnvelope: Buffer, key: Buffer): Buffer {
  if (encryptedEnvelope.length < 28) throw new Error('Invalid encrypted envelope');
  const iv = encryptedEnvelope.subarray(0, 12);
  const tag = encryptedEnvelope.subarray(12, 28);
  const ciphertext = encryptedEnvelope.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function resolveEvidenceKey(options?: Options): Buffer {
  const envKey = process.env.COURTPLUS_EVIDENCE_KEY;
  if (envKey) {
    if (/^[0-9a-f]{64}$/i.test(envKey)) return Buffer.from(envKey, 'hex');
    if (process.env.NODE_ENV === 'production') {
      throw new Error('COURTPLUS_EVIDENCE_KEY must be a 64-character hex string');
    }
  }
  const keyFile = process.env.COURTPLUS_EVIDENCE_KEY_FILE;
  if (keyFile) {
    if (existsSync(keyFile)) {
      const raw = readFileSync(keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Invalid evidence key in ${keyFile}: must be a 64-character hex string`);
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(`COURTPLUS_EVIDENCE_KEY_FILE not found: ${keyFile}`);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Evidence encryption key required in production: set COURTPLUS_EVIDENCE_KEY or COURTPLUS_EVIDENCE_KEY_FILE');
  }
  // In dev / test, use a deterministic or cached key file outside git
  const fallbackPath = join(process.env.TMPDIR || process.env.TEMP || tmpdir(), 'courtplus_evidence_vault.key');
  if (existsSync(fallbackPath)) {
    const raw = readFileSync(fallbackPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  }
  const generated = randomBytes(32).toString('hex');
  try {
    writeFileSync(fallbackPath, generated, { mode: 0o600 });
  } catch {}
  return Buffer.from(generated, 'hex');
}

export interface SigningKeyPair {
  keyId: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
}

export function resolveSigningKey(options?: Options): SigningKeyPair {
  const keyFile = options?.signingKeyFile ?? process.env.COURTPLUS_SIGNING_KEY_FILE;
  if (keyFile) {
    if (existsSync(keyFile)) {
      const pem = readFileSync(keyFile, 'utf8');
      const privateKey = createPrivateKey(pem);
      const publicKey = createPublicKey(privateKey);
      const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' }));
      return { keyId, privateKey, publicKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Signing key file not found: ${keyFile}`);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Signing key file required in production: set COURTPLUS_SIGNING_KEY_FILE or options.signingKeyFile');
  }
  // In-memory Ed25519 key for server signing
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  return { keyId, privateKey, publicKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

export function loadPqSeed(edKeyConfigured: boolean): Buffer | undefined {
  const file = process.env.COURTPLUS_PQ_SIGNING_KEY_FILE;
  const seed = file && existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
  if (seed === undefined && (edKeyConfigured || process.env.NODE_ENV === 'production')) {
    throw new Error('COURTPLUS_PQ_SIGNING_KEY_FILE must point to an ML-DSA-65 seed when the Ed25519 key is configured or in production');
  }
  if (seed !== undefined && !/^[a-f0-9]{64}$/i.test(seed)) throw new Error('The ML-DSA-65 secret must contain a 32-byte hex seed');
  return seed === undefined ? undefined : Buffer.from(seed, 'hex');
}

function evidenceSigner({ privateKey, keyId, publicKeyPem }: SigningKeyPair, edKeyConfigured: boolean) {
  return {
    keyId, publicKey: publicKeyPem, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    status: 'active', label: 'Evidence vault', ...generatePqKeyPair(loadPqSeed(edKeyConfigured)),
  } satisfies SigningKey;
}

export function loadRetiredPqKeys(keyId: string, label: string): Map<string, TrustEntry> {
  const keys = new Map<string, TrustEntry>();
  const dir = process.env.COURTPLUS_PQ_RETIRED_DIR;
  if (!dir) return keys;
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const isSeed = file.name.endsWith('.seed');
    if (!isSeed && !file.name.endsWith('.pem')) continue;
    try {
      if (!file.isFile()) throw new Error('Expected a regular file');
      const contents = readFileSync(join(dir, file.name), 'utf8');
      // Seed files carry a 32-byte hex seed on the first line and the bound trust PEM below it.
      const seed = /^([a-f0-9]{64})\r?\n/i.exec(contents);
      if (isSeed && !seed) throw new Error('Expected a 32-byte hex seed');
      const key = decodeTrustPem(seed ? contents.slice(seed[0].length) : contents);
      if (!key.pqKeyId || (seed && generatePqKeyPair(Buffer.from(seed[1], 'hex')).pqKeyId !== key.pqKeyId)) {
        throw new Error('Expected a bound ML-DSA-65 key');
      }
      if (key.keyId !== keyId) {
        if (!isSeed) continue;
        throw new Error('Expected a seed for the configured Ed25519 signer');
      }
      keys.set(key.pqKeyId, { ...key, label, status: 'retired' });
    } catch (cause) {
      throw new Error(`Invalid retired PQ key in COURTPLUS_PQ_RETIRED_DIR: ${file.name}`, { cause });
    }
  }
  return keys;
}

const hashDigest = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceV2Schema = z.strictObject({
  kind: z.literal(evidenceReceiptV2), id: z.uuid(), sha256: hashDigest, sha3_256: hashDigest,
  size: z.number().int().nonnegative(), mime: z.string(), receivedAt: z.iso.datetime(), caseRef: z.string(),
  mode: z.enum(['identified', 'anonymous']), keyId: hashDigest, pqKeyId: hashDigest,
});

function readHybridReceipt(receipt: string) {
  return parseHybrid(receipt, (value): value is z.infer<typeof evidenceV2Schema> => evidenceV2Schema.safeParse(value).success);
}

export interface StoredEvidenceRow {
  id: string;
  case_ref: string;
  description: string;
  mode: EvidenceMode;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  received_at: string;
  status: EvidenceStatus;
  submitter_name: string | null;
  submitter_phone: string | null;
  submitter_email: string | null;
  status_code_hash: string | null;
  receipt: string;
  receipt_signature: string;
  prev_hash: string;
  entry_hash: string;
  parent_id: string | null;
  court: string | null;
  file_path: string;
}

export interface EvidenceLogEntry {
  id: number;
  evidence_id: string;
  ts: string;
  actor: string;
  action: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
}

export function appendEvidenceLog(
  db: Db,
  evidenceId: string,
  actor: string,
  action: string,
  payload: unknown,
): { entryHash: string; prevHash: string; id: number } {
  if (!db.inTransaction) throw new Error('Evidence log entries must share the write transaction');
  const tail = db.prepare<[], Pick<EvidenceLogEntry, 'id' | 'hash'>>(
    'SELECT id, hash FROM evidence_log ORDER BY id DESC LIMIT 1'
  ).get();
  const prev_hash = tail?.hash ?? genesis;
  const ts = new Date().toISOString();
  const payload_hash = sha256(canonical(payload));
  const id = (tail?.id ?? 0) + 1;
  const entryToHash = { id, evidence_id: evidenceId, ts, actor, action, payload_hash, prev_hash };
  const hash = sha256(canonical(entryToHash));

  db.prepare('INSERT INTO evidence_log (id, evidence_id, ts, actor, action, payload_hash, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, evidenceId, ts, actor, action, payload_hash, prev_hash, hash);

  return { entryHash: hash, prevHash: prev_hash, id };
}

function rowToItem(row: StoredEvidenceRow, actions: EvidenceActionEntry[] = []): EvidenceItem {
  const hybrid = readHybridReceipt(row.receipt);
  return {
    id: row.id,
    caseRef: row.case_ref,
    description: row.description,
    mode: row.mode,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    ...(hybrid && { sha3_256: hybrid.payload.sha3_256, pqSignature: hybrid.signatures.mldsa65 }),
    receivedAt: row.received_at,
    status: row.status,
    submitter: row.mode === 'identified' && row.submitter_name && row.submitter_phone
      ? { name: row.submitter_name, phone: row.submitter_phone, email: row.submitter_email ?? undefined }
      : undefined,
    receipt: row.receipt,
    receiptSignature: row.receipt_signature,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    court: row.court ?? undefined,
    parentId: row.parent_id ?? undefined,
    actionHistory: actions,
  };
}

/**
 * Generates official HTML certificate under BSA 2023 Section 63 Schedule format.
 * Citation: Bharatiya Sakshya Adhiniyam, 2023 (Act No. 47 of 2023), Section 63(4)(c) and THE SCHEDULE (Part A & Part B) [indiacode.nic.in]
 */
export function generateBsaCertificateHtml(item: EvidenceItem, keyId: string, issuer: string): string {
  const isAnonymous = item.mode === 'anonymous';
  const submitterName = isAnonymous ? 'Anonymous Citizen / Whistleblower (Identity Protected under Law)' : (item.submitter?.name ?? 'Identified Submitter');
  const submitterContact = isAnonymous ? 'None (Anonymous Whistleblower Submission)' : `${item.submitter?.phone ?? ''} ${item.submitter?.email ? `(${item.submitter.email})` : ''}`.trim();
  const formattedSize = `${item.size} bytes (${(item.size / (1024 * 1024)).toFixed(2)} MB)`;
  const hashRows = `<div>☑ SHA256: <span class="hash">${html(item.sha256)}</span></div>
    <div>${item.sha3_256 ? '☑' : '☐'} Other: SHA3-256 <span class="hash">${html(item.sha3_256 ?? '')}</span></div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BSA Section 63 Electronic Evidence Certificate - ${html(item.id)}</title>
  <style>
    body { font-family: 'Noto Sans', system-ui, -apple-system, sans-serif; margin: 32px; color: #0f172a; line-height: 1.5; font-size: 13px; }
    h1 { text-align: center; font-size: 18px; margin-bottom: 4px; text-transform: uppercase; font-weight: bold; }
    h2 { text-align: center; font-size: 14px; margin-top: 0; margin-bottom: 24px; color: #334155; }
    .section-title { font-weight: bold; font-size: 14px; background: #e2e8f0; padding: 6px 12px; margin-top: 20px; border-left: 4px solid #1e3a8a; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 15px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { width: 32%; background-color: #f8fafc; font-weight: 600; color: #1e293b; }
    .hash { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; color: #0f172a; background: #f1f5f9; padding: 2px 4px; border-radius: 2px; }
    .seal-box { margin-top: 24px; border: 2px dashed #94a3b8; padding: 14px; background: #fafafa; border-radius: 6px; }
    .seal-title { font-weight: bold; color: #1e3a8a; margin-bottom: 6px; }
    .citation { font-size: 11px; color: #64748b; margin-top: 24px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  </style>
</head>
<body>
  <h1>The Bharatiya Sakshya Adhiniyam, 2023 (BSA)</h1>
  <h2>THE SCHEDULE [See Section 63(4)(c)]<br>Certificate for Admissibility of Electronic Records</h2>

  <div class="section-title">PART A: To be filled by the Party / Person producing the Electronic Record</div>
  <table>
    <tr><th>1. Name of Producer</th><td>${html(submitterName)}</td></tr>
    <tr><th>2. Contact Particulars</th><td>${html(submitterContact)}</td></tr>
    <tr><th>3. Case Reference</th><td>${html(item.caseRef || 'N/A')}</td></tr>
    <tr><th>4. Electronic Record Description</th><td>${html(item.description)} (File: ${html(item.filename)}, ${html(item.mime)}, ${html(formattedSize)})</td></tr>
    <tr><th>5. Producing Device / Channel</th><td>CourtPlus Citizen-to-Judge Vault Web Portal (HTTPS / Web Client)</td></tr>
    <tr><th>6. Operational Integrity Declaration</th><td>I state that the electronic record was produced in the lawful course of activity and submitted without alteration to the Court vault.</td></tr>
    <tr><th>7. Cryptographic Hash Values</th><td>${hashRows}</td></tr>
    <tr><th>8. Date & Server Timestamp</th><td>${html(item.receivedAt)}</td></tr>
  </table>

  <div class="section-title">PART B: To be filled by the Expert</div>
  <p>I solemnly affirm that the electronic record was obtained from the source specified below and that the reported hash values are those of the electronic record.</p>
  <table>
    <tr><th>Expert name</th><td>________________________________</td></tr>
    <tr><th>Son/daughter/spouse of</th><td>________________________________</td></tr>
    <tr><th>Residing/employed at</th><td>________________________________</td></tr>
    <tr><th>Device / digital record source</th><td>☐ Computer / Storage Media &nbsp; ☐ DVR &nbsp; ☐ Mobile &nbsp; ☐ Flash Drive &nbsp; ☐ CD/DVD &nbsp; ☐ Server &nbsp; ☐ Cloud &nbsp; ☐ Other: ____________</td></tr>
    <tr><th>Device particulars</th><td>Make and model: ____________ &nbsp; Color: ____________ &nbsp; Serial number: ____________<br>IMEI/UIN/UID/MAC/Cloud ID: ________________________<br>Other relevant information: ________________________</td></tr>
    <tr><th>Cryptographic Hash Values</th><td>${hashRows}<div>Enclose the hash report with the certificate.</div></td></tr>
    <tr><th>Expert designation</th><td>________________________________</td></tr>
    <tr><th>Expert signature</th><td>________________________________</td></tr>
    <tr><th>Date, time and place</th><td>Date (DD/MM/YYYY): ____________ &nbsp; Time (IST): ____________ &nbsp; Place: ____________</td></tr>
  </table>

  <div class="seal-box">
    <div class="seal-title">Vault Receipt</div>
    <div>Issuing office: ${html(issuer || 'CourtPlus Evidence Vault')}</div>
    <div>Receipt ID: ${html(item.id)} | Signer key: <span class="hash">${html(keyId)}</span></div>
    <div>Entry hash: <span class="hash">${html(item.entryHash)}</span><br>Previous hash: <span class="hash">${html(item.prevHash)}</span></div>
    <div>Custody status: ${html(item.status.toUpperCase())}</div>
    <div>Receipt Signature: <span class="hash">${html(item.receiptSignature)}</span></div>
    ${item.pqSignature ? '<div>The electronic receipt also carries an ML-DSA-65 signature.</div>' : ''}
  </div>

  <div class="citation">
    Official Reference: The Bharatiya Sakshya Adhiniyam, 2023 (Act No. 47 of 2023), Section 63(4)(c) and THE SCHEDULE (Part A & Part B). Source: indiacode.nic.in
  </div>
</body>
</html>`;
}

/**
 * Mobile-friendly server-rendered upload page (English + Hindi) with receipt + QR code.
 */
export function renderSubmitPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Court+ Evidence Bridge | साक्ष्य सेतु</title>
  <style>
    :root {
      --primary: #1e3a8a;
      --primary-hover: #172554;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #cbd5e1;
      --success: #15803d;
      --warning: #b45309;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 16px; font-size: 15px; }
    .container { max-width: 580px; margin: 0 auto; background: var(--card-bg); border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); border: 1px solid var(--border); overflow: hidden; }
    .header { background: var(--primary); color: white; padding: 20px; text-align: center; }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .nav-tabs { display: flex; border-bottom: 1px solid var(--border); background: #f1f5f9; }
    .nav-tab { flex: 1; padding: 12px; text-align: center; font-weight: 600; cursor: pointer; border: none; background: transparent; font-size: 14px; color: var(--muted); }
    .nav-tab.active { background: white; color: var(--primary); border-bottom: 3px solid var(--primary); }
    .content { padding: 20px; }
    .mode-switch { display: flex; gap: 10px; margin-bottom: 18px; }
    .mode-btn { flex: 1; padding: 12px; border: 2px solid var(--border); border-radius: 8px; text-align: center; cursor: pointer; font-size: 14px; font-weight: 600; background: white; }
    .mode-btn.selected { border-color: var(--primary); background: #eff6ff; color: var(--primary); }
    .field { margin-bottom: 16px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; color: #1e293b; }
    label .hint { font-weight: normal; color: var(--muted); font-size: 12px; }
    input[type="text"], input[type="tel"], input[type="email"], textarea {
      width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 15px; outline: none; transition: border-color 0.2s;
    }
    input:focus, textarea:focus { border-color: var(--primary); ring: 2px solid #bfdbfe; }
    .file-drop { border: 2px dashed var(--border); border-radius: 8px; padding: 20px; text-align: center; background: #fafafa; cursor: pointer; }
    .file-drop:hover { border-color: var(--primary); }
    .btn-submit { width: 100%; background: var(--primary); color: white; padding: 14px; font-size: 16px; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; margin-top: 8px; }
    .btn-submit:hover { background: var(--primary-hover); }
    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .receipt-card { display: none; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin-top: 20px; }
    .receipt-card.active { display: block; }
    .receipt-title { font-weight: 700; color: var(--success); font-size: 17px; margin-bottom: 8px; text-align: center; }
    .code-box { background: #fef3c7; border: 2px dashed #f59e0b; padding: 12px; border-radius: 6px; text-align: center; font-family: ui-monospace, monospace; font-size: 18px; font-weight: bold; color: #78350f; margin: 12px 0; letter-spacing: 1px; }
    .qr-container { text-align: center; margin-top: 14px; }
    .qr-container img { max-width: 180px; height: auto; border: 1px solid var(--border); border-radius: 4px; padding: 4px; background: white; }
    .notice { font-size: 13px; color: var(--muted); line-height: 1.4; margin-top: 12px; background: #f1f5f9; padding: 10px; border-radius: 6px; }
    .status-result { display: none; margin-top: 16px; padding: 14px; border-radius: 6px; background: #f8fafc; border: 1px solid var(--border); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
    .badge-received { background: #dbeafe; color: #1e40af; }
    .badge-seen { background: #fef3c7; color: #92400e; }
    .badge-taken_on_record { background: #dcfce7; color: #166534; }
    .badge-shared_with_parties { background: #f3e8ff; color: #6b21a8; }
    .error-msg { color: #dc2626; font-size: 13px; margin-top: 6px; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Court+ Evidence Vault | साक्ष्य सेतु</h1>
      <p>Secure Citizen-to-Judge Bridge & Whistleblower Channel<br>नागरिक-न्यायाधीश सुरक्षित साक्ष्य एवं व्हिसलब्लोअर सेतु</p>
    </div>

    <div class="nav-tabs">
      <button class="nav-tab active" id="tabSubmit" onclick="switchTab('submit')">Submit Proof / साक्ष्य भेजें</button>
      <button class="nav-tab" id="tabStatus" onclick="switchTab('status')">Check Status / स्थिति देखें</button>
    </div>

    <div class="content">
      <!-- UPLOAD SECTION -->
      <div id="sectionSubmit">
        <div class="mode-switch">
          <div class="mode-btn selected" id="btnIdentified" onclick="setMode('identified')">
            Identified<br><span style="font-size:12px;font-weight:normal;">पहचान सहित</span>
          </div>
          <div class="mode-btn" id="btnAnonymous" onclick="setMode('anonymous')">
            Anonymous Tip<br><span style="font-size:12px;font-weight:normal;">अनाम / गोपनीय</span>
          </div>
        </div>

        <form id="evidenceForm" onsubmit="submitForm(event)">
          <input type="hidden" id="mode" name="mode" value="identified">
          <p class="notice" id="identifiedNotice">DPDP notice: We collect your name, phone, optional email, case reference, description and file for this court case. The court and authorised case staff can access your submission, and opposing parties receive it before it is relied on.</p>

          <div class="field" id="nameField">
            <label>Full Name / पूरा नाम</label>
            <input type="text" id="name" name="name" placeholder="Enter your full name" required>
          </div>

          <div class="field" id="phoneField">
            <label>Phone / फ़ोन नंबर</label>
            <input type="tel" id="phone" name="phone" placeholder="Enter mobile number" required>
          </div>

          <div class="field" id="emailField">
            <label>Email / ईमेल <span class="hint">(Optional / वैकल्पिक)</span></label>
            <input type="email" id="email" name="email" placeholder="name@example.com">
          </div>

          <div class="field">
            <label>Case Reference / मामला संदर्भ <span class="hint">(CNR / Case No / Complaint ID)</span></label>
            <input type="text" id="caseRef" name="caseRef" placeholder="e.g. CNR... or Complaint ID" required>
          </div>

          <div class="field">
            <label>Description / विवरण</label>
            <textarea id="description" name="description" rows="3" placeholder="Briefly describe what this evidence demonstrates..." required></textarea>
          </div>

          <div class="field">
            <label>Select File / फ़ाइल चुनें <span class="hint">(Max 50 MB: JPG, PNG, WEBP, PDF, MP3, M4A, WAV, WEBM, MP4)</span></label>
            <div class="file-drop" onclick="document.getElementById('fileInput').click()">
              <input type="file" id="fileInput" name="file" style="display:none" onchange="onFileSelected(this)" required accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.webm,.mp4">
              <span id="fileNameDisplay">Click to browse or tap to choose file<br>फ़ाइल चुनने के लिए यहाँ क्लिक करें</span>
            </div>
            <div id="fileError" class="error-msg"></div>
          </div>

          <button type="submit" id="submitBtn" class="btn-submit">Submit Encrypted Proof / साक्ष्य जमा करें</button>
          <div id="submitError" class="error-msg"></div>
        </form>

        <div id="receiptCard" class="receipt-card">
          <div class="receipt-title">Proof Received & Sealed / साक्ष्य सीलबंद प्राप्त हुआ</div>
          <p style="font-size:13px;text-align:center;color:#166534;margin-bottom:10px;">
            Your receipt was signed with Ed25519 and ML-DSA-65. Your file is encrypted at rest (AES-256-GCM).
          </p>

          <div id="anonymousReceiptCodeSection" style="display:none;">
            <p style="font-size:13px;font-weight:bold;color:#92400e;text-align:center;">
              SAVE THIS RECEIPT CODE! It will NOT be shown again.<br>यह रसीद कोड सुरक्षित रख लें! यह दोबारा नहीं दिखेगा:
            </p>
            <div class="code-box" id="displayReceiptCode"></div>
          </div>

          <div style="font-size:13px;line-height:1.6;margin-top:10px;">
            <div><strong>Vault ID:</strong> <span id="displayId" style="font-family:monospace;"></span></div>
            <div><strong>SHA-256:</strong> <span id="displayHash" style="font-family:monospace;font-size:11px;word-break:break-all;"></span></div>
            <div><strong>SHA3-256:</strong> <span id="displaySha3" style="font-family:monospace;font-size:11px;word-break:break-all;"></span></div>
            <div><strong>Timestamp:</strong> <span id="displayTime"></span></div>
            <div><strong>Mode:</strong> <span id="displayMode"></span></div>
          </div>

          <div class="qr-container">
            <img id="qrImage" alt="Receipt QR Code">
            <p style="font-size:11px;color:var(--muted);margin-top:4px;">Scan to verify receipt hash / रसीद सत्यापन हेतु स्कैन करें</p>
          </div>
        </div>

        <div class="notice">
          <strong>Legal Notice / विधिक सूचना:</strong> Submissions are secured under the Bharatiya Sakshya Adhiniyam, 2023. Identified submissions are shared with opposing parties before reliance to preserve natural justice. Anonymous whistleblower tips are reviewed exclusively by the court in a dedicated confidential queue.
        </div>
      </div>

      <!-- STATUS CHECK SECTION -->
      <div id="sectionStatus" style="display:none;">
        <div class="field">
          <label>Enter 128-bit Receipt Code / रसीद कोड दर्ज करें</label>
          <input type="text" id="statusCodeInput" placeholder="Enter 32-character receipt code">
        </div>
        <button type="button" class="btn-submit" onclick="checkStatus()">Check Status / स्थिति जांचें</button>
        <div id="statusError" class="error-msg"></div>

        <div id="statusResult" class="status-result">
          <div style="margin-bottom:8px;">
            <strong>Status / स्थिति:</strong> <span id="resStatusBadge" class="badge"></span>
          </div>
          <div><strong>Case Ref:</strong> <span id="resCaseRef"></span></div>
          <div><strong>Submitted On:</strong> <span id="resTime"></span></div>
          <div><strong>Vault ID:</strong> <span id="resId" style="font-family:monospace;font-size:12px;"></span></div>
          <div><strong>SHA-256:</strong> <span id="resHash" style="font-family:monospace;font-size:11px;word-break:break-all;"></span></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function setMode(mode) {
      document.getElementById('mode').value = mode;
      const isAnon = mode === 'anonymous';
      document.getElementById('btnIdentified').classList.toggle('selected', !isAnon);
      document.getElementById('btnAnonymous').classList.toggle('selected', isAnon);

      document.getElementById('nameField').style.display = isAnon ? 'none' : 'block';
      document.getElementById('phoneField').style.display = isAnon ? 'none' : 'block';
      document.getElementById('emailField').style.display = isAnon ? 'none' : 'block';
      document.getElementById('identifiedNotice').hidden = isAnon;
      document.getElementById('name').required = !isAnon;
      document.getElementById('phone').required = !isAnon;
      for (const field of ['name', 'phone', 'email']) {
        document.getElementById(field).disabled = isAnon;
      }
    }

    function switchTab(tab) {
      const isSubmit = tab === 'submit';
      document.getElementById('tabSubmit').classList.toggle('active', isSubmit);
      document.getElementById('tabStatus').classList.toggle('active', !isSubmit);
      document.getElementById('sectionSubmit').style.display = isSubmit ? 'block' : 'none';
      document.getElementById('sectionStatus').style.display = isSubmit ? 'none' : 'block';
    }

    function onFileSelected(input) {
      const file = input.files[0];
      const display = document.getElementById('fileNameDisplay');
      const err = document.getElementById('fileError');
      err.style.display = 'none';
      if (!file) {
        display.innerHTML = 'Click to browse or tap to choose file<br>फ़ाइल चुनने के लिए यहाँ क्लिक करें';
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        err.textContent = 'File exceeds maximum 50 MB limit / फ़ाइल 50 MB सीमा से अधिक है';
        err.style.display = 'block';
        input.value = '';
        return;
      }
      display.innerHTML = '<strong>' + file.name + '</strong> (' + (file.size / (1024*1024)).toFixed(2) + ' MB)';
    }

    async function submitForm(e) {
      e.preventDefault();
      const form = document.getElementById('evidenceForm');
      const btn = document.getElementById('submitBtn');
      const err = document.getElementById('submitError');
      err.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Encrypting & Sealing... / सीलबंद किया जा रहा है...';

      const formData = new FormData(form);
      try {
        const res = await fetch('/evidence', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Upload failed with status ' + res.status);
        }
        const result = await res.json();
        document.getElementById('receiptCard').classList.add('active');
        document.getElementById('displayId').textContent = result.id;
        document.getElementById('displayHash').textContent = result.sha256;
        document.getElementById('displaySha3').textContent = result.sha3_256;
        document.getElementById('displayTime').textContent = result.receivedAt;
        document.getElementById('displayMode').textContent = result.mode === 'anonymous' ? 'Anonymous Tip (Whistleblower)' : 'Identified Submission';

        if (result.receiptCode) {
          document.getElementById('anonymousReceiptCodeSection').style.display = 'block';
          document.getElementById('displayReceiptCode').textContent = result.receiptCode;
        } else {
          document.getElementById('anonymousReceiptCodeSection').style.display = 'none';
        }

        if (result.qrDataUrl) {
          document.getElementById('qrImage').src = result.qrDataUrl;
        }
        form.reset();
        document.getElementById('fileNameDisplay').innerHTML = 'File uploaded successfully / फ़ाइल सफलतापूर्वक अपलोड हुई';
      } catch (ex) {
        err.textContent = ex.message || 'Submission error';
        err.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Encrypted Proof / साक्ष्य जमा करें';
      }
    }

    async function checkStatus() {
      const code = document.getElementById('statusCodeInput').value.trim();
      const err = document.getElementById('statusError');
      const resDiv = document.getElementById('statusResult');
      err.style.display = 'none';
      resDiv.style.display = 'none';

      if (!code) {
        err.textContent = 'Please enter receipt code / कृपया रसीद कोड दर्ज करें';
        err.style.display = 'block';
        return;
      }

      try {
        const r = await fetch('/evidence/status/' + encodeURIComponent(code));
        if (!r.ok) {
          if (r.status === 404) throw new Error('Receipt code not found / रसीद कोड नहीं मिला');
          throw new Error('Status check failed (' + r.status + ')');
        }
        const data = await r.json();
        resDiv.style.display = 'block';
        const badge = document.getElementById('resStatusBadge');
        badge.textContent = data.status.replace(/_/g, ' ');
        badge.className = 'badge badge-' + data.status;
        document.getElementById('resCaseRef').textContent = data.caseRef;
        document.getElementById('resTime').textContent = data.receivedAt;
        document.getElementById('resId').textContent = data.id;
        document.getElementById('resHash').textContent = data.sha256;
      } catch (ex) {
        err.textContent = ex.message;
        err.style.display = 'block';
      }
    }
  </script>
</body>
</html>`;
}

function tmpdir(): string {
  return process.env.TMPDIR || process.env.TEMP || 'C:\\Windows\\Temp';
}

/**
 * Creates and registers the Fastify routes for the Evidence Vault.
 */
export function registerEvidenceRoutes(
  app: FastifyInstance,
  db: Db,
  options: Options,
  authenticate: (request: FastifyRequest) => Session,
  authorize: (request: FastifyRequest, roles: readonly Role[], write?: boolean) => Session,
) {
  const root = options.origin || 'http://localhost:3000';
  const evidenceDir = process.env.COURTPLUS_EVIDENCE_DIR || (options as any).evidenceDir || join(tmpdir(), 'courtplus_evidence_vault');
  mkdirSync(evidenceDir, { recursive: true });

  const encKey = resolveEvidenceKey(options);
  const edSigner = resolveSigningKey(options);
  const signer = evidenceSigner(edSigner, Boolean(options.signingKeyFile ?? process.env.COURTPLUS_SIGNING_KEY_FILE));
  const signerPem = encodeTrustPem(signer);
  const verificationKeys = loadRetiredPqKeys(signer.keyId, signer.label);
  const edTrust = { keyId: signer.keyId, publicKey: signer.publicKey, status: signer.status, label: signer.label };
  verificationKeys.set(signer.pqKeyId, { ...edTrust, pqKeyId: signer.pqKeyId, pqPublicKey: signer.pqPublicKey });

  app.get('/api/evidence/signing-key', async (request, reply) => {
    authorize(request, EVIDENCE_ROLES);
    return reply.type('application/x-pem-file')
      .header('content-disposition', 'attachment; filename="courtplus-evidence-signer.pem"')
      .send(signerPem);
  });

  // Rate limiting tracker
  const ipIdentifiedUploads = new Map<string, { count: number; until: number }>();
  let globalAnonymousCounter = 0;
  let globalAnonymousReset = Date.now() + 60_000;

  const MAX_IDENTIFIED_PER_IP_HOUR = 20;
  const MAX_GLOBAL_ANONYMOUS_MINUTE = 100;

  function checkUploadRateLimit(req: FastifyRequest, mode: EvidenceMode) {
    const now = Date.now();
    if (mode === 'identified') {
      const ip = req.ip || 'unknown';
      const record = ipIdentifiedUploads.get(ip);
      if (record && record.until > now) {
        if (record.count >= MAX_IDENTIFIED_PER_IP_HOUR) {
          throw new HttpError(429, 'RATE_LIMITED');
        }
        record.count++;
      } else {
        ipIdentifiedUploads.set(ip, { count: 1, until: now + 3600_000 });
      }
    } else {
      // Global limit only for anonymous; store NO client IP
      if (now > globalAnonymousReset) {
        globalAnonymousCounter = 0;
        globalAnonymousReset = now + 60_000;
      }
      if (globalAnonymousCounter >= MAX_GLOBAL_ANONYMOUS_MINUTE) {
        throw new HttpError(429, 'RATE_LIMITED');
      }
      globalAnonymousCounter++;
    }
  }

  // Prepared SQL statements
  const insertEvidence = db.prepare(`
    INSERT INTO evidence (
      id, case_ref, description, mode, filename, mime, size, sha256, received_at,
      status, submitter_name, submitter_phone, submitter_email, status_code_hash,
      receipt, receipt_signature, prev_hash, entry_hash, parent_id, court, file_path
    ) VALUES (
      @id, @case_ref, @description, @mode, @filename, @mime, @size, @sha256, @received_at,
      @status, @submitter_name, @submitter_phone, @submitter_email, @status_code_hash,
      @receipt, @receipt_signature, @prev_hash, @entry_hash, @parent_id, @court, @file_path
    )
  `);

  const selectEvidenceById = db.prepare<[string], StoredEvidenceRow>(
    'SELECT * FROM evidence WHERE id = ?'
  );

  const selectEvidenceByCodeHash = db.prepare<[string], StoredEvidenceRow>(
    'SELECT * FROM evidence WHERE status_code_hash = ?'
  );

  const insertAction = db.prepare(`
    INSERT INTO evidence_actions (evidence_id, action, actor, ts, note)
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateStatus = db.prepare(`
    UPDATE evidence SET status = ? WHERE id = ?
  `);

  const selectActionsByEvidenceId = db.prepare<[string], { action: EvidenceStatus; actor: string; ts: string; note: string | null }>(
    'SELECT action, actor, ts, note FROM evidence_actions WHERE evidence_id = ? ORDER BY id ASC'
  );

  // 1. Mobile-friendly web page GET /submit
  app.get('/submit', async (_, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return renderSubmitPage();
  });

  // 2. Anonymous Receipt Status GET /evidence/status/:code
  app.get('/evidence/status/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    if (!code || typeof code !== 'string') throw new HttpError(400, 'INVALID_CODE');
    const codeHash = sha256(code.trim());
    const row = selectEvidenceByCodeHash.get(codeHash);
    if (!row) throw new HttpError(404, 'NOT_FOUND');

    const hybrid = readHybridReceipt(row.receipt);
    const res: EvidenceStatusResponse = {
      id: row.id,
      status: row.status,
      caseRef: row.case_ref,
      receivedAt: row.received_at,
      sha256: row.sha256,
      ...(hybrid && { sha3_256: hybrid.payload.sha3_256 }),
      description: row.description,
    };
    return res;
  });

  // 3. Evidence Submission POST /evidence (multipart)
  app.post('/evidence', {
    bodyLimit: 60 * 1024 * 1024,
    config: { disableRequestLogging: true }, // Do not log client IP for anonymous uploads
  }, async (request, reply) => {
    const contentType = request.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new HttpError(415, 'MULTIPART_REQUIRED');
    }

    const resObj = new Response(Readable.toWeb(request.raw) as any, { headers: { 'content-type': contentType } });
    const formData = await resObj.formData();

    const mode = (formData.get('mode') as string || 'identified') as EvidenceMode;
    if (mode !== 'identified' && mode !== 'anonymous') {
      throw new HttpError(400, 'INVALID_MODE');
    }

    checkUploadRateLimit(request, mode);

    const caseRef = (formData.get('caseRef') as string || '').trim();
    const description = (formData.get('description') as string || '').trim();
    const parentId = (formData.get('parentId') as string || '').trim() || null;
    const court = (formData.get('court') as string || '').trim() || null;

    if (!caseRef) throw new HttpError(400, 'CASE_REF_REQUIRED');
    if (!description) throw new HttpError(400, 'DESCRIPTION_REQUIRED');

    let submitterName: string | null = null;
    let submitterPhone: string | null = null;
    let submitterEmail: string | null = null;

    if (mode === 'identified') {
      submitterName = (formData.get('name') as string || '').trim() || null;
      submitterPhone = (formData.get('phone') as string || '').trim() || null;
      submitterEmail = (formData.get('email') as string || '').trim() || null;
      if (!submitterName || !submitterPhone) {
        throw new HttpError(400, 'IDENTIFIED_DETAILS_REQUIRED');
      }
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      throw new HttpError(400, 'FILE_REQUIRED');
    }

    const filename = file.name || 'evidence.bin';
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const detected = validateFileBytes(fileBytes, filename);
    const size = fileBytes.byteLength;
    const fileHash = sha256(fileBytes);
    const sha3 = sha3_256(fileBytes);
    const receivedAt = new Date().toISOString();
    const id = randomUUID();

    // Anonymous 128-bit receipt code
    let receiptCode: string | undefined;
    let statusCodeHash: string | null = null;
    if (mode === 'anonymous') {
      receiptCode = randomBytes(16).toString('hex');
      statusCodeHash = sha256(receiptCode);
    }

    const receiptPayload = {
      kind: evidenceReceiptV2,
      keyId: signer.keyId,
      pqKeyId: signer.pqKeyId,
      id,
      sha256: fileHash,
      sha3_256: sha3,
      size,
      mime: detected.mime,
      receivedAt,
      caseRef,
      mode,
    } satisfies EvidenceReceiptPayload & z.infer<typeof evidenceV2Schema>;
    const signed = signHybrid(receiptPayload, signer);
    const { ed25519: receiptSignature, mldsa65: pqSignature } = signed.signatures;
    const signedReceipt = canonical(signed);

    // Encrypt file at rest outside web root
    const encryptedBytes = encryptBuffer(fileBytes, encKey);
    const vaultFilePath = join(evidenceDir, `${id}.enc`);
    await writeFile(vaultFilePath, encryptedBytes);

    // Database transaction with hash-chained evidence log
    const { entryHash, prevHash } = db.transaction(() => {
      const logResult = appendEvidenceLog(
        db,
        id,
        mode === 'anonymous' ? 'anonymous' : (submitterName || 'identified'),
        'received',
        receiptPayload,
      );

      insertEvidence.run({
        id,
        case_ref: caseRef,
        description,
        mode,
        filename,
        mime: detected.mime,
        size,
        sha256: fileHash,
        received_at: receivedAt,
        status: 'received',
        submitter_name: submitterName,
        submitter_phone: submitterPhone,
        submitter_email: submitterEmail,
        status_code_hash: statusCodeHash,
        receipt: signedReceipt,
        receipt_signature: receiptSignature,
        prev_hash: logResult.prevHash,
        entry_hash: logResult.entryHash,
        parent_id: parentId,
        court,
        file_path: vaultFilePath,
      });

      insertAction.run(id, 'received', mode === 'anonymous' ? 'anonymous' : (submitterName || 'identified'), receivedAt, 'Initial upload and sealed in vault');
      return logResult;
    }).immediate();

    // QR Code data URL
    const qrPayload = JSON.stringify({ id, sha256: fileHash, receivedAt, mode, caseRef });
    const qrDataUrl = await toDataURL(qrPayload, { margin: 1, width: 200 });

    const response: EvidenceReceiptResponse & { qrDataUrl: string } = {
      id,
      sha256: fileHash,
      sha3_256: sha3,
      size,
      mime: detected.mime,
      receivedAt,
      caseRef,
      mode,
      receipt: signedReceipt,
      receiptSignature,
      pqSignature,
      receiptCode,
      entryHash,
      prevHash,
      qrDataUrl,
    };

    return reply.code(201).send(response);
  });

  // 4. Authenticated Feed GET /api/evidence
  app.get('/api/evidence', async (request) => {
    authorize(request, EVIDENCE_ROLES);
    const query = request.query as EvidenceQuery;
    let sql = 'SELECT * FROM evidence WHERE 1=1';
    const params: unknown[] = [];

    if (query.caseRef) {
      sql += ' AND case_ref = ?';
      params.push(query.caseRef.trim());
    }
    if (query.mode) {
      sql += ' AND mode = ?';
      params.push(query.mode);
    }
    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }
    if (query.court) {
      sql += ' AND court = ?';
      params.push(query.court.trim());
    }

    sql += ' ORDER BY received_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params) as StoredEvidenceRow[];
    return rows.map(row => {
      const actions = selectActionsByEvidenceId.all(row.id).map(a => ({
        action: a.action,
        by: a.actor,
        at: a.ts,
        note: a.note || undefined,
      }));
      return rowToItem(row, actions);
    });
  });

  // 5. Download Decrypted Evidence File GET /api/evidence/:id/file
  app.get('/api/evidence/:id/file', async (request, reply) => {
    authorize(request, EVIDENCE_ROLES);
    const { id } = request.params as { id: string };
    const row = selectEvidenceById.get(id);
    if (!row) throw new HttpError(404, 'EVIDENCE_NOT_FOUND');

    const encryptedData = await readFile(row.file_path);
    const decryptedData = decryptBuffer(encryptedData, encKey);

    reply.header('content-type', row.mime);
    reply.header('content-disposition', `inline; filename="${row.filename.replace(/"/g, '')}"`);
    return reply.send(decryptedData);
  });

  // 6. Action on Evidence POST /api/evidence/:id/action
  app.post('/api/evidence/:id/action', async (request) => {
    const session = authorize(request, EVIDENCE_ROLES, true);
    const { id } = request.params as { id: string };
    const body = request.body as { action: EvidenceStatus; note?: string };
    if (!body || !['seen', 'taken_on_record', 'shared_with_parties'].includes(body.action)) {
      throw new HttpError(400, 'INVALID_ACTION');
    }

    const row = selectEvidenceById.get(id);
    if (!row) throw new HttpError(404, 'EVIDENCE_NOT_FOUND');

    const action = body.action;
    const note = body.note?.trim() || null;
    const at = new Date().toISOString();

    db.transaction(() => {
      updateStatus.run(action, id);
      insertAction.run(id, action, session.id, at, note);
      appendEvidenceLog(db, id, session.id, action, { evidenceId: id, action, note, at });
      audit(db, session.id, `evidence.${action}`, { evidenceId: id, action, note });
    }).immediate();

    const updatedRow = selectEvidenceById.get(id)!;
    const actions = selectActionsByEvidenceId.all(id).map(a => ({
      action: a.action,
      by: a.actor,
      at: a.ts,
      note: a.note || undefined,
    }));
    return rowToItem(updatedRow, actions);
  });

  // 7. Re-verify Hash, Signature, and Chain Integrity GET /api/evidence/:id/verify
  app.get('/api/evidence/:id/verify', async (request) => {
    authorize(request, EVIDENCE_ROLES);
    const { id } = request.params as { id: string };
    const row = selectEvidenceById.get(id);
    if (!row) throw new HttpError(404, 'EVIDENCE_NOT_FOUND');

    const hybrid = readHybridReceipt(row.receipt);
    const isHybrid = signedPayloadKind(row.receipt) === evidenceReceiptV2;
    const sha3 = hybrid?.payload.sha3_256;
    // 1. Verify file hashes against the signed receipt and stored metadata.
    let hashMatch = false;
    try {
      const encryptedData = await readFile(row.file_path);
      const decryptedData = decryptBuffer(encryptedData, encKey);
      hashMatch = sha256(decryptedData) === row.sha256
        && (!isHybrid || (hybrid?.payload.sha256 === row.sha256 && sha3_256(decryptedData) === sha3));
    } catch {
      hashMatch = false;
    }

    // 2. Verify the signatures and their link to the recorded upload.
    let signatureValid = false;
    let signatures: EvidenceVerification['signatures'];
    let unknownSigner = false;
    let payloadHash: string | undefined;
    try {
      if (isHybrid) {
        signatures = { ed25519: false, mldsa65: false };
        if (hybrid) {
          const { payload } = hybrid;
          const key = payload.keyId === signer.keyId ? verificationKeys.get(payload.pqKeyId) : undefined;
          unknownSigner = !key;
          signatures = verifyHybrid(hybrid, key ?? edTrust);
          signatureValid = signatures.ed25519 && signatures.mldsa65
            && hybrid.signatures.ed25519 === row.receipt_signature
            && payload.id === row.id && payload.receivedAt === row.received_at && payload.sha256 === row.sha256
            && payload.caseRef === row.case_ref && payload.mode === row.mode && payload.mime === row.mime && payload.size === row.size;
          payloadHash = sha256(canonical(payload));
        }
      } else {
        const parsedReceipt = JSON.parse(row.receipt);
        const canonicalPayload = canonical(parsedReceipt.payload);
        const sigBuf = Buffer.from(row.receipt_signature, 'base64url');
        signatureValid = parsedReceipt.signature === row.receipt_signature
          && verify(null, Buffer.from(canonicalPayload), edSigner.publicKey, sigBuf);
        payloadHash = sha256(canonicalPayload);
      }
    } catch {
      signatureValid = false;
    }

    // 3. Verify hash chain integrity
    let chainValid = true;
    let previous = genesis;
    const logRows = db.prepare<[], EvidenceLogEntry>('SELECT * FROM evidence_log ORDER BY id').all();
    let foundEntry = false;
    for (const { hash, ...fields } of logRows) {
      if (fields.prev_hash !== previous || hash !== sha256(canonical(fields))) {
        chainValid = false;
        break;
      }
      if (fields.evidence_id === id && fields.action === 'received' && fields.payload_hash === payloadHash
        && hash === row.entry_hash && fields.prev_hash === row.prev_hash) foundEntry = true;
      previous = hash;
    }
    if (!foundEntry) chainValid = false;

    const res: EvidenceVerification & { signature?: 'unknown_signer' } = {
      valid: hashMatch && signatureValid && chainValid,
      sha256: row.sha256,
      ...(sha3 && { sha3_256: sha3 }),
      hashMatch,
      signatureValid,
      ...(unknownSigner && { signature: 'unknown_signer' as const }),
      ...(signatures && { signatures }),
      chainValid,
      entryHash: row.entry_hash,
      prevHash: row.prev_hash,
    };
    return res;
  });

  // 8. BSA s.63 Certificate GET /api/evidence/:id/certificate
  app.get('/api/evidence/:id/certificate', async (request, reply) => {
    authorize(request, EVIDENCE_ROLES);
    const { id } = request.params as { id: string };
    const query = request.query as { format?: string };
    const row = selectEvidenceById.get(id);
    if (!row) throw new HttpError(404, 'EVIDENCE_NOT_FOUND');

    const actions = selectActionsByEvidenceId.all(id).map(a => ({
      action: a.action,
      by: a.actor,
      at: a.ts,
      note: a.note || undefined,
    }));
    const item = rowToItem(row, actions);
    if (!item.sha3_256) {
      const bytes = decryptBuffer(await readFile(row.file_path), encKey);
      if (sha256(bytes) !== item.sha256) throw new HttpError(422, 'EVIDENCE_HASH_MISMATCH');
      item.sha3_256 = sha3_256(bytes);
    }
    const html = generateBsaCertificateHtml(item, signer.keyId, options.office || 'CourtPlus Evidence Vault');

    if (query.format === 'html' || request.headers.accept?.includes('text/html')) {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(html);
    }

    try {
      const pdf = await printDraft(html);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="bsa_s63_certificate_${id.slice(0, 8)}.pdf"`);
      return reply.send(pdf);
    } catch {
      // In environment without headless chromium, return the HTML
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(html);
    }
  });
}
