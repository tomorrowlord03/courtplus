import type { PreTrainedTokenizer } from '@huggingface/transformers';
import type { Span } from './ner.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const units = /[\p{P}\p{Unified_Ideograph}]|[!-\/:-@[-\x60{-~]|[^\s\p{P}\p{Unified_Ideograph}!-\/:-@[-\x60{-~]+/gu;

function project(word: string, pieces: string[], base: number): Span[] {
  if (pieces.length === 1) return [{ start: base, end: base + word.length }];

  const source = [...graphemes.segment(word)];
  for (const transform of [
    (part: string) => part,
    (part: string) => part.toLowerCase(),
    (part: string) => part.normalize('NFD').toLowerCase().replace(/\p{M}/gu, ''),
  ]) {
    const chars: Span[] = [];
    let comparable = '';
    for (const { segment, index } of source) {
      const normal = transform(segment);
      comparable += normal;
      for (let i = 0; i < normal.length; i++) chars.push({ start: base + index, end: base + index + segment.length });
    }
    const clean = pieces.map(piece => piece.replace(/^##/u, ''));
    if (clean.join('') !== comparable) continue;
    let cursor = 0;
    return clean.map(piece => {
      const start = chars[cursor].start;
      cursor += piece.length;
      return { start, end: chars[cursor - 1].end };
    });
  }
  throw new Error('Could not align WordPiece tokens to the original text.');
}

// Transformers.js 4.3 does not emit offsets. Align WordPiece source units and verify
// that the complete encoding uses the same token IDs before applying model indices.
export function wordPieceOffsets(text: string, tokenizer: PreTrainedTokenizer): (Span | undefined)[] {
  const tokenIds: number[] = [];
  const spans: Span[] = [];
  for (const unit of text.matchAll(units)) {
    const pieces = tokenizer.tokenize(unit[0], { add_special_tokens: false });
    if (!pieces.length) continue;
    tokenIds.push(...tokenizer.encode(unit[0], { add_special_tokens: false }));
    spans.push(...project(unit[0], pieces, unit.index));
  }

  const inputIds = tokenizer.encode(text);
  if (!tokenIds.length) return [];
  const unframed = tokenizer.encode(text, { add_special_tokens: false });
  const first = inputIds.findIndex((id, index) => id === tokenIds[0] && tokenIds.every((id, offset) => inputIds[index + offset] === id));
  if (first === -1 || unframed.length !== tokenIds.length || unframed.some((id, index) => tokenIds[index] !== id)) {
    throw new Error('The local NER tokenizer does not match CourtPlus WordPiece source alignment.');
  }
  return [...Array<undefined>(first).fill(undefined), ...spans];
}
