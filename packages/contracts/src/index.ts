export type ISODate = string; // 'YYYY-MM-DD', civil date, Asia/Kolkata
export type Tri = 'yes' | 'no' | 'unknown';

export interface SourceRef { docId: string; page?: number; quote?: string; verifiedBy?: string; verifiedAt?: string }

export interface Charge {
  act: 'IPC' | 'BNS' | 'NDPS' | 'UAPA' | 'PMLA' | 'POCSO' | 'PC_ACT' | 'ARMS' | 'EXCISE' | 'OTHER';
  section: string; subsection?: string; variant?: string;
  stage: 'FIR' | 'FRAMED';
  verified: boolean;            // FRAMED counts only when verified === true
  source?: SourceRef;
}

export interface CustodySpell {
  kind: 'police' | 'judicial' | 'interim_bail' | 'accused_delay';
  start: ISODate; end?: ISODate; ongoing?: boolean; source?: SourceRef;
}

export interface CourtEvent { on: ISODate; kind: 'remand' | 'chargesheet' | 'framing' | 'bail_granted' | 'bail_rejected' | 'acquitted' | 'convicted' | 'released' | 'hearing' | 'other'; note?: string; source?: SourceRef }

export interface CaseRecord {
  id: string; personId: string; cnr?: string; caseNo?: string; court?: string; policeStation?: string;
  orderDate?: ISODate;           // for retrospective screening of real orders
  charges: Charge[]; custody: CustodySpell[]; events: CourtEvent[];
  firstRemandOn?: ISODate; chargesheetOn?: ISODate; defaultBailAppliedOn?: ISODate;
  readyToFurnishBail?: Tri; bailGrantedOn?: ISODate; releasedOn?: ISODate;
  pendingStatus: 'investigation' | 'inquiry' | 'trial' | 'appeal' | 'disposed';
}

export interface Person {
  id: string; alias: string;      // always an anonymised alias, e.g. 'Accused-07'
  prisonerType: 'undertrial' | 'convict_appellant';
  priorConviction: Tri; otherHolds: Tri; ageOver70?: Tri; woman?: Tri; juvenileClaim?: Tri; mentalIllness?: Tri;
  caseIds: string[];
}

export type Status = 'APPLY_NOW' | 'DUE_IN_N_DAYS' | 'NEEDS_LAWYER_REVIEW' | 'OUTSIDE_SCREEN';

export interface Authority { act: string; section: string; text: string; url: string }
export interface TraceStep { id: string; label: string; inputs: Record<string, unknown>; operation: string; result: string; authority?: Authority[]; warnings?: string[] }

export interface Alert {
  kind: 'DEFAULT_BAIL_CHECK' | 'S478_INDIGENCE' | 'POST_BAIL_7_DAYS' | 'POST_BAIL_1_MONTH' | 'POLICE_CUSTODY_OVER_15' | 'POLICE_CUSTODY_OUTSIDE_WINDOW'
      | 'COURT_JAIL_MISMATCH' | 'NO_COURT_UPDATE_180' | 'POOR_PRISONERS_REFERRAL' | 'POOR_PRISONERS_EXCLUDED' | 'POOR_PRISONERS_DISCRETION';
  message: string; dueOn?: ISODate; authority?: Authority[];
}

export interface ScreeningResult {
  personId: string; caseId: string; asOf: ISODate; ruleVersion: string; dayConvention: string;
  status: Status; dueInDays?: number; thresholdFraction?: '1/3' | '1/2'; thresholdDate?: ISODate;
  maxTermDays?: number; rawCustodyDays: number; countedCustodyDays: number;
  ceilingUrgent: boolean; reasons: string[]; alerts: Alert[];
  nalsaCategories: number[];      // 1..16 per NALSA revised UTRC SOP
  antilCategory?: 'A' | 'B' | 'C' | 'D';
  trace: TraceStep[];
}

