import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CourtPlusApi } from '@courtplus/contracts';

export type View = 'legal_aid' | 'utrc';

interface Ctx { api: CourtPlusApi; view: View; setView: (v: View) => void }
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ api, children }: { api: CourtPlusApi; children: ReactNode }) {
  const [view, setView] = useState<View>('legal_aid');
  const value = useMemo(() => ({ api, view, setView }), [api, view]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
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
