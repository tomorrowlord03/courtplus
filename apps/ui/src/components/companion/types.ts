export interface LocalizedString {
  en: string;
  hi: string;
  [lang: string]: string;
}

export interface ScreenHelp {
  id: string;
  route: string;
  roles: string[];
  name: LocalizedString;
  what: LocalizedString;
  when: LocalizedString;
  start?: LocalizedString;
  steps: LocalizedString[];
}

export interface ScreenHelpData {
  screens: ScreenHelp[];
}

export interface GuidePassage {
  id: string;
  title: string;
  text: string;
}

export interface GuideAskParams {
  question: string;
  screenId: string;
  lang: string;
  passages: GuidePassage[];
}

export interface GuideAskResult {
  answer: string;
  usedPassageIds: string[];
  mode: 'llm' | 'search';
}

export type AvatarState = 'idle' | 'thinking' | 'talking';

export type DemoSpeed = 'normal' | 'fast';

export interface DemoStep {
  screenId: string;
  route: string;
  selector: string;
  fallbackSelector?: string;
  stepTitle: string;
  kind: 'what' | 'when' | 'start' | 'step';
  stepIndex: number; // 0-based
  scriptedText: string;
  passages: GuidePassage[];
}

export interface DemoState {
  isActive: boolean;
  isPaused: boolean;
  speed: DemoSpeed;
  lang: string;
  currentStepIndex: number;
  totalSteps: number;
  steps: DemoStep[];
  currentStep: DemoStep | null;
  narrationText: string;
  avatarState: AvatarState;
  displayedText: string;
  fullDemo: boolean;
}
