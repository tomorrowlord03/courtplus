export type EvidenceMode = 'identified' | 'anonymous';

export type EvidenceStatus = 'received' | 'seen' | 'taken_on_record' | 'shared_with_parties';

export interface SubmitterInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface EvidenceActionEntry {
  action: EvidenceStatus;
  by: string;
  at: string;
  note?: string;
}

export interface EvidenceItem {
  id: string;
  caseRef: string;
  description: string;
  mode: EvidenceMode;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  sha3_256?: string;
  receivedAt: string;
  status: EvidenceStatus;
  submitter?: SubmitterInfo;
  receipt: string;
  receiptSignature: string;
  pqSignature?: string;
  prevHash: string;
  entryHash: string;
  court?: string;
  parentId?: string;
  actionHistory?: EvidenceActionEntry[];
}

export interface EvidenceReceiptPayload {
  id: string;
  sha256: string;
  sha3_256?: string;
  size: number;
  mime: string;
  receivedAt: string;
  caseRef: string;
  mode: EvidenceMode;
}

export interface EvidenceReceiptResponse {
  id: string;
  sha256: string;
  sha3_256?: string;
  size: number;
  mime: string;
  receivedAt: string;
  caseRef: string;
  mode: EvidenceMode;
  receipt: string;
  receiptSignature: string;
  pqSignature?: string;
  receiptCode?: string;
  entryHash: string;
  prevHash: string;
}

export interface EvidenceStatusResponse {
  id: string;
  status: EvidenceStatus;
  caseRef: string;
  receivedAt: string;
  sha256: string;
  sha3_256?: string;
  description?: string;
}

export interface EvidenceQuery {
  court?: string;
  caseRef?: string;
  mode?: EvidenceMode;
  status?: EvidenceStatus;
}

export interface EvidenceVerification {
  valid: boolean;
  sha256: string;
  sha3_256?: string;
  hashMatch: boolean;
  signatureValid: boolean;
  signatures?: { ed25519: boolean; mldsa65: boolean };
  chainValid: boolean;
  entryHash: string;
  prevHash: string;
}

export interface EvidenceSubmissionInput {
  caseRef: string;
  description: string;
  mode: EvidenceMode;
  name?: string;
  phone?: string;
  email?: string;
  fileBytes: Uint8Array | string; // binary or base64
  fileName: string;
  court?: string;
  parentId?: string;
}