// engine (packages/engine)
export type ScreenFn = (person: Person, cases: CaseRecord[], caseId: string, asOf: ISODate) => ScreeningResult;
export type PoliceCustodyCheckFn = (c: CaseRecord, maxTermDays: number) => { policeDays: number; windowDays: 40 | 60; withinWindow: boolean; alerts: Alert[] };
export type LookupOffenceFn = (act: string, section: string, subsection?: string) => { maxDays?: number; maxText: string; minYears?: number; death: boolean; life: boolean; bnsEquivalent?: string; source: string } | null;

// NER suggestions (packages/intake)
export interface Entity { label: 'COURT'|'PETITIONER'|'RESPONDENT'|'JUDGE'|'LAWYER'|'DATE'|'ORG'|'GPE'|'STATUTE'|'PROVISION'|'PRECEDENT'|'CASE_NUMBER'|'WITNESS'|'OTHER_PERSON'; text: string; start: number; end: number; score: number; page?: number }
export interface FieldSuggestion { field: string; value: string; entity?: Entity; sentence: string; page?: number; confidence: number }

// Board
export type Lane = 'APPLY_NOW' | 'DUE_30' | 'LAWYER_REVIEW' | 'BAIL_NOT_RELEASED' | 'COURT_JAIL_MISMATCH' | 'NO_UPDATE_180';
export interface Card { id: string; lane: Lane; personId: string; caseId: string; title: string; owner?: string; dueOn?: ISODate; state: 'open'|'assigned'|'order_verified'|'jail_acknowledged'|'holds_checked'|'closed'; tags: string[] }

// IPC / HTTP API (same shape for Electron preload and the appliance REST server)
export interface CourtPlusApi {
  listPersons(): Promise<Person[]>; listCases(): Promise<CaseRecord[]>;
  importOrder(file: { name: string; bytes: Uint8Array }): Promise<{ docId: string; text: string; pages: number; ocr: boolean; entities: Entity[]; suggestions: FieldSuggestion[]; redactedText: string }>;
  saveCase(p: Person, c: CaseRecord): Promise<void>;
  screen(caseId: string, asOf: ISODate): Promise<ScreeningResult>;
  board(asOf: ISODate): Promise<Card[]>; updateCard(id: string, patch: Partial<Card>): Promise<Card>;
  exportDraft(kind: 'S479_3_APPLICATION'|'DLSA_7_DAY'|'AI_ASSISTANCE_NOTE'|'RIGHTS_CARD', caseId: string, lang: string): Promise<{ pdfPath: string; receiptPath: string; manifestPath: string }>;
  exportScReturn(asOf: ISODate, format: 'xlsx'|'csv'): Promise<string>;
  verify(bundle: { pdf: Uint8Array; receipt: string; manifest: string }): Promise<{ signature: 'valid'|'invalid'|'unknown_signer'; pdf: 'unchanged'|'changed'; chain: 'intact'|'mismatch'|'not_checked' }>;
  stats(): Promise<unknown>;
  role(): Promise<'legal_aid'|'utrc'|'superintendent'|'dlsa'>;
}

export interface Profile {
  fullName: string;
  role: 'judge' | 'utrc_member' | 'jail_superintendent' | 'dlsa' | 'legal_aid_lawyer';
  office: string;
  district: string;
  designation: string;
  language: string;
  employeeId?: string;
  email?: string;
}

export interface DashboardActivity {
  savedCases: { caseId: string; on: ISODate }[];
  closedCards: { cardId: string; caseId: string; on?: ISODate }[];
}

export interface DesktopWorkspaceApi extends CourtPlusApi {
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  clearProfile(): Promise<void>;
  dashboardActivity(): Promise<DashboardActivity>;
  previewDraft(...args: Parameters<CourtPlusApi['exportDraft']>): Promise<string>;
}

export * from './evidence.js';

export * from './court.js';
export * from './hearing.js';
export * from './lawyer.js';
