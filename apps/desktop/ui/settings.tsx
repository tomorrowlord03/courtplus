import { useEffect, useState, type FormEvent } from 'react';
import { btn, btnPrimary, ErrorNote, errMsg, Page } from '../../ui/src/components/ui';
import { shell, type CloudStatus, type DesktopSettings, type SignerStatus } from './bridge';

const field = 'block w-full rounded border border-slate-400 px-2 py-1';

export function TrustSigner() {
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  return <section className="mt-6 space-y-2">
    <button className={btn} onClick={() => {
      setError(null);
      void shell.trustSigner().then(id => {
        if (id) setStatus('Trusted key fingerprint: ' + id);
      }, error => setError(errMsg(error)));
    }}>Trust an office public key</button>
    {status && <p className="break-all" role="status">{status}</p>}
    <ErrorNote error={error} />
  </section>;
}

export function Settings() {
  const [settings, setSettings] = useState<DesktopSettings>();
  const [cloud, setCloud] = useState<CloudStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void shell.settings().then(({ cloud, ...settings }) => {
      if (live) { setSettings(settings); setCloud(cloud); }
    }, error => { if (live) setError(errMsg(error)); });
    const remove = shell.onBoardChanged(() => {
      void shell.settings().then(({ cloud }) => { if (live) setCloud(cloud); }, () => undefined);
    });
    return () => { live = false; remove(); };
  }, []);

  async function run(task: () => Promise<void>) {
    setError(null);
    setMessage('');
    setBusy(true);
    try { await task(); }
    catch (error) { setError(errMsg(error)); }
    finally { setBusy(false); }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      try {
        setCloud(await shell.login(String(data.get('username')), String(data.get('password'))));
      } finally {
        form.reset();
      }
    });
  }

  return <Page title="Settings">
    <ErrorNote error={error} />
    {message && <p role="status" className="mb-2">{message}</p>}
    {settings && <div className="grid max-w-2xl gap-6">
      <form className="grid gap-3 rounded border bg-white p-4" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          setSettings(await shell.saveSettings(settings));
          setMessage('Settings saved.');
        });
      }}>
        <label>Cloud backend URL
          <input className={field} type="url" value={settings.backendUrl} placeholder="https://courtplus.example"
            onChange={event => setSettings({ ...settings, backendUrl: event.target.value })} />
        </label>
        <p className="text-sm text-slate-700">Leave the URL blank for local use. Signing in shares anonymised case facts and card updates with the configured office.</p>
        <label>180-day board daily cap
          <input className={field} type="number" min="1" max="1000" required value={settings.dailyCap}
            onChange={event => setSettings({ ...settings, dailyCap: Number(event.target.value) })} />
        </label>
        <label>Issuing office
          <input className={field} required value={settings.issuer}
            onChange={event => setSettings({ ...settings, issuer: event.target.value })} />
        </label>
        <label>Prison
          <input className={field} value={settings.prison}
            onChange={event => setSettings({ ...settings, prison: event.target.value })} />
        </label>
        <label>DLSA district or name
          <input className={field} value={settings.district}
            onChange={event => setSettings({ ...settings, district: event.target.value })} />
        </label>
        <button className={btnPrimary} disabled={busy}>Save settings</button>
      </form>
      <section className="grid gap-3 rounded border bg-white p-4" aria-label="CourtPlus Cloud">
        <h2 className="font-semibold">CourtPlus Cloud</h2>
        {cloud?.error && <p role="status">{cloud.error}</p>}
        {cloud?.role ? <>
          <p>Signed in as {cloud.role}</p>
          <div className="flex gap-2">
            <button className={btn} disabled={busy} onClick={() => void run(async () => {
              await shell.sync(); setMessage('Sync requested.');
            })}>Sync now</button>
            <button className={btn} disabled={busy} onClick={() => void run(async () => { await shell.signOut(); })}>Sign out</button>
          </div>
        </> : <form className="grid gap-3" onSubmit={login}>
          <label>Username<input className={field} name="username" autoComplete="username" required /></label>
          <label>Password<input className={field} name="password" type="password" autoComplete="current-password" required /></label>
          <button className={btnPrimary} disabled={busy || !settings.backendUrl}>Sign in</button>
        </form>}
      </section>
      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-semibold">Draft signing</h2>
        <button className={btn} disabled={busy} onClick={() => void run(async () => {
          if (await shell.exportSigner()) setMessage('Office public key saved.');
        })}>Export office public key</button>
        <TrustSigner />
      </section>
      <SigningKey busy={busy} run={run} setMessage={setMessage} />
      <AuditAnchor busy={busy} run={run} setMessage={setMessage} />
    </div>}
  </Page>;
}

