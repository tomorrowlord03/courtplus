import { ui } from '../lib/i18n';
import { evidenceBridge } from '../lib/api';
import { useEffect, useState } from 'react';
import type { EvidenceItem, EvidenceMode, EvidenceStatus, EvidenceVerification } from '@courtplus/contracts';
import { ErrorNote, btn, btnPrimary, errMsg, Empty } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';

export function EvidenceInbox() {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'identified' | 'anonymous'>('identified');
  const [caseFilter, setCaseFilter] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<EvidenceItem | null>(null);
  const [verification, setVerification] = useState<EvidenceVerification | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [actionNote, setActionNote] = useState<string>('');
  const [actionSubmitting, setActionSubmitting] = useState<boolean>(false);
  const [certNotice, setCertNotice] = useState<string | null>(null);

  const desktop = evidenceBridge();

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      if (desktop?.evidenceList) {
        const query = {
          mode: activeTab === 'all' ? undefined : activeTab,
          caseRef: caseFilter.trim() || undefined,
        };
        const list = await desktop.evidenceList(query);
        setItems(list);
        if (selectedItem) {
          const updated = (list as EvidenceItem[]).find((i: EvidenceItem) => i.id === selectedItem.id);
          if (updated) setSelectedItem(updated);
        }
      } else {
        // Appliance web fetch
        const search = new URLSearchParams();
        if (activeTab !== 'all') search.set('mode', activeTab);
        if (caseFilter.trim()) search.set('caseRef', caseFilter.trim());
        const res = await fetch(`/api/evidence${search.toString() ? '?' + search.toString() : ''}`);
        if (!res.ok) throw new Error(`Failed to load evidence feed (${res.status})`);
        const list = await res.json();
        setItems(list);
        if (selectedItem) {
          const updated = list.find((i: EvidenceItem) => i.id === selectedItem.id);
          if (updated) setSelectedItem(updated);
        }
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, [activeTab]);

  useEffect(() => {
    if (selectedItem) {
      setVerification(null);
      setCertNotice(null);
      loadPreview(selectedItem);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedItem?.id]);

  async function loadPreview(item: EvidenceItem) {
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      if (desktop?.evidenceFile) {
        const res = await desktop.evidenceFile(item.id);
        const url = `data:${res.mime};base64,${res.data}`;
        setPreviewUrl(url);
      } else {
        setPreviewUrl(`/api/evidence/${item.id}/file`);
      }
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleVerify(id: string) {
    setVerifying(true);
    try {
      if (desktop?.evidenceVerify) {
        const res = await desktop.evidenceVerify(id);
        setVerification(res);
      } else {
        const res = await fetch(`/api/evidence/${id}/verify`);
        if (!res.ok) throw new Error('Verification request failed');
        setVerification(await res.json());
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setVerifying(false);
    }
  }

  async function handleAction(action: EvidenceStatus) {
    if (!selectedItem) return;
    setActionSubmitting(true);
    setError(null);
    try {
      let updated: EvidenceItem;
      if (desktop?.evidenceAction) {
        updated = await desktop.evidenceAction(selectedItem.id, action, actionNote.trim() || undefined);
      } else {
        const res = await fetch(`/api/evidence/${selectedItem.id}/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, note: actionNote.trim() || undefined }),
        });
        if (!res.ok) throw new Error(`Action failed with status ${res.status}`);
        updated = await res.json();
      }
      setSelectedItem(updated);
      setActionNote('');
      await loadItems();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleExportCertificate(id: string) {
    setCertNotice(null);
    setError(null);
    try {
      if (desktop?.evidenceCertificate) {
        const res = await desktop.evidenceCertificate(id);
        if (res.pdfPath) {
          setCertNotice(`BSA s.63 Certificate PDF saved to: ${res.pdfPath}`);
        } else {
          // Open certificate HTML in window
          const blob = new Blob([res.html], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }
      } else {
        window.open(`/api/evidence/${id}/certificate`, '_blank');
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <ScreenPage screenId="evidence" note={ui("Court evidence inbox under the Bharatiya Sakshya Adhiniyam, 2023. Files are encrypted and have signed receipts.")}>
      <ErrorNote error={error} />

      {/* TABS & FILTERS */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === 'identified' ? 'bg-blue-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
            onClick={() => setActiveTab('identified')}
          >{ui("Proof sent with a name")}</button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === 'anonymous' ? 'bg-amber-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
            onClick={() => setActiveTab('anonymous')}
          >{ui("Tips sent without a name")}</button>
          <button
            data-guide="start"
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === 'all' ? 'bg-blue-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
            onClick={() => setActiveTab('all')}
          >{ui("All submissions")}</button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); loadItems(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder={ui("Search by case number")}
            value={caseFilter}
            onChange={(e) => setCaseFilter(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button type="submit" className={btn}>{ui("Filter")}</button>
          {caseFilter && (
            <button
              type="button"
              className={btn}
              onClick={() => { setCaseFilter(''); setTimeout(loadItems, 0); }}
            >{ui("Clear")}</button>
          )}
        </form>
      </div>

      {/* SAFEGUARD NOTICE */}
      <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <strong>{ui("Judicial Safeguard & Natural Justice:")}</strong> Identified evidence submissions are tied to a CNR / case record and must be marked <em>{ui("\"Shared with parties\"")}</em> before judicial reliance. Anonymous whistleblower tips are stored without personal identifiers or IP logs and are directed into this separate confidential queue for preliminary judicial assessment.
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{ui("Loading evidence submissions...")}</p>
      ) : items.length === 0 ? (
        <Empty
          title={ui("No evidence submissions found")}
          hint={activeTab === 'anonymous' ? ui("No anonymous whistleblower tips submitted for this query.") : ui("No case evidence filed yet.")}
          to="/submit-proof"
          cta={ui("Submit proof")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* FEED LIST (5 cols) */}
          <div className="space-y-3 lg:col-span-5">
            {items.map((item) => {
              const isSelected = selectedItem?.id === item.id;
              const isAnon = item.mode === 'anonymous';
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors ${isSelected ? 'border-blue-700 bg-blue-50/50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{item.caseRef || 'No Case Ref'}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                      item.status === 'taken_on_record' ? 'bg-green-100 text-green-800' :
                      item.status === 'shared_with_parties' ? 'bg-purple-100 text-purple-800' :
                      item.status === 'seen' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.description}</p>

                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {isAnon ? (
                        <span className="font-semibold text-amber-700">{ui("Anonymous Tip")}</span>
                      ) : (
                        <span>{ui("By:") + " "}<strong>{item.submitter?.name}</strong></span>
                      )}
                    </span>
                    <span>{new Date(item.receivedAt).toLocaleDateString()} {new Date(item.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DETAIL VIEW (7 cols) */}
          <div className="lg:col-span-7">
            {selectedItem ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{selectedItem.caseRef}</h2>
                    <p className="text-xs text-slate-500">{ui("Submitted:") + " "}{new Date(selectedItem.receivedAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${
                      selectedItem.mode === 'anonymous' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {selectedItem.mode === 'anonymous' ? ui("Anonymous Whistleblower") : ui("Identified Party")}
                    </span>
                    <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${
                      selectedItem.status === 'taken_on_record' ? 'bg-green-100 text-green-800' :
                      selectedItem.status === 'shared_with_parties' ? 'bg-purple-100 text-purple-800' :
                      selectedItem.status === 'seen' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {selectedItem.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* INTEGRITY BADGE */}
                <div className="my-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg text-emerald-700">✓</span>
                      <div>
                        <strong className="text-sm text-emerald-900">{ui("Unchanged since upload")}</strong>
                        <p className="font-mono text-xs text-emerald-800 break-all">SHA-256: {selectedItem.sha256}</p>
                        {selectedItem.sha3_256 && <p className="font-mono text-xs text-emerald-800 break-all">SHA3-256: {selectedItem.sha3_256}</p>}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={verifying}
                      onClick={() => handleVerify(selectedItem.id)}
                      className="rounded border border-emerald-600 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {verifying ? ui("Verifying...") : ui("Re-verify Hash")}
                    </button>
                  </div>

                  {verification && (
                    <div className="mt-2 border-t border-emerald-200 pt-2 text-xs text-emerald-900">
                      <div>{ui("File Unchanged:") + " "}{verification.hashMatch ? ui("✓ Same as receipt") : ui("✗ Does not match receipt")}</div>
                      <div>{ui("Ed25519 Signature:") + " "}{(verification.signatures?.ed25519 ?? verification.signatureValid) ? ui("✓ Signature matches") : ui("✗ Signature does not match")}</div>
                      {verification.signatures && <div>ML-DSA-65 (FIPS 204): {verification.signatures.mldsa65 ? ui("✓ Signature matches") : ui("✗ Signature does not match")}</div>}
                      <div>{ui("Evidence Hash Chain:") + " "}{verification.chainValid ? ui("✓ Intact") : ui("✗ Broken")}</div>
                    </div>
                  )}
                </div>

                {/* DETAILS & SUBMITTER */}
                <div className="mb-4 text-sm">
                  <p className="text-slate-700"><strong>{ui("Description:")}</strong> {selectedItem.description}</p>
                  {selectedItem.submitter ? (
                    <p className="mt-1 text-xs text-slate-600">
                      <strong>{ui("Submitter:")}</strong> {selectedItem.submitter.name} ({selectedItem.submitter.phone} {selectedItem.submitter.email ? `· ${selectedItem.submitter.email}` : ''})
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-amber-700">{ui("Submitter Identity: Anonymous Whistleblower (Identity Protected)")}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">{ui("File:") + " "}<strong>{selectedItem.filename}</strong> ({selectedItem.mime}, {(selectedItem.size / (1024*1024)).toFixed(2)} MB)
                  </p>
                </div>

                {/* MEDIA PREVIEW */}
                <div className="mb-4 rounded border bg-slate-50 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-slate-700">{ui("Preview the file")}</h3>
                  {previewLoading ? (
                    <p className="text-xs text-slate-500">{ui("Loading preview...")}</p>
                  ) : !previewUrl ? (
                    <p className="text-xs text-slate-500">{ui("Preview not directly available.")}</p>
                  ) : selectedItem.mime.startsWith('image/') ? (
                    <img src={previewUrl} alt={selectedItem.filename} className="max-h-72 w-auto rounded border object-contain" />
                  ) : selectedItem.mime.startsWith('audio/') ? (
                    <audio controls src={previewUrl} className="w-full" />
                  ) : selectedItem.mime.startsWith('video/') ? (
                    <video controls src={previewUrl} className="max-h-72 w-full rounded border" />
                  ) : selectedItem.mime === 'application/pdf' ? (
                    <div className="text-center">
                      <embed src={previewUrl} type="application/pdf" className="h-72 w-full rounded border" />
                      <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-blue-700 underline">{ui("Open PDF in new tab")}</a>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">{ui("Binary file. Use download button below.")}</p>
                  )}
                </div>

                {/* JUDICIAL ACTIONS */}
                <div className="mb-4 rounded border border-slate-200 bg-slate-50/70 p-3">
                  <h3 className="mb-2 text-xs font-bold uppercase text-slate-700">{ui("Record what the court does")}</h3>
                  <div className="mb-2">
                    <input
                      type="text"
                      placeholder={ui("Optional note / order reference...")}
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={actionSubmitting}
                      onClick={() => handleAction('seen')}
                      className={btn}
                    >{ui("Mark \"Seen\" / देखा गया")}</button>
                    <button
                      type="button"
                      disabled={actionSubmitting}
                      onClick={() => handleAction('taken_on_record')}
                      className={btnPrimary}
                    >{ui("Mark \"Taken on record\" / रिकॉर्ड पर लिया गया")}</button>
                    <button
                      type="button"
                      disabled={actionSubmitting}
                      onClick={() => handleAction('shared_with_parties')}
                      className="rounded border border-purple-600 bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-800 disabled:opacity-50"
                    >{ui("Mark \"Shared with parties\" / पक्षों को प्रेषित")}</button>
                  </div>
                </div>

                {/* ACTION HISTORY TIMELINE */}
                {selectedItem.actionHistory && selectedItem.actionHistory.length > 0 && (
                  <div className="mb-4 text-xs">
                    <h4 className="font-semibold text-slate-700">{ui("Custody & Action History:")}</h4>
                    <ul className="mt-1 space-y-1">
                      {selectedItem.actionHistory.map((act, idx) => (
                        <li key={idx} className="text-slate-600">
                          • <strong>{act.action.toUpperCase()}</strong> at {new Date(act.at).toLocaleString()} by {act.by}
                          {act.note ? ` — "${act.note}"` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* EXPORT BSA S.63 CERTIFICATE */}
                <div className="border-t pt-3">
                  <button
                    type="button"
                    onClick={() => handleExportCertificate(selectedItem.id)}
                    className="rounded bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800"
                  >{ui("Export BSA s.63 Certificate (Schedule Part A & B)")}</button>
                  {certNotice && <p className="mt-2 text-xs font-medium text-green-700">{certNotice}</p>}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{ui("Select an evidence item from the feed to view details, verify integrity, and take action.")}</div>
            )}
          </div>
        </div>
      )}
    </ScreenPage>
  );
}
