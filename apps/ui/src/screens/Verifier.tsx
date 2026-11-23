import { ui } from '../lib/i18n';
import { useState } from 'react';
import jsQR from 'jsqr';
import type { CourtPlusApi } from '@courtplus/contracts';
import { useApp } from '../lib/context';
import { ErrorNote, btnPrimary, errMsg } from '../components/ui';
import { ScreenPage } from '../components/ScreenIntro';

type Verification = Awaited<ReturnType<CourtPlusApi['verify']>>;
type Result = Verification & {
  signatures?: { ed25519: boolean; mldsa65: boolean };
  legacy?: boolean;
  details?: { type: string; keyId?: string; time?: string; hash?: string; sha3_256?: string };
};
const TONES = {
  good: 'border-green-700 bg-green-50 text-green-900',
  bad: 'border-red-700 bg-red-50 text-red-900',
  neutral: 'border-slate-300 bg-slate-50 text-slate-700',
};

const BADGES: { key: keyof Verification; title: string; good: string; text: Record<string, string> }[] = [
  { key: 'signature', title: 'Signature', good: 'valid', text: { valid: '✓ Signature matches', invalid: '✗ Signature does not match', unknown_signer: '? Unknown signer' } },
  { key: 'pdf', title: 'PDF', good: 'unchanged', text: { unchanged: '✓ Unchanged', changed: '✗ Changed' } },
  { key: 'chain', title: 'Audit chain', good: 'intact', text: { intact: '✓ Intact', mismatch: '✗ Mismatch', not_checked: '– Not checked' } },
];

function verdict(result: Result): { text: string; tone: keyof typeof TONES } {
  if (result.signature === 'unknown_signer') return { text: 'Could not verify the file: unknown signer', tone: 'neutral' };
  if (result.signature === 'invalid') return { text: 'Could not verify the file: invalid signature or missing signed files', tone: 'bad' };
  if (result.pdf === 'changed') return { text: 'Changed after signing', tone: 'bad' };
  return { text: 'Unchanged since signing', tone: 'good' };
}

async function decodeQr(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

async function fileToBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function fileToText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return await file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read text'));
    reader.readAsText(file);
  });
}

export function Verifier() {
  const { api } = useApp();
  const [pdf, setPdf] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [qrText, setQrText] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = result && verdict(result);

  const run = async () => {
    if (!pdf || !receipt) return;
    setError(null); setResult(null);
    try {
      setResult(await api.verify({ pdf: await fileToBytes(pdf), receipt: await fileToText(receipt), manifest: manifest ? await fileToText(manifest) : '{}' }));
    } catch (e) { setError(errMsg(e)); }
  };

  const pick = (label: string, accept: string, onFile: (f: File | null) => void, current: File | null) => (
    <label className="block">{ui(label)}
      <input type="file" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="mt-1 block" />
      {current && <span className="text-xs text-slate-600">{current.name}</span>}
    </label>
  );

  return (
    <ScreenPage screenId="verify" note={ui('Add the file and its receipt. For drafts or hearing records, include the file list (manifest).')}>
      <ErrorNote error={error} />
      <div className="grid max-w-xl gap-3">
        {pick('Signed PDF or original evidence file', '', setPdf, pdf)}
        {pick('Receipt file', '.json,.txt,application/json', setReceipt, receipt)}
        {pick('Manifest file', '.json,application/json', setManifest, manifest)}
        {pick('Or a photo of the QR code (shows the receipt ID)', 'image/*', (f) => {
          if (f) void decodeQr(f).then((v) => setQrText(v ?? ui('No QR code found in this image')), () => setQrText(ui('Could not read this image')));
        }, null)}
        {qrText && <p role="status" className="text-sm">{ui('QR says:')} <code>{qrText}</code></p>}
        <button data-guide="start" className={btnPrimary} disabled={!pdf || !receipt} onClick={() => void run()}>{ui('Check file')}</button>
      </div>
      <div aria-live="polite">
        {result && summary && (
          <section className="mt-6 space-y-3" aria-label={ui("Verification result")}>
            <p className={`rounded-lg border-2 px-4 py-3 font-semibold ${TONES[summary.tone]}`}>{ui(summary.text)}</p>
            {result.details && <dl className="break-all text-sm">
              <dt>{ui('Type')}</dt><dd>{ui(result.details.type)}</dd>
              <dt>{ui('Signer key ID')}</dt><dd>{result.details.keyId ?? ui('Unavailable')}</dd>
              <dt>{ui('Signed at')}</dt><dd>{result.details.time ?? ui('Unavailable')}</dd>
              <dt>SHA-256</dt><dd>{result.details.hash ?? ui('Unavailable')}</dd>
              {result.details.sha3_256 && <><dt>SHA3-256</dt><dd>{result.details.sha3_256}</dd></>}
            </dl>}
            {result.legacy && <p className="text-sm">{ui('Ed25519 only (older receipt)')}</p>}
            {result.signature === 'unknown_signer' && result.signatures?.ed25519 &&
              <p className="text-sm">{ui("Import the issuer's updated key file")}</p>}
            {result.signatures && <div className="text-sm">
              <p>Ed25519: {ui(result.signatures.ed25519 ? '✓ Signature matches' : '✗ Signature does not match')}</p>
              {!result.legacy && <p>ML-DSA-65 (FIPS 204): {ui(result.signatures.mldsa65 ? '✓ Signature matches' : '✗ Signature does not match')}</p>}
            </div>}
            <div className="grid gap-3 md:grid-cols-3">
              {BADGES.map((b) => {
                const value = result[b.key];
                const notChecked = value === 'not_checked' || (b.key === 'pdf' && result.signature !== 'valid');
                const tone = notChecked || value === 'unknown_signer' ? 'neutral' : value === b.good ? 'good' : 'bad';
                return (
                  <div key={b.key} className={`rounded-lg border-2 p-4 text-center ${TONES[tone]}`}>
                    <p className="text-sm uppercase">{ui(b.key === 'pdf' && result.details?.type === 'Evidence receipt' ? 'Evidence file' : b.title)}</p>
                    <p className="text-2xl font-bold">{ui(notChecked ? '– Not checked' : b.text[value])}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </ScreenPage>
  );
}
