import type { CourtPlusApi, DesktopWorkspaceApi } from '@courtplus/contracts';

export type WorkspaceApi = CourtPlusApi & Partial<DesktopWorkspaceApi> & { profileAvailable?: false };

declare global {
  interface Window {
    courtplus?: WorkspaceApi;
  }
}

// The desktop preload exposes the evidence bridge; the web build has none.
export type EvidenceBridge = {
  verifier?: boolean;
  evidenceList?: (query: unknown) => Promise<import('@courtplus/contracts').EvidenceItem[]>;
  evidenceSubmit?: (data: unknown) => Promise<import('@courtplus/contracts').EvidenceReceiptResponse>;
  evidenceStatus?: (code: string) => Promise<import('@courtplus/contracts').EvidenceStatusResponse>;
  evidenceAction?: (id: string, action: string, note?: string) => Promise<import('@courtplus/contracts').EvidenceItem>;
  evidenceVerify?: (id: string) => Promise<import('@courtplus/contracts').EvidenceVerification>;
  evidenceFile?: (id: string) => Promise<{ data: string; mime: string; filename: string }>;
  evidenceCertificate?: (id: string) => Promise<{ html: string; pdfPath?: string }>;
  [key: string]: unknown;
};

export function evidenceBridge(): EvidenceBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { courtplusDesktop?: EvidenceBridge }).courtplusDesktop;
}

const METHODS = [
  'listPersons', 'listCases', 'importOrder', 'saveCase', 'screen', 'board', 'updateCard',
  'exportDraft', 'exportScReturn', 'verify', 'stats', 'role',
] as const;

// Uint8Array does not survive JSON; send base64 and let the server decode it.
function encodeArg(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    let s = '';
    v.forEach((b) => (s += String.fromCharCode(b)));
    return { $base64: btoa(s) };
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeArg(x)]));
  }
  return v;
}

export function createHttpApi(base = '/api'): WorkspaceApi {
  const api: Record<string, unknown> = {};
  for (const m of METHODS) {
    api[m] = async (...args: unknown[]) => {
      const res = await fetch(`${base}/${m}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args.map(encodeArg)),
      });
      if (!res.ok) throw new Error(`${m} failed (${res.status})`);
      const text = await res.text();
      return text ? JSON.parse(text) : undefined;
    };
  }
  return Object.assign(api as unknown as CourtPlusApi, {
    profileAvailable: false as const,
    getProfile: async () => null,
    saveProfile: async () => { throw new Error('Profiles can be saved in the desktop app.'); },
  });
}

// Development-only stub: empty lists, no people, no cases.
export function createDevStub(): CourtPlusApi {
  const none = (what: string) => Promise.reject(new Error(`${what}: no backend connected`));
  return {
    listPersons: async () => [],
    listCases: async () => [],
    importOrder: () => none('Import'),
    saveCase: async () => undefined,
    screen: () => none('Screening'),
    board: async () => [],
    updateCard: () => none('Card update'),
    exportDraft: () => none('Export'),
    exportScReturn: () => none('Export'),
    verify: () => none('Verify'),
    stats: async () => null,
    role: async () => 'legal_aid',
  };
}

export function getApi(): WorkspaceApi {
  if (typeof window !== 'undefined' && window.courtplus) return window.courtplus;
  if (import.meta.env.DEV && !new URLSearchParams(window.location.search).has('http')) return createDevStub();
  return createHttpApi();
}
