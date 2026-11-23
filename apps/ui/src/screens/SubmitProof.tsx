import { evidenceBridge } from '../lib/api';
import { useState, type FormEvent, type ChangeEvent } from 'react';
import type { EvidenceMode, EvidenceReceiptResponse, EvidenceStatusResponse } from '@courtplus/contracts';
import { Page, ErrorNote, btn, btnPrimary, errMsg } from '../components/ui';

interface Props {
  initialRole?: 'citizen' | 'lawyer';
}

export function SubmitProof({ initialRole = 'citizen' }: Props) {
  const isLawyer = initialRole === 'lawyer';
  const [mode, setMode] = useState<EvidenceMode>('identified');
  const [caseRef, setCaseRef] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [name, setName] = useState<string>(isLawyer ? 'Advocate ' : '');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [court, setCourt] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<EvidenceReceiptResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'submit' | 'status'>('submit');

  // Status check
  const [statusCode, setStatusCode] = useState<string>('');
  const [statusChecking, setStatusChecking] = useState<boolean>(false);
  const [statusResult, setStatusResult] = useState<EvidenceStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const desktop = evidenceBridge();

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const selected = e.target.files?.[0];
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      setError('File exceeds maximum allowed limit of 50 MB.');
      e.target.value = '';
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }
    if (mode === 'identified' && (!name.trim() || !phone.trim())) {
      setError('Name and phone number are required for identified submissions.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setReceipt(null);

    try {
      if (desktop?.evidenceSubmit) {
        const fileBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(fileBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const res = await desktop.evidenceSubmit({
          caseRef: caseRef.trim(),
          description: description.trim(),
          mode,
          name: mode === 'identified' ? name.trim() : undefined,
          phone: mode === 'identified' ? phone.trim() : undefined,
          email: mode === 'identified' && email.trim() ? email.trim() : undefined,
          court: court.trim() || undefined,
          fileName: file.name,
          fileBytes: base64,
        });
        setReceipt(res);
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('caseRef', caseRef.trim());
        formData.append('description', description.trim());
        formData.append('mode', mode);
        if (mode === 'identified') {
          formData.append('name', name.trim());
          formData.append('phone', phone.trim());
          if (email.trim()) formData.append('email', email.trim());
        }
        if (court.trim()) formData.append('court', court.trim());

        const res = await fetch('/evidence', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        setReceipt(data);
      }
    } catch (ex) {
      setError(errMsg(ex));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckStatus(e: FormEvent) {
    e.preventDefault();
    if (!statusCode.trim()) return;
    setStatusChecking(true);
    setStatusError(null);
    setStatusResult(null);

    try {
      if (desktop?.evidenceStatus) {
        const res = await desktop.evidenceStatus(statusCode.trim());
        setStatusResult(res);
      } else {
        const res = await fetch(`/evidence/status/${encodeURIComponent(statusCode.trim())}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Receipt code not found. Please check and re-enter.');
          throw new Error(`Status check failed (${res.status})`);
        }
        setStatusResult(await res.json());
      }
    } catch (ex) {
      setStatusError(errMsg(ex));
    } finally {
      setStatusChecking(false);
    }
  }

  return (
    <Page
      title={isLawyer ? 'File Evidence (Counsel / Advocate)' : 'Submit Proof / साक्ष्य प्रस्तुत करें'}
      note={isLawyer ? 'Official filing of case evidence with cryptographic receipt under Bharatiya Sakshya Adhiniyam, 2023.' : 'Citizen-to-judge secure vault and anonymous whistleblower channel.'}
    >
      {/* TABS */}
      <div className="mb-4 flex gap-2 border-b pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('submit')}
          className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === 'submit' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          {isLawyer ? 'File Evidence / साक्ष्य दाखिल करें' : 'Submit Evidence / साक्ष्य भेजें'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('status')}
          className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === 'status' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          Check Status by Code / रसीद कोड से स्थिति जांचें
        </button>
      </div>

      {activeTab === 'submit' && (
        <div className="max-w-2xl">
          <ErrorNote error={error} />

          {/* MODE TOGGLE (Only for citizens, lawyers are identified) */}
          {!isLawyer && (
            <div className="mb-4 flex gap-3">
              <button
                type="button"
                onClick={() => setMode('identified')}
                className={`flex-1 rounded-lg border-2 p-3 text-center transition-colors ${mode === 'identified' ? 'border-blue-700 bg-blue-50 text-blue-900 font-semibold' : 'border-slate-300 bg-white text-slate-600'}`}
              >
                <div>Identified Submission</div>
                <div className="text-xs text-slate-500 font-normal">Tied to case, shared with parties per natural justice</div>
              </button>
              <button
                type="button"
                onClick={() => setMode('anonymous')}
                className={`flex-1 rounded-lg border-2 p-3 text-center transition-colors ${mode === 'anonymous' ? 'border-amber-600 bg-amber-50 text-amber-900 font-semibold' : 'border-slate-300 bg-white text-slate-600'}`}
              >
                <div>Anonymous Whistleblower Tip</div>
                <div className="text-xs text-slate-500 font-normal">Identity-blind, no personal data or IP stored</div>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            {mode === 'identified' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">{isLawyer ? 'Advocate Name' : 'Full Name'} *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={isLawyer ? 'e.g. Adv. Rajesh Verma' : 'Your legal name'}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91-9876543210"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">Email Address (Optional)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="advocate@bar.example.test"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Case Reference (CNR / Case No) *</label>
                <input
                  type="text"
                  required
                  value={caseRef}
                  onChange={(e) => setCaseRef(e.target.value)}
                  placeholder="e.g. DLCT01-001234-2026"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">Court / Police Station (Optional)</label>
                <input
                  type="text"
                  value={court}
                  onChange={(e) => setCourt(e.target.value)}
                  placeholder="e.g. Tis Hazari Court / Kotwali"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Evidence Description *</label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this evidence demonstrates..."
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Attach File * <span className="font-normal text-slate-500">(Max 50 MB: JPG, PNG, WEBP, PDF, MP3, M4A, WAV, WEBM, MP4)</span>
              </label>
              <input
                type="file"
                required
                onChange={onFileChange}
                accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.m4a,.wav,.webm,.mp4"
                className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:rounded file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`w-full py-2.5 ${btnPrimary}`}
            >
              {submitting ? 'Encrypting & Sealing in Vault...' : isLawyer ? 'File Evidence on Record' : 'Submit Encrypted Evidence'}
            </button>
          </form>

          {/* RECEIPT MODAL / DISPLAY */}
          {receipt && (
            <div className="mt-6 rounded-lg border border-emerald-400 bg-emerald-50 p-6 shadow-sm">
              <h3 className="text-base font-bold text-emerald-900">✓ Evidence Received and Cryptographically Sealed</h3>
              <p className="mt-1 text-xs text-emerald-800">
                Encrypted at rest with AES-256-GCM. Signed with Ed25519 over RFC 8785 canonical JSON.
              </p>

              {receipt.receiptCode && (
                <div className="my-4 rounded border-2 border-dashed border-amber-500 bg-amber-100 p-4 text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
                    Important: Save Your 128-bit Receipt Code (Shown Once Only)
                  </p>
                  <p className="mt-1 font-mono text-xl font-bold tracking-widest text-amber-950 select-all">
                    {receipt.receiptCode}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    You will need this code to check the status of your anonymous submission.
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-1 text-xs text-slate-700">
                <div><strong>Vault ID:</strong> <span className="font-mono">{receipt.id}</span></div>
                <div><strong>SHA-256:</strong> <span className="font-mono break-all">{receipt.sha256}</span></div>
                <div><strong>Timestamp:</strong> {receipt.receivedAt}</div>
                <div><strong>Mode:</strong> {receipt.mode.toUpperCase()}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STATUS CHECK */}
      {activeTab === 'status' && (
        <div className="max-w-xl">
          <ErrorNote error={statusError} />
          <form onSubmit={handleCheckStatus} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-700">128-bit Anonymous Receipt Code</label>
              <input
                type="text"
                required
                value={statusCode}
                onChange={(e) => setStatusCode(e.target.value)}
                placeholder="Enter 32-character receipt code"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={statusChecking}
              className={`w-full py-2 ${btnPrimary}`}
            >
              {statusChecking ? 'Querying Vault...' : 'Check Status'}
            </button>
          </form>

          {statusResult && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">{statusResult.caseRef}</span>
                <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase ${
                  statusResult.status === 'taken_on_record' ? 'bg-green-100 text-green-800' :
                  statusResult.status === 'shared_with_parties' ? 'bg-purple-100 text-purple-800' :
                  statusResult.status === 'seen' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                }`}>
                  {statusResult.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                <div><strong>Submitted On:</strong> {new Date(statusResult.receivedAt).toLocaleString()}</div>
                <div><strong>Vault ID:</strong> <span className="font-mono">{statusResult.id}</span></div>
                <div><strong>SHA-256 Hash:</strong> <span className="font-mono break-all">{statusResult.sha256}</span></div>
                {statusResult.description && <div><strong>Description:</strong> {statusResult.description}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
