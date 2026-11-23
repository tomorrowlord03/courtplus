import { useState, type FormEvent } from 'react';
import type { Profile as ProfileDetails } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';
import { useApp } from '../lib/context';
import { RIGHTS_CARD_LANGS, ui } from '../lib/i18n';
import { UI_LANGUAGES } from '../lib/preferences';
import { PROFILE_ROLES, setRoleOverride } from '../lib/roles';
import { RoleSwitch } from '../components/RoleSwitch';

export function ProfileScreen() {
  const { profileAvailable, profile, profileError, language, setLanguage } = useApp();
  const [message, setMessage] = useState('');
  return <ScreenPage screenId="profile" note={profileAvailable ? ui("Stored only on this computer") : undefined}>
    {profileAvailable ? <>
      <ErrorNote error={profileError} />
      {profile !== undefined
        ? <ProfileForm key={JSON.stringify(profile)} initial={profile} onMessage={setMessage} />
        : !profileError && <p role="status">{ui("Loading profile…")}</p>}
    </> : <div className="panel profile-panel">
      <p className="mb-4">{ui("Personal profiles are available in the desktop app.")}</p>
      <label>{ui("Language")}<select data-guide="start" className="field-control" value={language} onChange={event => setLanguage(event.target.value)}>
          <LanguageOptions />
        </select>
      </label>
      <div className="mt-4"><RoleSwitch /></div>
    </div>}
    <p className="muted" role="status">{message}</p>
  </ScreenPage>;
}

function LanguageOptions() {
  return UI_LANGUAGES.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>);
}

function ProfileForm({ initial, onMessage }: { initial: ProfileDetails | null; onMessage: (message: string) => void }) {
  const { saveProfile, clearProfile } = useApp();
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) ?? '').trim();
    setBusy(true);
    setError(null);
    onMessage('');
    try {
      await saveProfile({
        fullName: value('fullName'), role: value('role') as ProfileDetails['role'],
        office: value('office'), district: value('district'), designation: value('designation'),
        language: value('language'), employeeId: value('employeeId') || undefined, email: value('email') || undefined,
      });
      setRoleOverride(undefined); // The saved role now decides the menu.
      onMessage(ui('Profile saved.'));
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    onMessage('');
    try {
      await clearProfile();
      setClearing(false);
      onMessage(ui('Profile cleared.'));
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return <form className="panel profile-panel" onSubmit={event => void update(event)}>
    <ErrorNote error={error} />
    <fieldset disabled={busy} className="profile-fields">
      <label>{ui("Full name")}<input className="field-control" name="fullName" autoComplete="name" required maxLength={160} defaultValue={initial?.fullName} /></label>
      <label>{ui("Role")}<select className="field-control" name="role" required defaultValue={initial?.role ?? ''}>
        <option value="" disabled>{ui("Choose a role")}</option>
        {PROFILE_ROLES.map(({ group, roles }) => <optgroup key={group} label={ui(group)}>
          {roles.map(([value, label]) => <option key={value} value={value}>{ui(label)}</option>)}
        </optgroup>)}
      </select></label>
      <label>{ui("Court or office")}<input className="field-control" name="office" autoComplete="organization" required maxLength={160} defaultValue={initial?.office} /></label>
      <label>{ui("District")}<input className="field-control" name="district" required maxLength={160} defaultValue={initial?.district ?? 'Raipur'} /></label>
      <label>{ui("Designation")}<input className="field-control" name="designation" autoComplete="organization-title" required maxLength={160} defaultValue={initial?.designation} /></label>
      <label>{ui("Preferred language")}<select className="field-control" name="language" defaultValue={initial?.language ?? 'en'}>
        {RIGHTS_CARD_LANGS.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
      </select></label>
      <label>{ui("Bar enrolment or employee ID") + " "}<small>{ui("Optional")}</small><input className="field-control" name="employeeId" maxLength={160} defaultValue={initial?.employeeId} /></label>
      <label>{ui("Email") + " "}<small>{ui("Optional")}</small><input className="field-control" name="email" type="email" autoComplete="email" maxLength={254} defaultValue={initial?.email} /></label>
    </fieldset>
    <div className="profile-actions">
      <button data-guide="start" className={btnPrimary} disabled={busy}>{ui("Save profile")}</button>
      {initial && !clearing && <button className={btn} type="button" disabled={busy} onClick={() => setClearing(true)}>{ui("Clear my details")}</button>}
    </div>
    {clearing && <div className="clear-profile" aria-label={ui("Confirm clearing profile")}>
      <p>{ui("Clear your saved profile from this computer?")}</p>
      <button className={btn} type="button" disabled={busy} onClick={() => void clear()}>{ui("Clear profile")}</button>
      <button className={btn} type="button" disabled={busy} onClick={() => setClearing(false)}>{ui("Cancel")}</button>
    </div>}
  </form>;
}
