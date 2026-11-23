import type { Authority, CaseTier, ISODate } from './index.js';

export interface Hearing {
  caseId: string;
  date: ISODate;
  purpose: string;
  outcome: 'heard' | 'adjourned' | 'disposed';
  adjournedBy?: string;
  reasonText?: string;
  requestedDays?: number;
  grantedDays?: number;
}

export interface CaseMeta {
  caseId: string;
  caseType: 'criminal' | 'civil' | 'family' | 'MACT' | 'cheque' | 'other';
  filedOn: ISODate;
  stage: string;
  partiesInCustody: boolean;
  partyFlags: ('seniorCitizen' | 'woman' | 'child' | 'disability' | 'undertrial')[];
  nationalSecurity: boolean;
  disposedOn?: ISODate;
}

export interface PriorityOverride {
  caseId: string;
  direction: 'up' | 'down' | 'clear';
  reason: string;
}

export interface TriageFactor {
  label: string;
  weight: number;
  points: number;
  reason: string;
  sources: Authority[];
}

export interface TriageRank {
  meta: CaseMeta;
  tier: CaseTier;
  score: number;
  factors: TriageFactor[];
  override?: PriorityOverride;
}

export interface CourtSettings {
  capacity: number;
  oldestShare: number;
  minimumPreparationDays: number;
}

export interface CauseList {
  date: ISODate;
  capacity: number;
  confirmed: boolean;
  entries: { caseId: string; basis: 'adjournment' | 'oldest' | 'priority'; score?: number }[];
}

export interface AdjournmentRequest {
  caseId: string;
  party: string;
  date: ISODate;
  requestedDays: number;
  procedure: 'cpc' | 'bnss' | 'other';
}

export interface AdjournmentDecision extends AdjournmentRequest {
  nextOn: ISODate;
  purpose: string;
  reason: string;
}

export interface AdjournmentSummary {
  party?: string;
  count: number;
  daysLost: number;
  unknownDays: number;
}

export interface AdjournmentAdvice {
  history: AdjournmentSummary[];
  pattern: string;
  legalNote: string;
  authority?: Authority;
  workload: { date: ISODate; available: number }[];
  suggestion?: { date: ISODate; days: number };
  reason: string;
}

export interface CourtBacklog {
  weeks: { start: ISODate; filed: number; disposed: number }[];
  age: { label: string; count: number }[];
}

export interface CourtWorkspace {
  settings: CourtSettings;
  cases: { id: string; label: string; orderDates: ISODate[]; disposed: boolean; adjournments: AdjournmentSummary[] }[];
  metadata: CaseMeta[];
  hearings: Hearing[];
  ranked: TriageRank[];
  causeList: CauseList;
  backlog: CourtBacklog;
  advice?: AdjournmentAdvice;
  exported?: string;
}

export type CourtAction =
  | { kind: 'read' }
  | { kind: 'meta'; meta: CaseMeta }
  | { kind: 'hearing'; hearing: Hearing; fromOrder: boolean }
  | { kind: 'override'; override: PriorityOverride }
  | { kind: 'settings'; settings: CourtSettings }
  | { kind: 'confirmCauseList'; entries: CauseList['entries']; capacity: number }
  | { kind: 'pdf' }
  | { kind: 'advice'; request: AdjournmentRequest }
  | { kind: 'decision'; decision: AdjournmentDecision };

export interface CourtWorkspaceApi {
  courtWorkspace(date: ISODate, action: CourtAction): Promise<CourtWorkspace>;
}

// Judge Performance & Backlog Dashboard
export interface AgingBucket {
  under1Year: number;
  oneToThreeYears: number;
  threeToFiveYears: number;
  fiveToTenYears: number;
  overTenYears: number; // NJDG critical backlog category (>10 years)
}

export interface DailyRatePoint {
  date: ISODate;
  filed: number;
  disposed: number;
  clearanceRate: number; // (disposed / filed) * 100
}

export interface JudgeMetric {
  judgeName: string;
  courtRoom?: string;
  court?: string;
  activeCases: number;
  disposedCases: number;
  totalFiled: number;
  clearanceRate: number; // percentage (disposed / totalFiled) * 100
  disposalVelocity: number; // average cases disposed per sitting cycle
  avgCaseLifespanDays: number;
  totalAdjournmentsGranted: number;
  adjournmentRatio: number; // adjournments / disposed
  aging: AgingBucket;
  timeline: DailyRatePoint[];
  weeks?: CourtBacklog['weeks'];
  byCaseType: Record<string, { pending: number; disposed: number }>;
}

export interface BenchBacklogSummary {
  asOf: ISODate;
  totalJudges: number;
  totalActiveCases: number;
  totalDisposedCases: number;
  benchClearanceRate: number;
  stateNjdg10YearComparison: {
    district10YearPending: number;
    chhattisgarh10YearPending: number;
    ratioToNational: number;
  };
  judges: JudgeMetric[];
}
