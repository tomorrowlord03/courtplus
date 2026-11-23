import type { DemoSpeed, DemoState, DemoStep, GuideAskParams, GuideAskResult, GuidePassage, ScreenHelp } from './types';
import { getStoredSpeed, isCompanionEnabled, registerDemoStop, setStoredSpeed } from './store';

let activeNavigator: ((to: string) => void) | null = null;
let customScreens: ScreenHelp[] | null = null;
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let wordInterval: ReturnType<typeof setInterval> | null = null;
let stepRun = 0;
const narrationCache = new Map<number, Promise<string>>();

const listeners = new Set<(state: DemoState) => void>();

let demoState: DemoState = {
  isActive: false,
  isPaused: false,
  speed: getStoredSpeed(),
  lang: 'en',
  currentStepIndex: 0,
  totalSteps: 0,
  steps: [],
  currentStep: null,
  narrationText: '',
  avatarState: 'idle',
  displayedText: '',
  fullDemo: false,
};

export function registerNavigator(nav: (to: string) => void): () => void {
  activeNavigator = nav;
  return () => {
    if (activeNavigator === nav) activeNavigator = null;
  };
}

export function setCustomScreens(screens: ScreenHelp[] | null): void {
  customScreens = screens;
}

export function getCustomScreens(): ScreenHelp[] | null {
  return customScreens;
}

export function getDemoState(): DemoState {
  return demoState;
}

function notify(): void {
  for (const listener of listeners) {
    listener(demoState);
  }
}

export function subscribeDemoState(listener: (state: DemoState) => void): () => void {
  listeners.add(listener);
  listener(demoState);
  return () => {
    listeners.delete(listener);
  };
}

function clearAllTimers(): void {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  if (wordInterval) {
    clearInterval(wordInterval);
    wordInterval = null;
  }
}

function removeTargetHighlights(): void {
  if (typeof document === 'undefined') return;
  const elements = document.querySelectorAll('[data-companion-target="true"]');
  elements.forEach(el => el.removeAttribute('data-companion-target'));
}

export function findDemoTarget(selector: string, fallbackSelector?: string): Element | null {
  if (typeof document === 'undefined') return null;
  try {
    if (!fallbackSelector) return document.querySelector(selector);
    const intro = document.querySelector(fallbackSelector);
    return (intro?.closest('.page') ?? intro)?.querySelector(selector) ?? intro;
  } catch {
    return null;
  }
}

export function highlightTarget(selector: string, fallbackSelector?: string): void {
  if (typeof document === 'undefined') return;
  removeTargetHighlights();
  findDemoTarget(selector, fallbackSelector)?.setAttribute('data-companion-target', 'true');
}

export function buildDemoSteps(
  screens: ScreenHelp[],
  role?: string,
  fullDemo = false,
  lang = 'en'
): DemoStep[] {
  let filtered = screens;
  if (!fullDemo && role) {
    filtered = screens.filter(s => {
      if (!s.roles || s.roles.length === 0 || s.roles.includes('all')) return true;
      return s.roles.includes(role);
    });
    if (filtered.length === 0) filtered = screens;
  }

  const steps: DemoStep[] = [];
  let globalIndex = 0;

  for (const screen of filtered) {
    const passages: GuidePassage[] = [
      { id: `${screen.id}-what`, title: 'What', text: screen.what?.[lang] || screen.what?.en || '' },
      { id: `${screen.id}-when`, title: 'When', text: screen.when?.[lang] || screen.when?.en || '' },
      ...(screen.start ? [{ id: `${screen.id}-start`, title: 'Start', text: screen.start?.[lang] || screen.start?.en || '' }] : []),
      ...(screen.steps || []).map((step, idx) => ({
        id: `${screen.id}-step-${idx + 1}`,
        title: `Step ${idx + 1}`,
        text: step?.[lang] || step?.en || '',
      })),
    ];

    const screenTitle = screen.name?.[lang] || screen.name?.en || screen.id;
    const introSelector = `[data-guide-screen="${screen.id === 'judge-dashboard' ? 'dashboard' : screen.id}"]`;

    // Substep 1: what
    steps.push({
      screenId: screen.id,
      route: screen.route,
      selector: introSelector,
      stepTitle: screenTitle,
      kind: 'what',
      stepIndex: globalIndex++,
      scriptedText: screen.what?.[lang] || screen.what?.en || '',
      passages,
    });

    // Substep 2: when
    steps.push({
      screenId: screen.id,
      route: screen.route,
      selector: introSelector,
      stepTitle: screenTitle,
      kind: 'when',
      stepIndex: globalIndex++,
      scriptedText: screen.when?.[lang] || screen.when?.en || '',
      passages,
    });

    // Substep 3: start (if provided)
    if (screen.start && (screen.start[lang] || screen.start.en)) {
      steps.push({
        screenId: screen.id,
        route: screen.route,
        selector: '[data-guide="start"]',
        fallbackSelector: introSelector,
        stepTitle: screenTitle,
        kind: 'start',
        stepIndex: globalIndex++,
        scriptedText: screen.start[lang] || screen.start.en,
        passages,
      });
    }

    // Substeps 4..N: steps
    if (screen.steps && screen.steps.length > 0) {
      for (const step of screen.steps) {
        steps.push({
          screenId: screen.id,
          route: screen.route,
          selector: '[data-guide="start"]',
          fallbackSelector: introSelector,
          stepTitle: screenTitle,
          kind: 'step',
          stepIndex: globalIndex++,
          scriptedText: step[lang] || step.en,
          passages,
        });
      }
    }
  }

  return steps;
}

