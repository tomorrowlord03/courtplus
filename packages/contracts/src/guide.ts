import type { DesktopWorkspaceApi } from './index.js';

export interface GuideAskInput {
  question: string;
  screenId?: string;
  lang: 'en' | 'hi';
  passages: { id: string; title: string; text: string }[];
}

export interface GuideAskResult {
  answer: string;
  usedPassageIds: string[];
  mode: 'llm' | 'search';
}

export interface DesktopPreloadApi extends DesktopWorkspaceApi {
  guideAsk(input: GuideAskInput): Promise<GuideAskResult>;
  guideCancel(): Promise<void>;
}
