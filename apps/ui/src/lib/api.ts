import type { CourtPlusApi, DesktopPreloadApi, GuideAskInput } from '@courtplus/contracts';

export type WorkspaceApi = CourtPlusApi & Partial<DesktopPreloadApi> & { profileAvailable?: false };

// A standalone guide bridge has no workspace methods and may handle only a known screen.
interface GuideOnlyBridge {
  listPersons?: never;
  guideAsk?(input: GuideAskInput & { screenId: string }): ReturnType<DesktopPreloadApi['guideAsk']>;
  guideCancel?: DesktopPreloadApi['guideCancel'];
}

declare global {
  interface Window {
    courtplus?: WorkspaceApi | GuideOnlyBridge;
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
  'judgeDashboard',
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
    judgeDashboard: async (asOf = new Date().toISOString().slice(0, 10), judgeName) => ({
      asOf,
      totalJudges: 1,
      totalActiveCases: 12,
      totalDisposedCases: 18,
      benchClearanceRate: 150,
      stateNjdg10YearComparison: {
        district10YearPending: 5256293,
        chhattisgarh10YearPending: 1166,
        ratioToNational: 0.02,
      },
      judges: [{
        judgeName: judgeName ?? 'Hon. Bench Judge',
        courtRoom: 'Courtroom 1',
        court: 'Sessions Court',
        activeCases: 12,
        disposedCases: 18,
        totalFiled: 30,
        clearanceRate: 150,
        disposalVelocity: 12,
        avgCaseLifespanDays: 140,
        totalAdjournmentsGranted: 6,
        adjournmentRatio: 0.33,
        aging: { under1Year: 5, oneToThreeYears: 4, threeToFiveYears: 2, fiveToTenYears: 1, overTenYears: 0 },
        timeline: [
          { date: '2026-03-01', filed: 8, disposed: 10, clearanceRate: 125 },
          { date: '2026-03-08', filed: 10, disposed: 12, clearanceRate: 120 },
          { date: '2026-03-15', filed: 6, disposed: 9, clearanceRate: 150 },
          { date: '2026-03-22', filed: 6, disposed: 11, clearanceRate: 183 },
        ],
        byCaseType: { criminal: { pending: 8, disposed: 12 }, civil: { pending: 4, disposed: 6 } },
      }],
    }),
  };
}

export function getApi(): WorkspaceApi {
  const preload = typeof window === 'undefined' ? undefined : window.courtplus;
  if (preload?.listPersons) return preload;
  if (import.meta.env.DEV && !new URLSearchParams(window.location.search).has('http')) return createDevStub();
  return createHttpApi();
}
