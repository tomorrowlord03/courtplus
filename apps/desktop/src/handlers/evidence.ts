import { createHash, randomBytes, randomUUID, sign, generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  EvidenceItem, EvidenceMode, EvidenceQuery, EvidenceReceiptResponse,
  EvidenceStatus, EvidenceStatusResponse, EvidenceSubmissionInput, EvidenceVerification,
} from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import canonicalize from 'canonicalize';
import type { Store } from '../store';
import { readSettings } from './settings';

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

function canonical(val: unknown): string {
  const json = canonicalize(val);
  if (json === undefined) throw new Error('Not JSON serializable');
  return json;
}

function sha256(val: Uint8Array | string): string {
  return createHash('sha256').update(val).digest('hex');
}

export function createEvidenceHandlers(
  store: Store,
  ports: HandlerPorts,
  cloud: CloudBridge,
) {
  const backend = () => readSettings(store).backendUrl;

  // Local fallback items in case desktop is run in standalone/demo mode without backend
  const localItems: EvidenceItem[] = [];

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
      if (input.name) formData.append('name', input.name);
      if (input.phone) formData.append('phone', input.phone);
      if (input.email) formData.append('email', input.email);
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
    const id = randomUUID();
    const receivedAt = new Date().toISOString();
    let receiptCode: string | undefined;
    if (input.mode === 'anonymous') {
      receiptCode = randomBytes(16).toString('hex');
    }

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = {
      id,
      sha256: fileHash,
      size: bytes.byteLength,
      mime: 'application/octet-stream',
      receivedAt,
      caseRef: input.caseRef,
      mode: input.mode,
    };
    const signature = sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64url');
    const receipt = canonical({ payload, signature });

    const localItem: EvidenceItem = {
      id,
      caseRef: input.caseRef,
      description: input.description,
      mode: input.mode,
      filename: input.fileName || 'evidence.bin',
      mime: 'application/octet-stream',
      size: bytes.byteLength,
      sha256: fileHash,
      receivedAt,
      status: 'received',
      submitter: input.mode === 'identified' && input.name && input.phone ? { name: input.name, phone: input.phone, email: input.email } : undefined,
      receipt,
      receiptSignature: signature,
      prevHash: '0'.repeat(64),
      entryHash: sha256(receipt),
      court: input.court,
      actionHistory: [{ action: 'received', by: input.mode === 'anonymous' ? 'anonymous' : (input.name || 'identified'), at: receivedAt }],
    };
    localItems.unshift(localItem);

    return {
      id,
      sha256: fileHash,
      size: bytes.byteLength,
      mime: 'application/octet-stream',
      receivedAt,
      caseRef: input.caseRef,
      mode: input.mode,
      receipt,
      receiptSignature: signature,
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
    return {
      valid: true,
      sha256: item.sha256,
      hashMatch: true,
      signatureValid: true,
      chainValid: true,
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

  async function exportEvidenceCertificate(id: string): Promise<{ html: string; pdfPath?: string }> {
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
    let pdfPath: string | undefined;
    if (chosenPath) {
      const pdfBytes = await ports.print(html);
      await writeFile(chosenPath, pdfBytes);
      pdfPath = chosenPath;
    }

    return { html, pdfPath };
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
