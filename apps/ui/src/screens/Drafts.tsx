import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { CaseRecord, CourtPlusApi, Status } from '@courtplus/contracts';
import { DRAFT_LANGS, RIGHTS_CARD_LANGS, isReviewedLanguage } from '../lib/i18n';
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

const previewTags = new Set(['div', 'section', 'p', 'h1', 'h2', 'h3', 'span', 'strong', 'b', 'em',
  'i', 'br', 'bdi', 'code', 'blockquote', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);

function renderPreview(html: string) {
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
  function renderNode(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element) || !previewTags.has(node.localName)) return null;
    const tag = node.localName === 'h1' ? 'h3' : node.localName === 'a' ? 'span' : node.localName;
    return createElement(tag, { key }, ...Array.from(node.childNodes, renderNode));
  }
  return main ? Array.from(main.childNodes, renderNode) : null;
}

export function Drafts() {
  const { api, view, profile, language } = useApp();
  const [searchParams] = useSearchParams();
  const requestedCaseId = searchParams.get('caseId');
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [selection, setSelection] = useState<{ requestedCaseId: string | null; caseId: string; kind?: Kind }>();
  const [lang, setLang] = useState<string>();
  const [out, setOut] = useState<{ pdfPath: string; receiptPath: string; manifestPath: string } | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ key: string; html?: string; error?: string }>();
  // Engine status for the selected case; undefined while loading or if screening failed.
  const [status, setStatus] = useState<{ caseId: string; asOf: string; status: Status }>();

  useEffect(() => {
    let live = true;
    api.listCases().then((c) => { if (live) setCases(c); }, (e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [api]);

  const currentSelection = selection?.requestedCaseId === requestedCaseId ? selection : undefined;
  const record = cases?.find((c) => c.id === (currentSelection?.caseId ?? requestedCaseId)) ?? cases?.[0];
  const caseId = record?.id ?? '';
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
  const defaultKind = record?.bailGrantedOn ? 'DLSA_7_DAY' : 'AI_ASSISTANCE_NOTE';
  const selectedKind = currentSelection?.kind;
  const kind = selectedKind && kinds.some(([k]) => k === selectedKind) ? selectedKind : defaultKind;
  const langs = kind === 'RIGHTS_CARD' ? RIGHTS_CARD_LANGS : DRAFT_LANGS;
  const preferredLanguage = lang ?? language;
  const exportLang = langs.some(([code]) => code === preferredLanguage) ? preferredLanguage : 'en';

  const previewKey = JSON.stringify([caseId, kind, exportLang]);
  const previewDraft = api.previewDraft;
  useEffect(() => {
    if (!caseId || !previewDraft) return;
    let live = true;
    void previewDraft(kind, caseId, exportLang).then(
      html => { if (live) setPreview({ key: previewKey, html }); },
      error => { if (live) setPreview({ key: previewKey, error: errMsg(error) }); },
    );
    return () => { live = false; };
  }, [caseId, kind, exportLang, previewKey, previewDraft]);
  const currentPreview = preview?.key === previewKey ? preview : undefined;

  const run = async () => {
    setBusy(true); setError(null); setOut(null);
    try {
      const res = await api.exportDraft(kind, caseId, exportLang);
      setOut(res);
      setQr(await QRCode.toDataURL(baseName(res.receiptPath), { margin: 1, width: 160 }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Drafting studio" note={view === 'legal_aid' ? 'Prepare and check. The jail superintendent attests and files the s.479(3) application; a lawyer reviews flagged cases. The court decides.' : 'Drafts are prepared by legal-aid staff.'}>
      <ErrorNote error={error} />
      <div className="draft-studio">
      <section className="panel grid content-start gap-4" aria-label="Draft parameters">
        <h2 className="text-lg font-semibold">Draft parameters</h2>
        {cases?.length === 0 && <Empty title="No cases to draft for" hint="Import a court order to begin." to="/import" cta="Import order" />}
        <label>Case
          <select className="field-control" value={caseId} disabled={!cases?.length} onChange={(e) => { setSelection({ requestedCaseId, caseId: e.target.value }); setLang(undefined); }}>
            {cases?.map((c) => <option key={c.id} value={c.id}>{c.caseNo ?? c.cnr ?? c.id}</option>)}
          </select>
        </label>
        <label>Draft type
          <select className="field-control" value={kind} onChange={(e) => { setSelection({ requestedCaseId, caseId, kind: e.target.value as Kind }); setLang(undefined); }}>
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
          <select className="field-control" value={exportLang} onChange={(e) => setLang(e.target.value)}>
            {langs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {kind === 'RIGHTS_CARD' && !isReviewedLanguage(exportLang) && (
          <p className="text-sm text-amber-800">
            ▲ Machine translation, not legally reviewed. The English text is authoritative.
          </p>
        )}
        <button className={btnPrimary} disabled={!caseId || busy} onClick={() => void run()}>
          {busy ? 'Preparing…' : 'Export signed PDF'}
        </button>
      </section>
      <section className="panel" aria-label="Draft preview">
        <div className="panel-heading"><h2>Live preview</h2><span className="count-chip">Draft</span></div>
        <div className="draft-paper">
          {currentPreview?.html ? <div lang={exportLang} dir={exportLang === 'ur' ? 'rtl' : 'ltr'}>{renderPreview(currentPreview.html)}</div> : <>
            <h3>{KINDS.find(([k]) => k === kind)?.[1]}</h3>
            {currentPreview?.error && <ErrorNote error={currentPreview.error} />}
            {caseId && previewDraft && !currentPreview && <p role="status">Preparing preview…</p>}
            <dl><div><dt>Case</dt><dd>{record?.caseNo ?? record?.cnr ?? record?.id ?? 'Select a case'}</dd></div>
              <div><dt>Language</dt><dd>{langs.find(([code]) => code === exportLang)?.[1]}</dd></div>
              {profile?.office && <div><dt>Office default</dt><dd>{profile.office}</dd></div>}
              <div><dt>Screening status</dt><dd>{!caseId ? 'Select a case' : status?.caseId === caseId ? status.status.replace(/_/g, ' ') : 'Checking…'}</dd></div></dl>
          </>}
          <p className="draft-disclosure">The signed PDF is generated from confirmed case facts. Check the exported document before filing or sharing.</p>
        </div>
      {out && (
        <section className="mt-6 rounded border p-3" aria-label="Export result">
          <h2 className="font-semibold">Signed PDF ready</h2>
          <p className="text-sm">Receipt ID: <code data-testid="receipt-id">{baseName(out.receiptPath)}</code></p>
          {qr && <img src={qr} alt="QR code for the receipt ID" width={160} height={160} />}
          {/* No file:// preview: the desktop CSP blocks local file loads by design. */}
          <p className="break-all text-sm">Saved to <span className="text-slate-600">{out.pdfPath}</span></p>
        </section>
      )}
      </section>
      </div>
    </Page>
  );
}