type GuideBridge = {
  guideAsk?: (params: GuideAskParams) => Promise<GuideAskResult>;
  guideCancel?: () => Promise<void>;
};

function getGuideBridge(): GuideBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { courtplus?: GuideBridge }).courtplus;
}

export function fetchNarration(
  stepIndex: number,
  steps: DemoStep[],
  lang: string
): Promise<string> {
  if (stepIndex < 0 || stepIndex >= steps.length) {
    return Promise.resolve('');
  }

  const existing = narrationCache.get(stepIndex);
  if (existing) return existing;

  const step = steps[stepIndex];

  // If companion is disabled, never call guideAsk
  if (!isCompanionEnabled()) {
    const res = Promise.resolve(step.scriptedText);
    narrationCache.set(stepIndex, res);
    return res;
  }

  const guideAsk = getGuideBridge()?.guideAsk;

  // If guideAsk is missing on window, return scripted text at once
  if (!guideAsk) {
    const res = Promise.resolve(step.scriptedText);
    narrationCache.set(stepIndex, res);
    return res;
  }

  // Call guideAsk with 4s timeout fallback
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<string>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('guideAsk timeout')), 4000);
  });

  const askPromise = guideAsk({
    question: 'Explain this step to a first-time user in one or two friendly sentences',
    screenId: step.screenId,
    lang,
    passages: step.passages,
  })
    .then((result: GuideAskResult) => {
      clearTimeout(timeoutId);
      if (result && typeof result.answer === 'string' && result.answer.trim()) {
        return result.answer.trim();
      }
      return step.scriptedText;
    })
    .catch(() => {
      clearTimeout(timeoutId);
      return step.scriptedText;
    });

  const safePromise = Promise.race([askPromise, timeoutPromise]).catch(() => {
    clearTimeout(timeoutId);
    return step.scriptedText;
  });

  narrationCache.set(stepIndex, safePromise);
  return safePromise;
}

export async function executeStep(index: number): Promise<void> {
  if (!isCompanionEnabled()) {
    stopDemo();
    return;
  }
  if (!demoState.isActive) return;
  clearAllTimers();

  if (index < 0 || index >= demoState.steps.length) {
    stopDemo();
    return;
  }

  const step = demoState.steps[index];
  const { lang } = demoState;
  const run = ++stepRun;

  // Navigate with router
  if (activeNavigator && step.route) {
    try {
      activeNavigator(step.route);
    } catch {
      // Ignore navigation errors
    }
  }

  highlightTarget(step.selector, step.fallbackSelector);

  // Prefetch next step narration while current one plays
  if (index + 1 < demoState.steps.length) {
    void fetchNarration(index + 1, demoState.steps, lang);
  }

  // Update state to thinking while waiting for model
  demoState = {
    ...demoState,
    currentStepIndex: index,
    currentStep: step,
    avatarState: 'thinking',
    narrationText: '',
    displayedText: '',
  };
  notify();

  // Retrieve current step narration (resolved or waiting up to 4s)
  const narration = await fetchNarration(index, demoState.steps, lang);

  // If demo was stopped or advanced while waiting, exit
  if (run !== stepRun) {
    return;
  }

  demoState = {
    ...demoState,
    narrationText: narration,
    avatarState: 'talking',
  };
  notify();

  // Typewriter streaming word by word
  const words = narration.split(/\s+/).filter(Boolean);
  const isReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  if (words.length <= 1 || isReducedMotion) {
    demoState = {
      ...demoState,
      displayedText: narration,
      avatarState: 'idle',
    };
    notify();
    scheduleAutoAdvance();
  } else {
    let wordCount = 1;
    demoState = {
      ...demoState,
      displayedText: words.slice(0, wordCount).join(' '),
      avatarState: 'talking',
    };
    notify();

    const intervalMs = demoState.speed === 'fast' ? 35 : 70;
    wordInterval = setInterval(() => {
      wordCount++;
      if (wordCount >= words.length) {
        if (wordInterval) clearInterval(wordInterval);
        wordInterval = null;
        demoState = {
          ...demoState,
          displayedText: narration,
          avatarState: 'idle',
        };
        notify();
        scheduleAutoAdvance();
      } else {
        demoState = {
          ...demoState,
          displayedText: words.slice(0, wordCount).join(' '),
          avatarState: 'talking',
        };
        notify();
      }
    }, intervalMs);
  }
}

