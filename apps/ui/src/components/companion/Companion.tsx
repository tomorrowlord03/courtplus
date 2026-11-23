import screenHelp from '../../../../../data/ui/screen-help.json';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRole } from '../../lib/roles';
import { languageKey, readPreference } from '../../lib/preferences';
import { useCompanionText } from './i18n';
import { CompanionAvatar } from './avatar';
import { CompanionBubble } from './CompanionBubble';
import {
  findDemoTarget,
  getCustomScreens,
  getDemoState,
  highlightTarget,
  registerNavigator,
  startDemo,
  subscribeDemoState,
} from './demo-runner';
import {
  isTourOffered,
  setTourOffered,
  useCompanionEnabled,
} from './store';
import type { DemoState, ScreenHelp } from './types';
import './companion.css';

export function getLoadedScreens(): ScreenHelp[] {
  const custom = getCustomScreens();
  if (custom && custom.length > 0) return custom;

  return screenHelp.screens;
}

export function Companion({ keepDocked = false }: { keepDocked?: boolean } = {}) {
  const [enabled, setEnabled] = useCompanionEnabled();
  const [demoState, setDemoState] = useState<DemoState>(getDemoState);
  const [showMenu, setShowMenu] = useState(false);
  const [showTourOffer, setShowTourOffer] = useState(() => !isTourOffered());
  const [coords, setCoords] = useState<{ top: number; left: number }>();

  const navigate = useNavigate();
  const location = useLocation();
  const role = useRole();
  const t = useCompanionText();

  useEffect(() => {
    if (enabled && showTourOffer) setTourOffered(true);
    if (!enabled && isTourOffered()) setShowTourOffer(false);
  }, [enabled, showTourOffer]);

  // Register router navigator
  useEffect(() => {
    return registerNavigator(navigate);
  }, [navigate]);

  // Subscribe to demo state updates
  useEffect(() => {
    return subscribeDemoState(setDemoState);
  }, []);

  // Check prefers-reduced-motion
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  // Update positioning relative to target element during demo
  useLayoutEffect(() => {
    if (!enabled) return;

    const step = demoState.currentStep;
    if (!demoState.isActive || !step) {
      setCoords(undefined);
      return;
    }

    let previousTarget: Element | null = null;
    const updateTarget = () => {
      const target = findDemoTarget(step.selector, step.fallbackSelector);
      if (target === previousTarget) return;
      previousTarget = target;
      highlightTarget(step.selector, step.fallbackSelector);
      if (!target) {
        setCoords(undefined);
        return;
      }
      target.scrollIntoView?.({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      const rect = target.getBoundingClientRect();
      const width = 390;
      const height = 220;
      const viewWidth = window.innerWidth;
      const viewHeight = window.innerHeight - 74;
      const maxTop = Math.max(16, viewHeight - height - 16);

      let left = Math.max(16, Math.min(rect.left, viewWidth - width - 16));
      let top = Math.max(16, rect.top - height - 16);
      if (rect.right + 16 + width <= viewWidth) {
        left = rect.right + 16;
        top = rect.top;
      } else if (rect.left - 16 - width >= 0) {
        left = rect.left - 16 - width;
        top = rect.top;
      } else if (rect.bottom + 16 + height <= viewHeight) {
        top = rect.bottom + 16;
      }
      setCoords({ top: Math.round(Math.max(16, Math.min(top, maxTop))), left: Math.round(left) });
    };

    setCoords(undefined);
    updateTarget();
    const main = document.querySelector('main');
    const observer = new MutationObserver(updateTarget);
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [demoState.isActive, demoState.currentStep, location.pathname, enabled, prefersReducedMotion]);

  // If companion is OFF, render nothing (no avatar, no demo prompts, never call guideAsk)
  if (!enabled) {
    return null;
  }

  const getActiveLang = () => {
    const pref = readPreference(languageKey);
    if (pref === 'hi') return 'hi';
    if (typeof document !== 'undefined') return document.documentElement.lang || 'en';
    return 'en';
  };

  const handleStartTour = (full?: boolean) => {
    setShowMenu(false);
    setShowTourOffer(false);
    const screens = getLoadedScreens();
    startDemo({
      fullDemo: Boolean(full),
      screens,
      role,
      lang: getActiveLang(),
      navigate,
    });
  };

  const handleDismissOffer = () => {
    setShowTourOffer(false);
  };

  const floating = !keepDocked && coords;
  const positionStyle: React.CSSProperties = floating ? {
    position: 'fixed',
    top: floating.top,
    left: floating.left,
    bottom: 'var(--guide-clearance, 74px)',
    alignItems: 'flex-start',
    pointerEvents: 'none',
    transition: prefersReducedMotion
      ? 'opacity 0.2s ease'
      : 'top 0.35s cubic-bezier(0.16, 1, 0.3, 1), left 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
  } : { transition: 'opacity 0.2s ease' };

  return (
    <div
      className={`companion-root ${prefersReducedMotion ? 'companion-reduced-motion' : 'companion-glide'}`}
      style={positionStyle}
      data-companion-active={demoState.isActive}
      data-companion-reduced-motion={prefersReducedMotion}
    >
      <div className="companion-container">
        <CompanionBubble
          demoState={demoState}
          showMenu={showMenu}
          showTourOffer={showTourOffer}
          enabled={enabled}
          onCloseMenu={() => setShowMenu(false)}
          onStartTour={handleStartTour}
          onDismissOffer={handleDismissOffer}
          onToggleEnabled={() => setEnabled(!enabled)}
        />

        <div className="companion-avatar-anchor">
          <CompanionAvatar
            state={demoState.avatarState}
            size={56}
            label={t('companion.label', 'Guide - explains the app, not legal advice')}
            expanded={showMenu || showTourOffer}
            onClick={demoState.isActive ? undefined : () => {
              setShowMenu(!showMenu);
              setShowTourOffer(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}
