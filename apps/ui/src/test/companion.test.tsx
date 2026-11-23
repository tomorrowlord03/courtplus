import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../lib/context';
import { createDevStub } from '../lib/api';
import {
  Companion,
  CompanionSetting,
  buildDemoSteps,
  clearNarrationCache,
  fetchNarration,
  getDemoState,
  isCompanionEnabled,
  nextStep,
  pauseDemo,
  prevStep,
  resumeDemo,
  setCompanionEnabled,
  setCustomScreens,
  startDemo,
  stopDemo,
  type GuideAskParams,
  type GuideAskResult,
  type ScreenHelp,
} from '../components/companion';

// 3-screen fixture adhering to schema:
// { "screens": [{ "id", "route", "roles": [...], "name": {"en","hi"}, "what": {...}, "when": {...}, "start": {...}, "steps": [{"en","hi"}] }] }
const fixtureScreens: ScreenHelp[] = [
  {
    id: 'dashboard',
    route: '/',
    roles: ['judge', 'lawyer'],
    name: { en: 'Dashboard', hi: 'डैशबोर्ड' },
    what: { en: 'Dashboard overview of court matters.', hi: 'अदालती मामलों का डैशबोर्ड अवलोकन।' },
    when: { en: 'Start each morning here.', hi: 'हर सुबह यहाँ से शुरुआत करें।' },
    start: { en: 'Click on any urgent item.', hi: 'किसी भी आवश्यक मद पर क्लिक करें।' },
    steps: [
      { en: 'Review priority cases.', hi: 'प्राथमिकता वाले मामलों की समीक्षा करें।' },
    ],
  },
  {
    id: 'cases',
    route: '/cases',
    roles: ['judge', 'lawyer'],
    name: { en: 'Cases', hi: 'मामले' },
    what: { en: 'List of all imported cases.', hi: 'सभी आयातित मामलों की सूची।' },
    when: { en: 'Search and inspect case details.', hi: 'मामले के विवरण खोजें और देखें।' },
    start: { en: 'Search by alias or case number.', hi: 'उपनाम या मामला संख्या से खोजें।' },
    steps: [
      { en: 'Open any case record.', hi: 'कोई भी मामला रिकॉर्ड खोलें।' },
    ],
  },
  {
    id: 'stats',
    route: '/stats',
    roles: ['judge', 'lawyer', 'citizen'],
    name: { en: 'Statistics', hi: 'आँकड़े' },
    what: { en: 'Clearance and disposal statistics.', hi: 'निपटान और निस्तारण आँकड़े।' },
    when: { en: 'Review monthly institutional trends.', hi: 'मासिक संस्थागत रुझानों की समीक्षा करें।' },
    start: { en: 'Select date range filters.', hi: 'तिथि सीमा फ़िल्टर चुनें।' },
    steps: [
      { en: 'Export reports.', hi: 'रिपोर्ट निर्यात करें।' },
    ],
  },
];

function DummyScreen({ id, title }: { id: string; title: string }) {
  return (
    <div data-guide-screen={id}>
      <h1>{title}</h1>
      <button data-guide="start" type="button">
        Start Action
      </button>
    </div>
  );
}

function renderCompanionTestApp(initialRoute = '/') {
  return render(
    <AppProvider api={createDevStub()}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/" element={<DummyScreen id="dashboard" title="Dashboard" />} />
          <Route path="/cases" element={<DummyScreen id="cases" title="Cases" />} />
          <Route path="/stats" element={<DummyScreen id="stats" title="Statistics" />} />
          <Route path="/settings" element={<CompanionSetting />} />
        </Routes>
        <Companion />
      </MemoryRouter>
    </AppProvider>
  );
}