function scheduleAutoAdvance(): void {
  if (demoState.isPaused || !demoState.isActive) return;

  const waitMs = demoState.speed === 'fast' ? 1400 : 3200;
  autoAdvanceTimer = setTimeout(() => {
    if (!demoState.isPaused && demoState.isActive) {
      if (demoState.currentStepIndex + 1 < demoState.totalSteps) {
        void executeStep(demoState.currentStepIndex + 1);
      } else {
        stopDemo();
      }
    }
  }, waitMs);
}

export function startDemo(options?: {
  fullDemo?: boolean;
  screens?: ScreenHelp[];
  speed?: DemoSpeed;
  role?: string;
  lang?: string;
  navigate?: (to: string) => void;
}): void {
  // If companion is disabled, do not start
  if (!isCompanionEnabled()) return;

  if (options?.navigate) {
    activeNavigator = options.navigate;
  }

  const speed = options?.speed || getStoredSpeed();
  const fullDemo = options?.fullDemo ?? false;
  const lang = options?.lang || (typeof document !== 'undefined' ? document.documentElement.lang : 'en') || 'en';

  const screens = options?.screens || customScreens || [];
  const steps = buildDemoSteps(screens, options?.role, fullDemo, lang);

  if (steps.length === 0) {
    return;
  }

  narrationCache.clear();
  clearAllTimers();

  demoState = {
    isActive: true,
    isPaused: false,
    speed,
    lang,
    currentStepIndex: 0,
    totalSteps: steps.length,
    steps,
    currentStep: steps[0],
    narrationText: '',
    avatarState: 'thinking',
    displayedText: '',
    fullDemo,
  };
  notify();

  void executeStep(0);
}

export function pauseDemo(): void {
  clearAllTimers();
  demoState = {
    ...demoState,
    isPaused: true,
  };
  notify();
}

export function resumeDemo(): void {
  if (!demoState.isActive) return;
  demoState = {
    ...demoState,
    isPaused: false,
  };
  notify();
  scheduleAutoAdvance();
}

export function nextStep(): void {
  clearAllTimers();
  if (demoState.currentStepIndex + 1 < demoState.totalSteps) {
    void executeStep(demoState.currentStepIndex + 1);
  } else {
    stopDemo();
  }
}

export function prevStep(): void {
  clearAllTimers();
  if (demoState.currentStepIndex > 0) {
    void executeStep(demoState.currentStepIndex - 1);
  }
}

export function clearNarrationCache(): void {
  narrationCache.clear();
}

export function stopDemo(): void {
  if (demoState.isActive) void getGuideBridge()?.guideCancel?.()?.catch(() => {});
  stepRun++;
  clearAllTimers();
  narrationCache.clear();
  removeTargetHighlights();
  demoState = {
    ...demoState,
    isActive: false,
    isPaused: false,
    currentStepIndex: 0,
    currentStep: null,
    narrationText: '',
    displayedText: '',
    avatarState: 'idle',
  };
  notify();
}

registerDemoStop(stopDemo);

export function setDemoSpeed(speed: DemoSpeed): void {
  setStoredSpeed(speed);
  demoState = {
    ...demoState,
    speed,
  };
  notify();
}
