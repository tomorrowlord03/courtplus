import type { DemoState, DemoSpeed } from './types';
import { useCompanionText } from './i18n';
import { nextStep, pauseDemo, prevStep, resumeDemo, setDemoSpeed, stopDemo } from './demo-runner';

interface CompanionBubbleProps {
  demoState: DemoState;
  showMenu: boolean;
  showTourOffer: boolean;
  enabled: boolean;
  onCloseMenu: () => void;
  onStartTour: (full?: boolean) => void;
  onDismissOffer: () => void;
  onToggleEnabled: () => void;
}

export function CompanionBubble({
  demoState,
  showMenu,
  showTourOffer,
  enabled,
  onCloseMenu,
  onStartTour,
  onDismissOffer,
  onToggleEnabled,
}: CompanionBubbleProps) {
  const t = useCompanionText();

  // If nothing to display in the bubble, render nothing
  if (!demoState.isActive && !showMenu && !showTourOffer) {
    return null;
  }

  const currentStepNumber = demoState.currentStepIndex + 1;
  const totalSteps = demoState.totalSteps;
  const progressPercent = totalSteps > 0 ? (currentStepNumber / totalSteps) * 100 : 0;

  return (
    <aside
      className="companion-bubble"
      role="region"
      aria-label={t('companion.label', 'Guide - explains the app, not legal advice')}
      aria-live="polite"
    >
      <div className="companion-bubble-header">
        <span className="companion-guide-badge">
          {t('companion.label', 'Guide - explains the app, not legal advice')}
        </span>
        {!demoState.isActive && (
          <button
            type="button"
            className="companion-close-btn"
            onClick={showMenu ? onCloseMenu : onDismissOffer}
            aria-label={t('companion.closeMenu', 'Close')}
          >
            ×
          </button>
        )}
      </div>

      {/* 1. Self-running Demo Mode */}
      {demoState.isActive && (
        <div className="companion-demo-content">
          {demoState.currentStep?.stepTitle && (
            <h3 className="companion-step-title">{demoState.currentStep.stepTitle}</h3>
          )}

          <div className="companion-narration-box">
            {demoState.avatarState === 'thinking' && !demoState.displayedText ? (
              <p className="companion-thinking-text">
                <span className="companion-thinking-spinner" aria-hidden="true">💭</span>{' '}
                {t('companion.thinking', 'Thinking…')}
              </p>
            ) : (
              <p className="companion-speech-text">{demoState.displayedText}</p>
            )}
          </div>

          <p className="companion-readonly-notice">
            <span aria-hidden="true">ℹ️</span>{' '}
            {t('companion.readOnlyNotice', 'I will only show, not change anything.')}
          </p>

          <div
            className="companion-progress-container"
            role="progressbar"
            aria-valuenow={currentStepNumber}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-label={t('companion.stepProgress', 'Step {current} of {total}', {
              current: currentStepNumber,
              total: totalSteps,
            })}
          >
            <div className="companion-progress-text">
              {t('companion.stepProgress', 'Step {current} of {total}', {
                current: currentStepNumber,
                total: totalSteps,
              })}
            </div>
            <div className="companion-progress-track">
              <div
                className="companion-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="companion-controls">
            <button
              type="button"
              className="button secondary text-xs companion-btn"
              onClick={prevStep}
              disabled={demoState.currentStepIndex === 0}
              aria-label={t('companion.back', 'Back')}
            >
              ← {t('companion.back', 'Back')}
            </button>

            <button
              type="button"
              className="button secondary text-xs companion-btn companion-btn-playpause"
              onClick={() => (demoState.isPaused ? resumeDemo() : pauseDemo())}
              aria-label={demoState.isPaused ? t('companion.play', 'Play') : t('companion.pause', 'Pause')}
            >
              {demoState.isPaused ? `▶ ${t('companion.play', 'Play')}` : `⏸ ${t('companion.pause', 'Pause')}`}
            </button>

            <button
              type="button"
              className="button secondary text-xs companion-btn"
              onClick={nextStep}
              aria-label={t('companion.next', 'Next')}
            >
              {t('companion.next', 'Next')} →
            </button>

            <button
              type="button"
              className="button secondary text-xs companion-btn companion-btn-speed"
              onClick={() =>
                setDemoSpeed(demoState.speed === 'fast' ? 'normal' : 'fast')
              }
              aria-label={
                demoState.speed === 'fast'
                  ? t('companion.speedFast', 'Fast speed')
                  : t('companion.speedNormal', 'Normal speed')
              }
            >
              ⚡ {demoState.speed === 'fast' ? t('companion.fast', 'Fast') : t('companion.normal', 'Normal')}
            </button>

            <button
              type="button"
              className="button secondary text-xs companion-btn companion-btn-stop"
              onClick={stopDemo}
              aria-label={t('companion.stop', 'Stop')}
            >
              ⏹ {t('companion.stop', 'Stop')}
            </button>
          </div>
        </div>
      )}

      {/* 2. First Launch Offer */}
      {!demoState.isActive && showTourOffer && (
        <div className="companion-offer-content">
          <p className="companion-prompt-text">
            {t('companion.tourPrompt', 'New here? Want a 3-minute tour?')}
          </p>
          <div className="companion-offer-actions">
            <button
              type="button"
              className="button primary text-xs companion-btn"
              onClick={() => onStartTour(false)}
            >
              {t('companion.startTour', 'Start tour')}
            </button>
            <button
              type="button"
              className="button secondary text-xs companion-btn"
              onClick={onDismissOffer}
            >
              {t('companion.dismiss', 'Skip for now')}
            </button>
          </div>
        </div>
      )}

      {/* 3. Companion Idle Menu */}
      {!demoState.isActive && showMenu && !showTourOffer && (
        <div className="companion-menu-content">
          <h3 className="font-semibold text-sm mb-1 text-slate-800">
            {t('companion.menuTitle', 'Guide companion')}
          </h3>
          <p className="text-xs text-slate-600 mb-3">
            {t(
              'companion.settingDesc',
              'Self-running tour and interactive helper. Explains the app without giving legal advice.'
            )}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="button primary text-xs companion-btn text-left"
              onClick={() => onStartTour(true)}
            >
              🎯 {t('companion.showEverything', 'Show me everything')} ({t('companion.fullDemo', 'Full demo')})
            </button>
            <button
              type="button"
              className="button secondary text-xs companion-btn text-left"
              onClick={() => onStartTour(false)}
            >
              👤 {t('companion.startTour', 'Start tour')} ({t('companion.roleDemo', 'Role tour')})
            </button>
            <div className="border-t border-slate-200 my-1 pt-2">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                className="button secondary text-xs companion-btn w-full"
                onClick={onToggleEnabled}
              >
                {enabled
                  ? t('companion.enabled', 'Guide companion: On')
                  : t('companion.disabled', 'Guide companion: Off')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
