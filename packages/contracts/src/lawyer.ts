import type { Authority, Entity, ISODate } from './index.js';

export type Employment = 'permanent' | 'fixed-or-self-employed';

export type MactInput = {
  age: number;
  monthlyIncome: number;
  annualIncomeTax: number;
} & ({
  kind: 'fatal';
  employment: Employment;
  familyStatus: 'married' | 'unmarried' | 'unmarried-dependent-family';
  dependants: number;
  reviewedDeductionPercent?: number;
  consortiumClaimants: number;
  valuationOn: ISODate;
} | {
  kind: 'injury';
  functionalLossPercent: number;
  reviewedFutureProspectsPercent: number;
  monthsUnableToWork: number;
  treatment: number;
  futureMedical: number;
  pain: number;
  amenities: number;
  shortenedLife: number;
});

export interface MactStep {
  label: string;
  working: string;
  amount?: number;
  source?: Authority;
}

export interface MactResult {
  steps: MactStep[];
  total: number;
}

export interface ProceduralCheck {
  id: string;
  label: string;
  check: string;
  evidence: string;
  sources: Authority[];
}

export type ResearchResult<T> = { available: true; value: T } | { available: false };

export interface ResearchSentence {
  text: string;
  source: string;
}

export interface SectionHint {
  act: string;
  section: string;
  title: string;
  source: string;
  bns: { section: string; source: string; page: string; note: string }[];
}

export interface PrecedentReference {
  id: string;
  title: string;
  citation: string;
  year: number | null;
  court: string;
  url: string;
  paragraph: string;
}

export interface PastAward {
  precedent: PrecedentReference;
  amounts: number[];
  sentence: string;
  basis: 'lump sum' | 'monthly' | 'annual' | 'unclear';
}

export const CASE_ROLES = ['Facts', 'Issues', 'Arguments', 'Reasoning'] as const;
export const LAWYER_HINT = 'Hint - the judge decides';
export const PRECEDENT_LOADING = 'Precedent search loading - available after model install';

export interface CaseAnalysis {
  id: string;
  pages: number;
  ocr: boolean;
  nerAvailable: boolean;
  researchLimited: boolean;
  maskedText: string;
  entities: Pick<Entity, 'label' | 'text' | 'page'>[];
  checklist: ProceduralCheck[];
  summary: ResearchResult<ResearchSentence[]>;
  roles: ResearchResult<Record<typeof CASE_ROLES[number], ResearchSentence[]>>;
  sections: ResearchResult<SectionHint[]>;
  precedents: ResearchResult<PrecedentReference[]>;
}

export interface SettlementProposal {
  route: 'Lok Adalat' | 'Mediation';
  caseReference: string;
  parties: string;
  terms: string;
  deadlines: string;
}

export interface LawyerPdf {
  pdfPath: string;
  receiptPath: string;
  manifestPath: string;
}

export interface LawyerToolsApi {
  pastAwards(description: string): Promise<ResearchResult<PastAward[]>>;
  analyzeCase(file: { name: string; bytes: Uint8Array }): Promise<CaseAnalysis>;
  exportAnalysis(id: string, confirmedBy: string): Promise<LawyerPdf>;
  previewSettlement(proposal: SettlementProposal): Promise<string>;
  exportSettlement(proposal: SettlementProposal): Promise<LawyerPdf>;
}
