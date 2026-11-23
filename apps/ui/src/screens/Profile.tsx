import { useState, type FormEvent } from 'react';
import type { Profile as ProfileDetails } from '@courtplus/contracts';
import { btn, btnPrimary, ErrorNote, errMsg, Page } from '../components/ui';
import { useApp } from '../lib/context';
import { RIGHTS_CARD_LANGS } from '../lib/i18n';

const roles: [ProfileDetails['role'], string][] = [
  ['judge', 'Judge'], ['utrc_member', 'UTRC member'], ['jail_superintendent', 'Jail superintendent'],
  ['dlsa', 'DLSA'], ['legal_aid_lawyer', 'Legal-aid lawyer'],
];

export function ProfileScreen() {
  const { profileAvailable, profile, profileError, language, setLanguage } = useApp();
  const [message, setMessage] = useState('');
  return <Page title="My profile" note={profileAvailable ? 'Stored only on this computer' : undefined}>
    {profileAvailable ? <>
      <ErrorNote error={profileError} />
      {profile !== undefined
        ? <ProfileForm key={JSON.stringify(profile)} initial={profile} onMessage={setMessage} />
        : !profileError && <p role="status">Loading profile…</p>}
    </> : <div className="panel profile-panel">
      <p className="mb-4">Personal profiles are available in the desktop app.</p>
      <label>Language
        <select className="field-control" value={language} onChange={event => setLanguage(event.target.value)}>
          <LanguageOptions />
        </select>
      </label>
    </div>}
    <p className="muted" role="status">{message}</p>
  </Page>;
}

function LanguageOptions() {
  return RIGHTS_CARD_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>);
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
      onMessage('Profile saved.');
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
      onMessage('Profile cleared.');
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return <form className="panel profile-panel" onSubmit={event => void update(event)}>
    <ErrorNote error={error} />
    <fieldset disabled={busy} className="profile-fields">
      <label>Full name<input className="field-control" name="fullName" autoComplete="name" required maxLength={160} defaultValue={initial?.fullName} /></label>
      <label>Role<select className="field-control" name="role" required defaultValue={initial?.role ?? ''}>
        <option value="" disabled>Choose a role</option>
        {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Court or office<input className="field-control" name="office" autoComplete="organization" required maxLength={160} defaultValue={initial?.office} /></label>
      <label>District<input className="field-control" name="district" required maxLength={160} defaultValue={initial?.district ?? 'Raipur'} /></label>
      <label>Designation<input className="field-control" name="designation" autoComplete="organization-title" required maxLength={160} defaultValue={initial?.designation} /></label>
      <label>Preferred language<select className="field-control" name="language" defaultValue={initial?.language ?? 'en'}><LanguageOptions /></select></label>
      <label>Bar enrolment or employee ID <small>Optional</small><input className="field-control" name="employeeId" maxLength={160} defaultValue={initial?.employeeId} /></label>
      <label>Email <small>Optional</small><input className="field-control" name="email" type="email" autoComplete="email" maxLength={254} defaultValue={initial?.email} /></label>
    </fieldset>
    <div className="profile-actions">
      <button className={btnPrimary} disabled={busy}>Save profile</button>
      {initial && !clearing && <button className={btn} type="button" disabled={busy} onClick={() => setClearing(true)}>Clear my details</button>}
    </div>
    {clearing && <div className="clear-profile" aria-label="Confirm clearing profile">
      <p>Clear your saved profile from this computer?</p>
      <button className={btn} type="button" disabled={busy} onClick={() => void clear()}>Clear profile</button>
      <button className={btn} type="button" disabled={busy} onClick={() => setClearing(false)}>Cancel</button>
    </div>}
  </form>;
}
