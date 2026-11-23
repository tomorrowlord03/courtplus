import { useApp } from '../lib/context';
import { ROLE_GROUPS, roleGroup, setRoleOverride, useRoleOverride, useRole, type RoleGroup } from '../lib/roles';

/** Demo switch between the Judge, Lawyer and Citizen views. Changes the menu only, not the profile. */
export function RoleSwitch() {
  const { profile } = useApp();
  const role = useRole();
  const override = useRoleOverride();
  const fromProfile = roleGroup(profile?.role ?? undefined);
  return <section className="grid gap-2 rounded border bg-white p-4" aria-labelledby="role-switch-title">
    <h2 id="role-switch-title" className="font-semibold">View Court+ as</h2>
    <div role="radiogroup" aria-labelledby="role-switch-title" className="flex flex-wrap gap-3">
      {ROLE_GROUPS.map(({ value, label }) => <label key={value} className="flex items-center gap-1">
        <input type="radio" name="court-role" value={value} checked={role === value}
          onChange={() => setRoleOverride(value === fromProfile ? undefined : value as RoleGroup)} />{label}
      </label>)}
    </div>
    <p className="text-sm text-slate-700">
      {override ? 'Demo view. ' : ''}Your saved profile role is {fromProfile ? ROLE_GROUPS.find(item => item.value === fromProfile)!.label : 'not set (Judge view)'}.
      {override && <> <button type="button" className="text-button" onClick={() => setRoleOverride(undefined)}>Use my profile role</button></>}
    </p>
  </section>;
}