type SectionProps = {
  busy: boolean; run: (task: () => Promise<void>) => Promise<void>; setMessage: (message: string) => void;
};

function SigningKey({ busy, run, setMessage }: SectionProps) {
  const [status, setStatus] = useState<SignerStatus>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => {
    let live = true;
    void shell.signerStatus().then(value => { if (live) setStatus(value); }, () => undefined);
    return () => { live = false; };
  }, []);
  const done = (value: SignerStatus, text: string) => {
    setStatus(value); setCurrent(''); setNext(''); setMessage(text);
  };
  if (!status) return null;
  return <section className="grid gap-3 rounded border bg-white p-4" aria-label="Signing key">
    <h2 className="font-semibold">Signing key</h2>
    <p className="text-sm text-slate-700">
      {status.keyId ? 'Key ' + status.keyId.slice(0, 16) + '… ' : 'No key yet; one is made at the first export. '}
      {status.protected ? (status.unlocked ? 'Unlocked for 15 minutes.' : 'Locked: unlock it to export signed drafts.')
        : 'Not protected by a passphrase. Set one so a copied database cannot sign drafts.'}
      {status.retired.length > 0 && ' ' + status.retired.length + ' retired key(s) still verify earlier drafts.'}
    </p>
    <label>{status.protected ? 'Current passphrase' : 'Passphrase (only needed to retire a protected key)'}
      <input className={field} type="password" autoComplete="current-password" value={current}
        onChange={event => setCurrent(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      {status.protected && !status.unlocked && <button className={btnPrimary} disabled={busy || !current}
        onClick={() => void run(async () => done(await shell.unlockSigner(current), 'Signing key unlocked.'))}>Unlock</button>}
      {status.unlocked && <button className={btn} disabled={busy}
        onClick={() => void run(async () => done(await shell.lockSigner(), 'Signing key locked.'))}>Lock now</button>}
    </div>
    <label>New passphrase (at least 12 characters)
      <input className={field} type="password" autoComplete="new-password" value={next} minLength={12}
        onChange={event => setNext(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={btn} disabled={busy || next.length < 12 || (status.protected && !current)}
        onClick={() => void run(async () => done(
          await shell.setSignerPassphrase(status.protected ? current : undefined, next), 'Passphrase saved. The key is locked.'))}>
        {status.protected ? 'Change passphrase' : 'Set passphrase'}
      </button>
      <button className={btn} disabled={busy || !status.keyId || (status.protected && !current)}
        onClick={() => {
          if (!window.confirm('Retire this signing key? It can never sign again. Earlier drafts still verify here; send the new public key to verifying offices.')) return;
          void run(async () => done(await shell.retireSigner(status.protected ? current : undefined),
            'Key retired. A new key will be made at the next export.'));
        }}>Retire key</button>
    </div>
  </section>;
}

function AuditAnchor({ busy, run, setMessage }: SectionProps) {
  const [anchor, setAnchor] = useState('');
  const normalised = anchor.trim().toLowerCase();
  return <section className="grid gap-3 rounded border bg-white p-4" aria-label="Audit log anchor">
    <h2 className="font-semibold">Audit log anchor</h2>
    <p className="text-sm text-slate-700">Print the current audit-log hash on a DLSA handoff sheet. The DLSA keeps it; a later rewrite of the log will no longer contain that hash.</p>
    <button className={btn} disabled={busy} onClick={() => void run(async () => {
      const saved = await shell.exportHandoff('en');
      if (saved) setMessage('Handoff sheet saved as ' + saved.file + '. Anchor: ' + saved.head);
    })}>Print DLSA handoff sheet</button>
    <form className="grid gap-2" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const { chain, entries } = await shell.checkAnchor(normalised);
        setMessage(chain === 'intact'
          ? 'Audit log intact: the anchor is in the verified chain (' + entries + ' entries).'
          : 'MISMATCH: the audit log does not verify or no longer contains this anchor. Report this to the DLSA.');
      });
    }}>
      <label>Anchor from a DLSA sheet
        <input className={field + ' font-mono'} value={anchor} spellCheck={false} required onChange={event => setAnchor(event.target.value)} />
      </label>
      <button className={btn} disabled={busy || !/^[0-9a-f]{64}$/.test(normalised)}>Check the audit log</button>
    </form>
  </section>;
}
