export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const abbreviation = /\b(?:v|vs|mr|mrs|dr|no|nos|sec|art|para|shri|smt)\.$/iu;
const early = new Set(['Fact', 'Issue']);
const late = new Set(['RatioOfTheDecision', 'RulingByPresentCourt']);

export function sentences(text: string): Sentence[] {
  const result: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const start = index + segment.length - segment.trimStart().length;
    const end = start + trimmed.length;
    const previous = result.at(-1);
    if (previous && abbreviation.test(previous.text)) {
      previous.text = text.slice(previous.start, end);
      previous.end = end;
    } else {
      result.push({ text: trimmed, start, end });
    }
  }
  return result;
}

export function selectSummary(predictions: readonly { role: string; score: number }[], k: number): number[] {
  const groups = ['Fact', 'Issue', 'RatioOfTheDecision', 'RulingByPresentCourt'];
  const value = (i: number) => {
    const { role, score } = predictions[i];
    const position = i / Math.max(1, predictions.length - 1);
    return score + 0.35 * (early.has(role) ? 1 - position : late.has(role) ? position : 0);
  };
  const ordered = predictions.map((_, i) => i).sort((a, b) => value(b) - value(a) || a - b);
  const chosen = new Set<number>();
  for (const role of groups) {
    const best = ordered.find(i => predictions[i].role === role);
    if (best !== undefined && chosen.size < k) chosen.add(best);
  }
  const preferred = ordered.filter(i => groups.includes(predictions[i].role));
  for (const i of [...preferred, ...predictions.keys()]) {
    if (chosen.size >= k) break;
    chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b);
}
