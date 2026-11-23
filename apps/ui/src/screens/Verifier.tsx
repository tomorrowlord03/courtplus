import { useState } from 'react';
import jsQR from 'jsqr';
import type { CourtPlusApi } from '@courtplus/contracts';
import { useApp } from '../lib/context';
import { ErrorNote, Page, btnPrimary, errMsg } from '../components/ui';

type Result = Awaited<ReturnType<CourtPlusApi['verify']>>;

const BADGES: { key: keyof Result; title: string; good: string; text: Record<string, string> }[] = [
  { key: 'signature', title: 'Signature', good: 'valid', text: { valid: '✓ Valid', invalid: '✗ Invalid', unknown_signer: '? Unknown signer' } },
  { key: 'pdf', title: 'PDF', good: 'unchanged', text: { unchanged: '✓ Unchanged', changed: '✗ Changed' } },
  { key: 'chain', title: 'Audit chain', good: 'intact', text: { intact: '✓ Intact', mismatch: '✗ Mismatch', not_checked: '– Not checked' } },
];

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

  const run = async () => {
    if (!pdf || !receipt || !manifest) return;
    setError(null); setResult(null);
    try {
      setResult(await api.verify({ pdf: await fileToBytes(pdf), receipt: await fileToText(receipt), manifest: await fileToText(manifest) }));
    } catch (e) { setError(errMsg(e)); }
  };

  const pick = (label: string, accept: string, onFile: (f: File | null) => void, current: File | null) => (
    <label className="block">{label}
      <input type="file" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="mt-1 block" />
      {current && <span className="text-xs text-slate-600">{current.name}</span>}
    </label>
  );

  return (
    <Page title="Verifier" note="Check that a signed PDF is genuine and unchanged. Works offline.">
      <ErrorNote error={error} />
      <div className="grid max-w-xl gap-3">
        {pick('Signed PDF', 'application/pdf', setPdf, pdf)}
        {pick('Receipt file', '.json,.txt,application/json', setReceipt, receipt)}
        {pick('Manifest file', '.json,application/json', setManifest, manifest)}
        {pick('Or a photo of the QR code (shows the receipt ID)', 'image/*', (f) => {
          if (f) void decodeQr(f).then((v) => setQrText(v ?? 'No QR code found in this image'), () => setQrText('Could not read this image'));
        }, null)}
        {qrText && <p role="status" className="text-sm">QR says: <code>{qrText}</code></p>}
        <button className={btnPrimary} disabled={!pdf || !receipt || !manifest} onClick={() => void run()}>Verify</button>
      </div>
      {result && (
        <div className="mt-6 grid gap-3 md:grid-cols-3" aria-live="polite">
          {BADGES.map((b) => {
            const v = result[b.key];
            const ok = v === b.good;
            return (
              <div key={b.key} className={`rounded-lg border-2 p-4 text-center ${ok ? 'border-green-700 bg-green-50' : 'border-red-700 bg-red-50'}`}>
                <p className="text-sm uppercase">{b.title}</p>
                <p className="text-2xl font-bold">{b.text[v]}</p>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
