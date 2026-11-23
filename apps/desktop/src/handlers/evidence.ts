import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import type { HearingRecording } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import type {
  EvidenceItem, EvidenceMode, EvidenceQuery, EvidenceReceiptResponse,
  EvidenceStatus, EvidenceStatusResponse, EvidenceSubmissionInput, EvidenceVerification,
} from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { canonicalJson } from '../asr/receipt';
import type { Store } from '../store';
import { readSettings } from './settings';
import { readEvidenceReceipt, signEvidenceCertificate } from './verifier';

const signing: typeof import('@courtplus/export/signing', { with: { 'resolution-mode': 'import' } }) =
  require('@courtplus/export/signing');

// Citation: Bharatiya Sakshya Adhiniyam, 2023 (Act No. 47 of 2023), Section 63(4)(c) and THE SCHEDULE (Part A & Part B) [indiacode.nic.in]

interface HandlerPorts {
  resourceDirectory: string;
  boardChanged: () => void;
  folder: () => Promise<string | undefined>;
  savePath: (basename: string) => Promise<string | undefined>;
  print: (html: string) => Promise<Uint8Array>;
}

interface CloudBridge {
  token: () => string | undefined;
  status: () => { role?: string; expires?: number; error: string };
}

const sessions = new WeakMap<Store, CloudBridge>();
const signingKeys = new WeakMap<Store, (label: string) => Export.SigningKey>();

export function registerEvidenceSigning(store: Store, key: (label: string) => Export.SigningKey) {
  signingKeys.set(store, key);
}

export async function uploadHearingEvidence(
  store: Store, recording: Pick<HearingRecording, 'id' | 'audioSha256' | 'mime' | 'receipt'>,
  caseRef: string, readAudio: () => Promise<Uint8Array>, send?: typeof fetch,
): Promise<NonNullable<HearingRecording['upload']>> {
  const origin = readSettings(store).backendUrl;
  const cloud = sessions.get(store);
  const session = cloud?.status();
  const token = cloud?.token();
  if (!origin || !cloud || !token || !session?.expires || session.expires <= Date.now()
    || (session.role !== 'judge' && session.role !== 'admin')) return 'skipped';

  try {
    const bytes = await readAudio();
    if (origin !== readSettings(store).backendUrl || token !== cloud.token() || session.expires <= Date.now()) return 'skipped';
    const form = new FormData();
    form.set('file', new Blob([Buffer.from(bytes)], { type: recording.mime }), 'hearing-' + recording.id + '.webm');
    form.set('caseRef', caseRef);
    form.set('sha256', recording.audioSha256);
    if (recording.receipt) form.set('receipt', recording.receipt);
    const response = await (send ?? fetch)(origin + '/api/evidence/hearings', {
      method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form, redirect: 'error',
      signal: send ? undefined : AbortSignal.timeout(120_000),
    });
    return response.ok ? 'uploaded' : [401, 403, 404, 405, 501].includes(response.status) ? 'skipped' : 'failed';
  } catch {
    return 'failed';
  }
}

function sha256(val: Uint8Array | string): string {
  return createHash('sha256').update(val).digest('hex');
}

