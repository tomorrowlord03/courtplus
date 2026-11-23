import { useSyncExternalStore } from 'react';
import type { Profile } from '@courtplus/contracts';
import { useApp } from './context';

/** The three Court+ audiences. UTRC, jail and DLSA roles sit under Judge or Lawyer. */
export type RoleGroup = 'judge' | 'lawyer' | 'citizen';

export const ROLE_GROUPS: { value: RoleGroup; label: string; dashboard: string }[] = [
  { value: 'judge', label: 'Judge', dashboard: 'Judge dashboard' },
  { value: 'lawyer', label: 'Lawyer', dashboard: 'Lawyer workspace' },
  { value: 'citizen', label: 'Citizen', dashboard: 'Citizen help' },
];

/** Profile roles grouped for the profile form; the sub-roles keep their existing values. */
export const PROFILE_ROLES: { group: string; roles: [Profile['role'], string][] }[] = [
  { group: 'Judge', roles: [['judge', 'Judge'], ['utrc_member', 'UTRC member'], ['jail_superintendent', 'Jail superintendent']] },
  { group: 'Lawyer', roles: [['lawyer', 'Lawyer'], ['legal_aid_lawyer', 'Legal-aid lawyer'], ['dlsa', 'DLSA']] },
  { group: 'Citizen', roles: [['citizen', 'Citizen']] },
];

export function roleGroup(role: Profile['role'] | undefined): RoleGroup | undefined {
  if (!role) return undefined;
  if (role === 'citizen') return 'citizen';
  return role === 'judge' || role === 'utrc_member' || role === 'jail_superintendent' ? 'judge' : 'lawyer';
}

export function dashboardTitle(group: RoleGroup): string {
  return ROLE_GROUPS.find(item => item.value === group)!.dashboard;
}

/**
 * Nav paths per role, in display order. Paths that are not in the shared NAV list (for example screens
 * another branch has not merged yet) are simply skipped.
 */
export const ROLE_NAV: Record<RoleGroup, string[]> = {
  judge: ['/', '/import', '/evidence', '/triage', '/triage/adjournment', '/hearings', '/research', '/drafts', '/cases'],
  lawyer: ['/', '/cases', '/lawyer/case', '/lawyer', '/research', '/import', '/file-evidence', '/drafts'],
  citizen: ['/rights', '/submit-proof', '/track', '/settlement-guide', '/safeguards'],
};

/** Sidebar groups shown to everyone, in this order; clicking an item switches to that role's view. */
export const NAV_SECTIONS: { group?: RoleGroup; title: string; paths: string[] }[] = [
  { group: 'judge', title: 'For Judges', paths: ROLE_NAV.judge },
  { group: 'lawyer', title: 'For Lawyers', paths: ['/', '/lawyer/case', '/lawyer', '/research', '/import', '/file-evidence', '/drafts'] },
  { group: 'citizen', title: 'For Citizens', paths: ROLE_NAV.citizen.filter(path => path !== '/safeguards') },
  { title: 'Common', paths: ['/board', '/persons', '/calendar', '/verify', '/stats', '/sc-return', '/safeguards'] },
];

// Demo role switch (Settings). Stored per computer; the saved profile role is the default.
const overrideKey = 'courtplus.roleView';
const listeners = new Set<() => void>();

function readOverride(): RoleGroup | undefined {
  try {
    const value = localStorage.getItem(overrideKey);
    return value === 'judge' || value === 'lawyer' || value === 'citizen' ? value : undefined;
  } catch { return undefined; }
}

export function setRoleOverride(group: RoleGroup | undefined): void {
  try {
    if (group) localStorage.setItem(overrideKey, group);
    else localStorage.removeItem(overrideKey);
  } catch { /* Storage may be disabled; the switch then lasts until reload. */ }
  memory = group;
  listeners.forEach(listener => listener());
}

let memory: RoleGroup | undefined = readOverride();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRoleOverride(): RoleGroup | undefined {
  return useSyncExternalStore(subscribe, () => memory, () => undefined);
}

/** The active audience: the Settings switch, else the profile role, else Judge. */
export function useRole(): RoleGroup {
  const { profile } = useApp();
  return useRoleOverride() ?? roleGroup(profile?.role ?? undefined) ?? 'judge';
}
