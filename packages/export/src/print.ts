import { encodeReceiptQr } from './qr.js';
import { renderDocument, renderHtml, type DraftData, type DraftKind } from './render.js';
import type { RenderOptions } from './resources.js';
import { createManifest, createReceipt, type ReceiptInput, type SigningKey } from './signing.js';

export type PrintCallback<T = Uint8Array> = (html: string) => T | Promise<T>;

export async function printDraft<K extends DraftKind, T>(
  kind: K,
  data: DraftData[NoInfer<K>],
  lang: string,
  print: PrintCallback<T>,
  options: RenderOptions = {},
): Promise<T> {
  return print(renderHtml(kind, data, lang, options));
}

/** Node test callback for exercising rendering without a PDF printer. */
export function checkHtml(html: string): string {
  if (!html.startsWith('<!doctype html>') || !html.includes('<main>') || !html.trimEnd().endsWith('</html>')) {
    throw new Error('Expected a complete HTML document');
  }
  return html;
}

export interface SignedDraftOptions extends ReceiptInput, RenderOptions {
  key: SigningKey;
  print: PrintCallback;
}

export async function exportSignedDraft<K extends DraftKind>(
  kind: K,
  data: DraftData[NoInfer<K>],
  lang: string,
  options: SignedDraftOptions,
) {
  const { key, print, issuer, createdAt, localizationRoot } = options;
  const document = structuredClone(data);
  const receipt = createReceipt({
    issuer,
    createdAt,
    result: 'result' in document ? document.result : options.result,
    inputs: { screening: options.inputs, document: { kind, data: document, lang } },
  }, key);
  const qr = await encodeReceiptQr(receipt.receiptId, key.keyId, receipt.receiptDigest);
  const html = renderDocument(kind, document, lang, { localizationRoot }, qr);
  const pdf = Uint8Array.from(await print(html));
  return { pdf, ...receipt, manifest: createManifest(pdf, receipt.receipt, key) };
}