export function createEvidenceHandlers(
  store: Store,
  ports: HandlerPorts,
  cloud: CloudBridge,
) {
  sessions.set(store, cloud);
  const backend = () => readSettings(store).backendUrl;
  function signingKey() {
    const key = signingKeys.get(store);
    if (!key) throw new Error('The office signing key is unavailable.');
    return key(readSettings(store).issuer);
  }

  // Local fallback items in case desktop is run in standalone/demo mode without backend
  const localItems: EvidenceItem[] = [];
  const localSigners = new Map<string, Export.TrustEntry>();

  async function listEvidence(query: EvidenceQuery = {}): Promise<EvidenceItem[]> {
    const origin = backend();
    const token = cloud.token();
    if (origin) {
      try {
        const search = new URLSearchParams();
        if (query.caseRef) search.set('caseRef', query.caseRef);
        if (query.mode) search.set('mode', query.mode);
        if (query.status) search.set('status', query.status);
        if (query.court) search.set('court', query.court);

        const url = `${origin}/api/evidence${search.toString() ? '?' + search.toString() : ''}`;
        const res = await fetch(url, {
          headers: {
            ...(token && { authorization: 'Bearer ' + token }),
          },
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {}
    }

    // Filter local fallback items
    return localItems.filter(item => {
      if (query.caseRef && item.caseRef !== query.caseRef) return false;
      if (query.mode && item.mode !== query.mode) return false;
      if (query.status && item.status !== query.status) return false;
      return true;
    });
  }

  async function submitEvidence(input: EvidenceSubmissionInput): Promise<EvidenceReceiptResponse> {
    const origin = backend();
    let bytes: Uint8Array;
    if (typeof input.fileBytes === 'string') {
      bytes = Buffer.from(input.fileBytes, 'base64');
    } else {
      bytes = input.fileBytes;
    }

    if (origin) {
      const formData = new FormData();
      formData.append('file', new Blob([Buffer.from(bytes)]), input.fileName || 'evidence.bin');
      formData.append('caseRef', input.caseRef);
      formData.append('description', input.description);
      formData.append('mode', input.mode);
      if (input.mode === 'identified') {
        if (input.name) formData.append('name', input.name);
        if (input.phone) formData.append('phone', input.phone);
        if (input.email) formData.append('email', input.email);
      }
      if (input.court) formData.append('court', input.court);
      if (input.parentId) formData.append('parentId', input.parentId);

      const res = await fetch(`${origin}/evidence`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed with status ${res.status}`);
      }
      return await res.json();
    }

    // Local standalone offline handling
    const fileHash = sha256(bytes);
    const sha3_256 = signing.sha3_256(bytes);
    const id = randomUUID();
    const receivedAt = new Date().toISOString();
    let receiptCode: string | undefined;
    if (input.mode === 'anonymous') {
      receiptCode = randomBytes(16).toString('hex');
    }

    const key = signingKey();
    const payload = {
      kind: signing.evidenceReceiptV2,
      id,
      sha256: fileHash,
      sha3_256,
      size: bytes.byteLength,
      mime: 'application/octet-stream',
      receivedAt,
      caseRef: input.caseRef,
      mode: input.mode,
      keyId: key.keyId,
      pqKeyId: signing.requirePqKeyId(key),
    };
    const signed = signing.signHybrid(payload, key);
    const { ed25519: receiptSignature, mldsa65: pqSignature } = signed.signatures;
    const receipt = canonicalJson(signed);

    const localItem: EvidenceItem = {
      id,
      caseRef: input.caseRef,
      description: input.description,
      mode: input.mode,
      filename: input.fileName || 'evidence.bin',
      mime: 'application/octet-stream',
      size: bytes.byteLength,
      sha256: fileHash,
      sha3_256,
      receivedAt,
      status: 'received',
      submitter: input.mode === 'identified' && input.name && input.phone ? { name: input.name, phone: input.phone, email: input.email } : undefined,
      receipt,
      receiptSignature,
      pqSignature,
      prevHash: '0'.repeat(64),
      entryHash: sha256(receipt),
      court: input.court,
      actionHistory: [{ action: 'received', by: input.mode === 'anonymous' ? 'anonymous' : (input.name || 'identified'), at: receivedAt }],
    };
    localItems.unshift(localItem);
    localSigners.set(key.keyId, signing.exportPublicKey(key));

    return {
      id,
      sha256: fileHash,
      sha3_256,
      size: bytes.byteLength,
      mime: 'application/octet-stream',
      receivedAt,
      caseRef: input.caseRef,
      mode: input.mode,
      receipt,
      receiptSignature,
      pqSignature,
      receiptCode,
      entryHash: localItem.entryHash,
      prevHash: localItem.prevHash,
    };
  }

  async function checkEvidenceStatus(code: string): Promise<EvidenceStatusResponse> {
    const origin = backend();
    if (!origin) {
      throw new Error('Configure backend URL in Settings to check status from server.');
    }
    const res = await fetch(`${origin}/evidence/status/${encodeURIComponent(code.trim())}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Receipt code not found');
      throw new Error(`Status check failed (${res.status})`);
    }
    return await res.json();
  }

  async function updateEvidenceAction(id: string, action: EvidenceStatus, note?: string): Promise<EvidenceItem> {
    const origin = backend();
    const token = cloud.token();
    if (origin) {
      const res = await fetch(`${origin}/api/evidence/${id}/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: 'Bearer ' + token }),
        },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        throw new Error(`Action update failed (${res.status})`);
      }
      return await res.json();
    }

    const item = localItems.find(i => i.id === id);
    if (!item) throw new Error('Evidence item not found');
    item.status = action;
    item.actionHistory = item.actionHistory || [];
    item.actionHistory.push({ action, by: 'desktop_judge', at: new Date().toISOString(), note });
    return item;
  }

  async function verifyEvidence(id: string): Promise<EvidenceVerification> {
    const origin = backend();
    const token = cloud.token();
    if (origin) {
      const res = await fetch(`${origin}/api/evidence/${id}/verify`, {
        headers: {
          ...(token && { authorization: 'Bearer ' + token }),
        },
      });
      if (!res.ok) throw new Error(`Verification failed (${res.status})`);
      return await res.json();
    }

    const item = localItems.find(i => i.id === id);
    if (!item) throw new Error('Evidence item not found');
    const receipt = readEvidenceReceipt(item.receipt);
    const key = receipt && localSigners.get(receipt.payload.keyId);
    const signatures = receipt && key ? signing.verifyHybrid(receipt, key) : { ed25519: false, mldsa65: false };
    const signatureValid = signatures.ed25519 && signatures.mldsa65;
    const hashMatch = !!receipt && receipt.payload.sha256 === item.sha256 && receipt.payload.sha3_256 === item.sha3_256;
    const chainValid = sha256(item.receipt) === item.entryHash;
    return {
      valid: hashMatch && signatureValid && chainValid,
      sha256: item.sha256,
      sha3_256: item.sha3_256,
      hashMatch,
      signatureValid,
      signatures,
      chainValid,
      entryHash: item.entryHash,
      prevHash: item.prevHash,
    };
  }

  async function getEvidenceFile(id: string): Promise<{ data: string; mime: string; filename: string }> {
    const origin = backend();
    const token = cloud.token();
    if (!origin) throw new Error('Backend origin not configured');

    const res = await fetch(`${origin}/api/evidence/${id}/file`, {
      headers: {
        ...(token && { authorization: 'Bearer ' + token }),
      },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);

    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? match[1] : 'evidence.bin';

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return { data: base64, mime, filename };
  }

  async function exportEvidenceCertificate(id: string): Promise<{ html: string; pdfPath?: string; receiptPath?: string }> {
    const origin = backend();
    const token = cloud.token();
    if (!origin) throw new Error('Backend origin not configured');

    const res = await fetch(`${origin}/api/evidence/${id}/certificate?format=html`, {
      headers: {
        ...(token && { authorization: 'Bearer ' + token }),
      },
    });
    if (!res.ok) throw new Error(`Certificate generation failed (${res.status})`);
    const html = await res.text();

    const chosenPath = await ports.savePath(`bsa_s63_certificate_${id.slice(0, 8)}.pdf`);
    if (!chosenPath) return { html };
    const pdfBytes = await ports.print(html);
    const receipt = signEvidenceCertificate(pdfBytes, id, signingKey());
    const receiptPath = chosenPath + '.' + randomUUID().slice(0, 8) + '.receipt.json';
    await writeFile(receiptPath, receipt, { flag: 'wx' });
    try {
      await writeFile(chosenPath, pdfBytes);
    } catch (error) {
      await rm(receiptPath, { force: true });
      throw error;
    }
    return { html, pdfPath: chosenPath, receiptPath };
  }

  return {
    listEvidence,
    submitEvidence,
    checkEvidenceStatus,
    updateEvidenceAction,
    verifyEvidence,
    getEvidenceFile,
    exportEvidenceCertificate,
  };
}
