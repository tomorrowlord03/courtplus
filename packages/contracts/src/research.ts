// Research engine, decision-support hints and their log (desktop). Every item is a hint with a
// source; nothing here predicts a verdict, an outcome or a probability of one.

/** Search input: plain words or a section ("IPC 302", "s.438 CrPC"), with optional filters. */
export interface PrecedentQuery {
  query: string;
  /** Number of results wanted (default 10, max 50). */
  k?: number;
  /** Case-insensitive substring of the court name, e.g. "Supreme Court", "Chhattisgarh". */
  court?: string;
  yearFrom?: number;
  yearTo?: number;
}

export interface PrecedentHit {
  id: string;
  title: string;
  /** Neutral citation or case number as published. */
  citation: string;
  year?: number;
  court: string;
  /** First part of the judgment text (or the best-matching passage). */
  snippet: string;
  /** Retrieval similarity, only for ordering. Not a measure of how a case will end. */
  score: number;
  /** Official source page of the judgment (eCourts judgments portal, Supreme Court website). */
  url?: string;
  /** Where the hit came from, e.g. "Precedent index (SC 2020-2026, CG HC 2025-2026)". */
  source: string;
  hint: true;
}

export interface PrecedentText {
  id: string;
  title: string;
  citation: string;
  /** Full text when the local index ships it; otherwise open `url`. */
  text?: string;
  url?: string;
  source: string;
}

export interface SectionSuggestion {
  act: string;
  section: string;
  label?: string;
  score: number;
  /** BNS section from the official IPC-BNS correspondence table, when a row exists. */
  bnsEquivalent?: string;
  /** Shown when there is no mapped BNS section. */
  bnsNote?: string;
  source: string;
  hint: true;
}

export interface RoleHint {
  sentence: string;
  /** Rhetorical role: facts, arguments, issue, ratio, precedent, statute, ruling or other. */
  role: string;
  score: number;
  source: string;
  hint: true;
}

/** `available: false` while the research package or its model files are not installed. */
export type HintResult<T> = { available: true; items: T[] } | { available: false; reason: string };

export interface ResearchStatus {
  available: boolean;
  reason?: string;
  /** Which functions the installed package provides. */
  features: { search: boolean; sections: boolean; roles: boolean; fullText: boolean };
}

export type HintKind = 'section' | 'precedent' | 'structure';

/** A judge's accept/dismiss of one hint. Logged to the audit chain. */
export interface HintDecision {
  caseId: string;
  kind: HintKind;
  /** Stable id of the hint, e.g. "section:IPC 379" or "precedent:<id>". */
  hintId: string;
  label: string;
  source: string;
  decision: 'accepted' | 'dismissed';
}

export interface ResearchApi {
  status(): Promise<ResearchStatus>;
  searchPrecedents(query: PrecedentQuery): Promise<HintResult<PrecedentHit>>;
  openPrecedent(id: string): Promise<PrecedentText | null>;
  suggestSections(text: string): Promise<HintResult<SectionSuggestion>>;
  classifyRoles(sentences: string[]): Promise<HintResult<RoleHint>>;
  logHint(decision: HintDecision): Promise<void>;
}

export const HINT_LABEL = 'Hint - the judge decides';
export const RESEARCH_INSTALLING = 'Precedent search is being installed';
