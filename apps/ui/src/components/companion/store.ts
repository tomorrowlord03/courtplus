import { useEffect, useState } from 'react';
import type { DemoSpeed } from './types';

export const COMPANION_ENABLED_KEY = 'courtplus.companion.enabled';
export const COMPANION_TOUR_OFFERED_KEY = 'courtplus.companion.tourOffered';
export const COMPANION_SPEED_KEY = 'courtplus.companion.speed';

const TOGGLE_EVENT = 'courtplus:companion-toggle';
let enabledOverride: boolean | undefined;
let stopDemo: (() => void) | undefined;

export function registerDemoStop(stop: () => void): void {
  stopDemo = stop;
}

export function isCompanionEnabled(): boolean {
  if (enabledOverride !== undefined) return enabledOverride;
  try {
    const val = localStorage.getItem(COMPANION_ENABLED_KEY);
    if (val === null) return true; // Default ON for new profiles
    return val !== 'off' && val !== 'false';
  } catch {
    return true;
  }
}

export function setCompanionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(COMPANION_ENABLED_KEY, enabled ? 'on' : 'off');
    enabledOverride = undefined;
  } catch {
    enabledOverride = enabled;
  }
  if (!enabled) stopDemo?.();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { enabled } }));
  }
}

export function isTourOffered(): boolean {
  try {
    return localStorage.getItem(COMPANION_TOUR_OFFERED_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function setTourOffered(offered: boolean): void {
  try {
    localStorage.setItem(COMPANION_TOUR_OFFERED_KEY, offered ? 'yes' : 'no');
  } catch {
    // Storage might be disabled.
  }
}

export function getStoredSpeed(): DemoSpeed {
  try {
    const speed = localStorage.getItem(COMPANION_SPEED_KEY);
    return speed === 'fast' ? 'fast' : 'normal';
  } catch {
    return 'normal';
  }
}

export function setStoredSpeed(speed: DemoSpeed): void {
  try {
    localStorage.setItem(COMPANION_SPEED_KEY, speed);
  } catch {
    // Storage might be disabled.
  }
}

export function useCompanionEnabled(): [boolean, (val: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(isCompanionEnabled);

  useEffect(() => {
    function onToggle() {
      setEnabled(isCompanionEnabled());
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== COMPANION_ENABLED_KEY) return;
      if (!isCompanionEnabled()) stopDemo?.();
      onToggle();
    }
    window.addEventListener(TOGGLE_EVENT, onToggle);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const update = (val: boolean) => {
    setCompanionEnabled(val);
    setEnabled(val);
  };

  return [enabled, update];
}
