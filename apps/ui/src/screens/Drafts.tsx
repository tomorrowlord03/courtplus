import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { CaseRecord, CourtPlusApi, Status } from '@courtplus/contracts';
import { DRAFT_LANGS, RIGHTS_CARD_LANGS, translations } from '../lib/i18n';
import { todayIST, useApp } from '../lib/context';
import { Empty, ErrorNote, Page, btnPrimary, errMsg } from '../components/ui';

type Kind = Parameters<CourtPlusApi['exportDraft']>[0];
const KINDS: [Kind, string][] = [
  ['S479_3_APPLICATION', 'Application under s.479(3)'],
  ['DLSA_7_DAY', 'DLSA 7-day note'],
  ['AI_ASSISTANCE_NOTE', 'AI assistance note'],
  ['RIGHTS_CARD', 'Rights card'],
];

const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');

export function Drafts() {
  const { api, view } = useApp();
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [caseId, setCaseId] = useState('');
  const [kind, setKind] = useState<Kind>('S479_3_APPLICATION');
  const [lang, setLang] = useState('en');
  const [out, setOut] = useState<{ pdfPath: string; receiptPath: string; manifestPath: string } | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Engine status for the selected case; undefined while loading or if screening failed.
  const [status, setStatus] = useState<{ caseId: string; asOf: string; status: Status }>();

  useEffect(() => { api.listCases().then((c) => { setCases(c); setCaseId(c[0]?.id ?? ''); }, (e) => setError(errMsg(e))); }, [api]);

  const record = cases?.find((c) => c.id === caseId);
  useEffect(() => {
    if (!record) return;
    let live = true;
    // Same as-of date the desktop export uses, so the offer here matches what export will accept.
    const asOf = record.orderDate ?? todayIST();
    api.screen(record.id, asOf).then(
      (r) => { if (live) setStatus({ caseId: record.id, asOf, status: r.status }); },
      () => { if (live) setStatus(undefined); },
    );
    return () => { live = false; };
  }, [api, record]);

  // Fail closed: the s.479(3) application is offered only once the engine says APPLY_NOW.
  const canApply = status?.caseId === caseId && status.status === 'APPLY_NOW';
  const kinds = KINDS.filter(([k]) => k !== 'S479_3_APPLICATION' || canApply);
  useEffect(() => {
    if (!kinds.some(([k]) => k === kind)) { setKind(kinds[0][0]); setLang('en'); }
  }, [canApply, kind]); // eslint-disable-line react-hooks/exhaustive-deps -- kinds derives from canApply

  const langs: [string, string][] = kind === 'RIGHTS_CARD' ? RIGHTS_CARD_LANGS : DRAFT_LANGS.map((l) => [l, l === 'en' ? 'English' : 'हिन्दी (Hindi)']);

  const isReviewed = lang === 'en' || (translations[lang] as unknown as { _meta?: { reviewed?: boolean } })?._meta?.reviewed === true;

  const run = async () => {
    setBusy(true); setError(null); setOut(null);
    try {
      const res = await api.exportDraft(kind, caseId, lang);
      setOut(res);
      setQr(await QRCode.toDataURL(baseName(res.receiptPath), { margin: 1, width: 160 }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (cases && cases.length === 0) {
    return <Page title="Drafts"><Empty title="No cases to draft for" hint="Import a court order to begin." to="/import" cta="Import order" /></Page>;
  }

  return (
    <Page title="Drafts" note={view === 'legal_aid' ? 'Prepare and check. The jail superintendent attests and files the s.479(3) application; a lawyer reviews flagged cases. The court decides.' : 'Drafts are prepared by legal-aid staff.'}>
      <ErrorNote error={error} />
      <div className="grid max-w-xl gap-3">
        <label>Case
          <select className="mt-1 block w-full rounded border px-2 py-1.5" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {cases?.map((c) => <option key={c.id} value={c.id}>{c.caseNo ?? c.cnr ?? c.id}</option>)}
          </select>
        </label>
        <label>Draft type
          <select className="mt-1 block w-full rounded border px-2 py-1.5" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setLang('en'); }}>
            {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {status?.caseId === caseId && !canApply && (
          <p className="text-sm text-slate-700" data-testid="s479-hidden">
            No s.479(3) application: the engine result as of {status.asOf} is {status.status.replace(/_/g, ' ')}, not Apply now.
            {status.status === 'NEEDS_LAWYER_REVIEW' || status.status === 'OUTSIDE_SCREEN' ? ' Send this case for lawyer review.' : ''}
          </p>
        )}
        <label>Language
          <select className="mt-1 block w-full rounded border px-2 py-1.5" value={lang} onChange={(e) => setLang(e.target.value)}>
            {langs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {kind === 'RIGHTS_CARD' && !isReviewed && (
          <p className="text-sm text-amber-800">
            {lang === 'hi'
              ? '▲ Machine translation, not yet reviewed. Only the English card and the reviewed Hindi legal drafts are authoritative.'
              : '▲ Machine translation, not legally reviewed. The English text is authoritative.'}
          </p>
        )}
        <button className={btnPrimary} disabled={!caseId || busy} onClick={() => void run()}>
          {busy ? 'Preparing…' : 'Export signed PDF'}
        </button>
      </div>
      {out && (
        <section className="mt-6 rounded border bg-white p-3" aria-label="Export result">
          <h2 className="font-semibold">Signed PDF ready</h2>
          <p className="text-sm">Receipt ID: <code data-testid="receipt-id">{baseName(out.receiptPath)}</code></p>
          {qr && <img src={qr} alt="QR code for the receipt ID" width={160} height={160} />}
          {/* No file:// preview: the desktop CSP blocks local file loads by design. */}
          <p className="break-all text-sm">Saved to <span className="text-slate-600">{out.pdfPath}</span></p>
        </section>
      )}
    </Page>
  );
}