describe('Guide companion (w57)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNarrationCache();
    setCustomScreens(fixtureScreens);
    stopDemo();
    setCompanionEnabled(true);
    vi.useRealTimers();
    delete (window as Window & { courtplus?: unknown }).courtplus;
  });

  afterEach(() => {
    stopDemo();
    clearNarrationCache();
    localStorage.clear();
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('the demo visits every screen in a 3-screen fixture in order', async () => {
    const visitedRoutes: string[] = [];
    const mockGuideAsk = vi.fn().mockImplementation((params: GuideAskParams): Promise<GuideAskResult> => {
      return Promise.resolve({
        answer: `Guided: ${params.question} for ${params.screenId}`,
        usedPassageIds: params.passages.map(p => p.id),
        mode: 'llm',
      });
    });

    (window as unknown as { courtplus?: { guideAsk?: unknown } }).courtplus = {
      ...(window as unknown as { courtplus?: Record<string, unknown> }).courtplus,
      guideAsk: mockGuideAsk,
    };

    const mockNavigate = vi.fn((to: string) => {
      visitedRoutes.push(to);
    });

    renderCompanionTestApp('/');

    // Start full demo with mock navigate
    act(() => {
      startDemo({
        fullDemo: true,
        screens: fixtureScreens,
        navigate: mockNavigate,
      });
    });

    const state = getDemoState();
    expect(state.isActive).toBe(true);
    expect(state.totalSteps).toBe(12); // 4 substeps per screen * 3 screens = 12

    // Step 0: Dashboard 'what'
    expect(state.currentStep?.screenId).toBe('dashboard');
    expect(state.currentStep?.kind).toBe('what');
    expect(state.currentStep?.route).toBe('/');

    // Next -> Step 1: Dashboard 'when'
    act(() => nextStep());
    expect(getDemoState().currentStep?.kind).toBe('when');

    // Next -> Step 2: Dashboard 'start'
    act(() => nextStep());
    expect(getDemoState().currentStep?.kind).toBe('start');

    // Next -> Step 3: Dashboard 'step'
    act(() => nextStep());
    expect(getDemoState().currentStep?.kind).toBe('step');

    // Next -> Step 4: Cases 'what' (Screen 2)
    act(() => nextStep());
    expect(getDemoState().currentStep?.screenId).toBe('cases');
    expect(getDemoState().currentStep?.route).toBe('/cases');

    // Fast-forward to Screen 3
    act(() => {
      nextStep(); // cases when
      nextStep(); // cases start
      nextStep(); // cases step
    });

    // Next -> Step 8: Stats 'what' (Screen 3)
    act(() => nextStep());
    expect(getDemoState().currentStep?.screenId).toBe('stats');
    expect(getDemoState().currentStep?.route).toBe('/stats');

    // Check visited routes in order
    expect(visitedRoutes).toContain('/');
    expect(visitedRoutes).toContain('/cases');
    expect(visitedRoutes).toContain('/stats');

    // Verify ordering
    const firstDash = visitedRoutes.indexOf('/');
    const firstCases = visitedRoutes.indexOf('/cases');
    const firstStats = visitedRoutes.indexOf('/stats');
    expect(firstDash).toBeLessThan(firstCases);
    expect(firstCases).toBeLessThan(firstStats);
  });

  it('it falls back to scripted text when guideAsk is slow or rejects', async () => {
    vi.useFakeTimers();

    // 1. Slow guideAsk taking > 4s
    const slowGuideAsk = vi.fn().mockImplementation(() => {
      return new Promise<GuideAskResult>(resolve => {
        setTimeout(() => {
          resolve({ answer: 'Slow answer', usedPassageIds: [], mode: 'llm' });
        }, 6000);
      });
    });

    (window as unknown as { courtplus?: { guideAsk?: unknown } }).courtplus = {
      ...(window as unknown as { courtplus?: Record<string, unknown> }).courtplus,
      guideAsk: slowGuideAsk,
    };

    const steps = buildDemoSteps(fixtureScreens, undefined, true);
    const slowPromise = fetchNarration(0, steps, 'en');

    // Advance 4500ms (exceeding 4s timeout)
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });

    const resultSlow = await slowPromise;
    // Should fall back to the scripted text at once
    expect(resultSlow).toBe(fixtureScreens[0].what.en);

    // 2. Rejecting guideAsk
    const rejectingGuideAsk = vi.fn().mockRejectedValue(new Error('Model unavailable'));
    (window as unknown as { courtplus?: { guideAsk?: unknown } }).courtplus = {
      ...(window as unknown as { courtplus?: Record<string, unknown> }).courtplus,
      guideAsk: rejectingGuideAsk,
    };

    const rejectPromise = fetchNarration(1, steps, 'en');
    const resultReject = await rejectPromise;
    // Should immediately fall back to scripted text without throwing
    expect(resultReject).toBe(fixtureScreens[0].when.en);

    vi.useRealTimers();
  });

  it('pause and stop work', async () => {
    vi.useFakeTimers();

    renderCompanionTestApp('/');

    act(() => {
      startDemo({
        fullDemo: true,
        screens: fixtureScreens,
      });
    });

    expect(getDemoState().isActive).toBe(true);
    expect(getDemoState().isPaused).toBe(false);

    // Pause the demo
    act(() => {
      pauseDemo();
    });

    expect(getDemoState().isPaused).toBe(true);
    const stepBeforeTime = getDemoState().currentStepIndex;

    // Advance timer while paused
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Should NOT have advanced while paused
    expect(getDemoState().currentStepIndex).toBe(stepBeforeTime);

    // Resume the demo
    act(() => {
      resumeDemo();
    });

    expect(getDemoState().isPaused).toBe(false);

    // Stop the demo
    act(() => {
      stopDemo();
    });

    expect(getDemoState().isActive).toBe(false);
    expect(getDemoState().currentStep).toBe(null);

    vi.useRealTimers();
  });

  it('OFF hides the avatar and never calls guideAsk', async () => {
    const mockGuideAsk = vi.fn().mockResolvedValue({
      answer: 'Should never be called',
      usedPassageIds: [],
      mode: 'llm',
    });

    (window as unknown as { courtplus?: { guideAsk?: unknown } }).courtplus = {
      ...(window as unknown as { courtplus?: Record<string, unknown> }).courtplus,
      guideAsk: mockGuideAsk,
    };

    // Set companion OFF in localStorage
    setCompanionEnabled(false);
    expect(isCompanionEnabled()).toBe(false);

    renderCompanionTestApp('/');

    // Avatar must not be in document
    const avatar = screen.queryByRole('button', { name: /Guide - explains the app/i });
    expect(avatar).not.toBeInTheDocument();

    // Start demo attempt when OFF should be a no-op
    act(() => {
      startDemo({ screens: fixtureScreens });
    });

    expect(getDemoState().isActive).toBe(false);
    expect(mockGuideAsk).not.toHaveBeenCalled();

    // Turn ON again
    act(() => {
      setCompanionEnabled(true);
    });

    expect(screen.getByRole('button', { name: /Guide - explains the app/i })).toBeInTheDocument();
  });

  it('marks the first-run offer on display and opens the avatar menu with the keyboard', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCompanionTestApp('/');
    expect(screen.getByText('New here? Want a 3-minute tour?')).toBeInTheDocument();
    unmount();
    renderCompanionTestApp('/');
    expect(screen.queryByText('New here? Want a 3-minute tour?')).not.toBeInTheDocument();
    const avatar = screen.getByRole('button', { name: /Guide - explains the app/i });
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
    avatar.focus();
    await user.keyboard('{Enter}');
    expect(avatar).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
  });

  it('retains Hindi while advancing and cancels the tour when switched off', async () => {
    vi.useFakeTimers();
    const guideAsk = vi.fn<(input: GuideAskParams) => Promise<GuideAskResult>>().mockResolvedValue({ answer: 'नमस्ते', usedPassageIds: [], mode: 'llm' });
    const guideCancel = vi.fn().mockResolvedValue(undefined);
    (window as Window & { courtplus?: unknown }).courtplus = { guideAsk, guideCancel };
    const navigate = vi.fn();
    startDemo({ screens: fixtureScreens, lang: 'hi', navigate });
    await vi.advanceTimersByTimeAsync(3300);
    expect(getDemoState().currentStepIndex).toBe(1);
    nextStep();
    prevStep();
    expect(guideAsk.mock.calls.length).toBeGreaterThan(3);
    expect(guideAsk.mock.calls.every(([input]) => input.lang === 'hi')).toBe(true);

    const visits = navigate.mock.calls.length;
    const requests = guideAsk.mock.calls.length;
    setCompanionEnabled(false);
    expect(getDemoState().isActive).toBe(false);
    expect(guideCancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15000);
    expect(navigate).toHaveBeenCalledTimes(visits);
    expect(guideAsk).toHaveBeenCalledTimes(requests);
  });

  it('reduced motion disables gliding', async () => {
    // Mock matchMedia for prefers-reduced-motion: reduce
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderCompanionTestApp('/');

    const root = document.querySelector('.companion-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass('companion-reduced-motion');
    expect(root).toHaveAttribute('data-companion-reduced-motion', 'true');

    // Style transition must be fade-only (opacity only, no gliding transitions)
    const style = (root as HTMLElement).style.transition;
    expect(style).toContain('opacity');
    expect(style).not.toContain('top 0.35s');

    window.matchMedia = originalMatchMedia;
  });

  it('CompanionSetting component toggles companion and persists in localStorage', () => {
    renderCompanionTestApp('/settings');

    const toggleBtn = screen.getByRole('switch', { name: /Guide companion/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-checked', 'true');

    // Click toggle to turn OFF
    fireEvent.click(toggleBtn);
    expect(isCompanionEnabled()).toBe(false);
    expect(localStorage.getItem('courtplus.companion.enabled')).toBe('off');
    expect(toggleBtn).toHaveAttribute('aria-checked', 'false');

    // Click toggle to turn ON
    fireEvent.click(toggleBtn);
    expect(isCompanionEnabled()).toBe(true);
    expect(localStorage.getItem('courtplus.companion.enabled')).toBe('on');
    expect(toggleBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('supports Hindi translation for companion UI copy', () => {
    localStorage.setItem('courtplus.uiLanguage', 'hi');
    document.documentElement.lang = 'hi';

    renderCompanionTestApp('/settings');

    expect(screen.getByText('गाइड साथी')).toBeInTheDocument();
    expect(screen.getByText(/गाइड साथी: चालू/i)).toBeInTheDocument();
  });
});
