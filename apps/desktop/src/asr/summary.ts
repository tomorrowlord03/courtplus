import type { HearingSummary, SummarySentence, TranscriptVersion } from '@courtplus/contracts' with { 'resolution-mode': 'import' };

/** Words that usually carry what happened at a hearing (English and Hindi). */
const keywords: [string, RegExp][] = [
  ['order', /\b(order(?:ed|s)?|directs?|directed)\b|आदेश|निर्देश/iu],
  ['adjourned', /\badjourn(?:ed|ment|s)?\b|स्थगित/iu],
  ['next date', /\bnext\s+(?:date|hearing)\b|\blisted\s+on\b|अगली\s+(?:तारीख|तिथि|सुनवाई)|पेशी/iu],
  ['evidence', /\bevidence\b|\bexhibit(?:s|ed)?\b|साक्ष्य|सबूत|प्रदर्श/iu],
  ['witness', /\bwitness(?:es)?\b|\bdeposition\b|गवाह|साक्षी/iu],
  ['section', /\bsection\b|\bs\.\s?\d+|धारा/iu],
];

export const summaryLabel = 'Machine summary - verify before use' as const;

interface Sentence { text: string; segmentId: number; startMs: number }

export function splitSentences(version: Pick<TranscriptVersion, 'segments'>): Sentence[] {
  return version.segments.flatMap(segment => segment.text.split(/(?<=[.?!।])\s+/u)
    .map(text => text.trim()).filter(text => text.split(/\s+/).length >= 3)
    .map(text => ({ text, segmentId: segment.id, startMs: segment.startMs })));
}

const stopwords = new Set(('the and for are was were with this that from have has had not but you your his her they them their '
  + 'its our all any can will would shall there here then than into upon about also been being which who whom what when '
  + 'है हैं था थे थी और का की के को में से पर यह वह कि भी तो ही एक इस उस').split(' '));
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)
  ?.filter(word => word.length > 2 && !stopwords.has(word)) ?? []);

/** Classic TextRank: sentence graph weighted by word overlap, ranked by PageRank. */
export function textRank(sentences: readonly string[], iterations = 40, damping = 0.85): number[] {
  const sets = sentences.map(words);
  const weights = sets.map((a, i) => sets.map((b, j) => {
    if (i === j || a.size < 2 || b.size < 2) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared += 1;
    return shared / (Math.log(a.size) + Math.log(b.size));
  }));
  const totals = weights.map(row => row.reduce((sum, weight) => sum + weight, 0));
  let scores = sentences.map(() => 1);
  for (let step = 0; step < iterations; step += 1) {
    scores = scores.map((_, i) => (1 - damping) + damping
      * weights.reduce((sum, row, j) => sum + (totals[j] ? row[i] / totals[j] * scores[j] : 0), 0));
  }
  return scores;
}

export function extractiveSummary(version: TranscriptVersion, limit?: number): HearingSummary {
  const sentences = splitSentences(version);
  const ranks = textRank(sentences.map(sentence => sentence.text));
  const count = limit ?? Math.min(8, Math.max(3, Math.ceil(sentences.length * 0.15)));
  const scored: SummarySentence[] = sentences.map((sentence, index) => {
    const found = keywords.filter(([, pattern]) => pattern.test(sentence.text)).map(([name]) => name);
    return { ...sentence, keywords: found, score: Number((ranks[index] * (1 + found.length)).toFixed(4)) };
  });
  const chosen = [...scored].sort((a, b) => b.score - a.score).slice(0, count);
  return {
    label: summaryLabel, method: 'TextRank with hearing keywords (extractive: sentences are quoted, never rewritten)',
    basedOnVersion: version.version,
    sentences: scored.filter(sentence => chosen.includes(sentence)),
  };
}

type ResearchSummarise = (text: string, options?: { sentences?: number }) => unknown;

/** Uses `@courtplus/research` `summarise` when that package is installed; otherwise the local TextRank. */
export async function summarise(version: TranscriptVersion, load: (name: string) => Promise<unknown> = name => import(name)): Promise<HearingSummary> {
  const local = extractiveSummary(version);
  let research: ResearchSummarise | undefined;
  try {
    const module = await load('@courtplus/research') as { summarise?: unknown };
    if (typeof module.summarise === 'function') research = module.summarise as ResearchSummarise;
  } catch {
    return local;
  }
  if (!research) return local;
  const sentences = splitSentences(version);
  let picked: unknown;
  try {
    picked = await research(sentences.map(sentence => sentence.text).join('\n'), { sentences: local.sentences.length });
  } catch {
    return local; // The package is installed but its model files are not (yet).
  }
  const texts = Array.isArray(picked)
    ? picked.map(item => typeof item === 'string' ? item : (item as { text?: unknown } | null)?.text).filter((item): item is string => typeof item === 'string')
    : typeof picked === 'string' ? picked.split('\n') : [];
  const chosen = local.sentences.length && texts.length
    ? sentences.filter(sentence => texts.some(text => text.trim() === sentence.text)) : [];
  if (!chosen.length) return local;
  return {
    ...local, method: 'Court+ research summariser (extractive)',
    sentences: chosen.map(sentence => ({
      ...sentence, score: 1, keywords: keywords.filter(([, pattern]) => pattern.test(sentence.text)).map(([name]) => name),
    })),
  };
}
