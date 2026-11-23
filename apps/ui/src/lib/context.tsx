import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Profile } from '@courtplus/contracts';
import type { WorkspaceApi } from './api';
import { useLang } from './i18n';
import { languageKey, readPreference } from './preferences';

export type View = 'legal_aid' | 'utrc';

interface Ctx {
  api: WorkspaceApi;
  view: View;
  setView: (v: View) => void;
  language: string;
  setLanguage: (language: string) => void;
  profile: Profile | null | undefined;
  profileError: string | null;
  profileAvailable: boolean;
  saveProfile: (value: Profile) => Promise<void>;
  clearProfile: () => Promise<void>;
}
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ api, children }: { api: WorkspaceApi; children: ReactNode }) {
  const [view, setView] = useState<View>('legal_aid');
  const [language, setLanguage] = useLang();
  const [profile, setProfile] = useState<Profile | null>();
  const [profileError, setProfileError] = useState<string | null>(null);
  const { getProfile, role } = api;
  const profileAvailable = Boolean(getProfile && api.saveProfile && api.profileAvailable !== false);

  function applyProfile(value: Profile) {
    setView(value.role === 'judge' || value.role === 'utrc_member' ? 'utrc' : 'legal_aid');
  }

  useEffect(() => {
    let live = true;
    if (!profileAvailable) return;
    void Promise.resolve().then(() => getProfile?.()).then(async value => {
      if (!live) return;
      setProfile(value ?? null);
      if (value) {
        applyProfile(value);
        if (readPreference(languageKey) === null) setLanguage(value.language);
      } else {
        const currentRole = await role();
        if (live && currentRole === 'utrc') setView('utrc');
      }
    }).catch(() => { if (live) setProfileError('Could not load your profile.'); });
    return () => { live = false; };
  }, [getProfile, profileAvailable, role, setLanguage]);

  async function saveProfile(value: Profile) {
    if (!api.saveProfile) throw new Error('Profiles can be saved in the desktop app.');
    await api.saveProfile(value);
    setProfile(value);
    setProfileError(null);
    applyProfile(value);
    setLanguage(value.language);
    clearLegacyConfirmer();
  }

  async function clearProfile() {
    if (!api.clearProfile) throw new Error('Profiles can be cleared in the desktop app.');
    await api.clearProfile();
    setProfile(null);
    setProfileError(null);
    setView('legal_aid');
    clearLegacyConfirmer();
  }

  const value = { api, view, setView, language, setLanguage, profile, profileError, profileAvailable, saveProfile, clearProfile };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function clearLegacyConfirmer() {
  try { localStorage.removeItem('courtplus.confirmedBy'); } catch { /* Storage may be disabled. */ }
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

/** Today as a civil date in Asia/Kolkata. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
