import { createHash } from 'node:crypto';
import type { CourtPlusApi } from '@courtplus/contracts';
import { prepareRedaction } from './anonymise.js';
import { extractText } from './extract.js';
import { runNer } from './ner.js';
import { normaliseOrderText } from './normalise.js';
import { suggestFieldsWithRedaction } from './suggest.js';

export { anonymise } from './anonymise.js';
export type { AnonymisedOrder, AnonymiseOptions } from './anonymise.js';
export { extractText } from './extract.js';
export type { ExtractedOrder, ExtractedPage } from './extract.js';
export { runNer } from './ner.js';
export { normaliseOrderText } from './normalise.js';
export { chargedOffenceSuggestions, parseChargeSuggestion, suggestFields } from './suggest.js';

type OrderFile = Parameters<CourtPlusApi['importOrder']>[0];
type ImportedOrder = Awaited<ReturnType<CourtPlusApi['importOrder']>>;

function mimeType(bytes: Uint8Array): string {
  if (Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) return 'application/pdf';
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw new Error('Unsupported order format. Use PDF, PNG or JPEG.');
}

export const AI_UNAVAILABLE = 'AI unavailable: manual entry';

/** The contract result, plus a flag when the model could not run and only rule-based help is shown. */
export type ImportedOrderResult = ImportedOrder & { aiUnavailable?: typeof AI_UNAVAILABLE };

export async function importOrder(file: OrderFile, modelDir: string): Promise<ImportedOrderResult> {
  const { bytes } = file;
  const docId = createHash('sha256').update(bytes).digest('hex');
  const extracted = await extractText(bytes, mimeType(bytes));
  const text = normaliseOrderText(extracted.text);
  // A missing or broken model must not block the officer: fall back to patterns and rule-only masking.
  let aiUnavailable = false;
  const entities = await runNer(text, modelDir).catch(() => {
    aiUnavailable = true;
    return [];
  });
  for (const entity of entities) {
    entity.page = text.slice(0, entity.start).split('\f').length;
  }
  const { redactSpan } = prepareRedaction(text, entities);
  return {
    docId,
    text,
    pages: extracted.pages.length,
    ocr: extracted.ocr,
    entities: entities.map(entity => ({ ...entity, text: redactSpan(entity.start, entity.end) })),
    suggestions: suggestFieldsWithRedaction(text, entities, redactSpan),
    redactedText: redactSpan(0, text.length),
    ...(aiUnavailable ? { aiUnavailable: AI_UNAVAILABLE } : {}),
  };
}
