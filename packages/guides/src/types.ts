export interface LawRef {
  act: string;
  section: string;
  plain_meaning: string;
  source_url: string;
}

export interface Step {
  order: number;
  action_en: string;
  action_hi: string;
  where: string;
  deadline_or_limitation: string;
  documents_needed: string[];
}

export interface Helpline {
  name: string;
  number: string;
  description?: string;
}

export interface FreeLegalAid {
  eligible: string;
  how_to_apply: string;
  authority: string;
  helpline?: string;
}

export interface Guide {
  id: string;
  title_en: string;
  title_hi: string;
  keywords_en: string[];
  keywords_hi: string[];
  laws: LawRef[];
  steps: Step[];
  helplines: Helpline[];
  free_legal_aid: FreeLegalAid;
  when_to_see_a_lawyer: string[];
  last_checked: string;
  sources: string[];
  hi_reviewed: boolean;
}

export interface MatchResult {
  guide: Guide;
  score: number;
  matchedWords: string[];
}

export interface MatchOptions {
  limit?: number;
  minScore?: number;
}
