import type { Entity } from '@courtplus/contracts';

const labels = new Set<Entity['label']>([
  'COURT', 'PETITIONER', 'RESPONDENT', 'JUDGE', 'LAWYER', 'DATE', 'ORG', 'GPE',
  'STATUTE', 'PROVISION', 'PRECEDENT', 'CASE_NUMBER', 'WITNESS', 'OTHER_PERSON',
]);

export interface TokenPrediction {
  entity: string;
  index: number;
  score: number;
}

export interface Span {
  start: number;
  end: number;
}

interface Classifier {
  maxTokens: number;
  countTokens(text: string): number;
  classify(text: string): Promise<Entity[]>;
}

export function contractLabel(tag: string): Entity['label'] | undefined {
  const name = tag.toUpperCase().replace(/^[BIESUL]-/, '').replace(/[- ]/g, '_');
  if (name === 'CASENUMBER' || name === 'CASE_NO') return 'CASE_NUMBER';
  if (name === 'OTHERPERSON') return 'OTHER_PERSON';
  return labels.has(name as Entity['label']) ? name as Entity['label'] : undefined;
}

export function groupTokens(text: string, predictions: TokenPrediction[], offsets: (Span | undefined)[]): Entity[] {
  const entities: Entity[] = [];
  let group: Entity | undefined;
  let lastIndex = -1;
  let tokenCount = 0;
  for (const token of predictions) {
    const label = contractLabel(token.entity);
    const span = offsets[token.index];
    if (!label || !span) {
      group = undefined;
      continue;
    }
    if (group && group.label === label && lastIndex + 1 === token.index && !/^[BSU]-/i.test(token.entity)) {
      group.end = span.end;
      group.text = text.slice(group.start, group.end);
      group.score += (token.score - group.score) / ++tokenCount;
    } else {
      group = { ...span, label, text: text.slice(span.start, span.end), score: token.score };
      entities.push(group);
      tokenCount = 1;
    }
    lastIndex = token.index;
    if (/^[ESUL]-/i.test(token.entity)) group = undefined;
  }
  return entities;
}

// Only merge predictions from different windows. Two BIO groups in one window remain distinct.
export function mergeWindows(text: string, windows: Entity[][]): Entity[] {
  const byLabel = new Map<Entity['label'], (Entity & { sources: Set<number> })[]>();
  for (const [window, entities] of windows.entries()) {
    for (const entity of entities) {
      const spans = byLabel.get(entity.label) ?? [];
      byLabel.set(entity.label, spans);
      const matches = spans.filter(span => !span.sources.has(window) && span.start < entity.end && entity.start < span.end);
      if (!matches.length) {
        spans.push({ ...entity, sources: new Set([window]) });
        continue;
      }
      // One broad prediction should not collapse distinct groups seen together.
      const best = matches.reduce((a, b) => overlap(a, entity) >= overlap(b, entity) ? a : b);
      const start = matches.length === 1 ? Math.min(best.start, entity.start) : best.start;
      const end = matches.length === 1 ? Math.max(best.end, entity.end) : best.end;
      Object.assign(best, { start, end, text: text.slice(start, end), score: Math.max(best.score, entity.score) });
      best.sources.add(window);
    }
  }
  return [...byLabel.values()].flat().map(({ sources, ...entity }) => entity)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function overlap(a: Span, b: Span): number {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

// Character caps also bound work for long strings that WordPiece encodes as a single unknown token.
function textBoundary(text: string, start: number, desired: number): number {
  if (desired >= text.length) return text.length;
  const local = text.slice(start, desired);
  const trailing = /\S*$/u.exec(local)?.[0].length ?? 0;
  if (trailing > 0 && trailing < local.length / 2) return desired - trailing;
  return /[\uD800-\uDBFF]/.test(text[desired - 1]) ? desired - 1 : desired;
}

export async function classifyWindows(text: string, classifier: Classifier): Promise<Entity[]> {
  const windows: Entity[][] = [];
  // Page separators prevent an entity from spanning two independently extracted pages.
  let pageStart = 0;
  for (const pageText of text.split('\f')) {
    for (let start = 0; start < pageText.length;) {
      let end = textBoundary(pageText, start, start + 1800);
      while (classifier.countTokens(pageText.slice(start, end)) > classifier.maxTokens) {
        const next = textBoundary(pageText, start, start + Math.floor((end - start) * 0.8));
        if (next <= start) throw new Error('The local NER model cannot fit a text window.');
        end = next;
      }
      const base = pageStart + start;
      const spans = await classifier.classify(pageText.slice(start, end));
      windows.push(spans.map(span => ({ ...span, start: base + span.start, end: base + span.end })));
      if (end === pageText.length) break;
      const next = textBoundary(pageText, start, end - Math.min(240, Math.floor((end - start) / 4)));
      start = Math.max(start + 1, next);
    }
    pageStart += pageText.length + 1;
  }
  return mergeWindows(text, windows);
}

export async function runNer(text: string, modelDir: string): Promise<Entity[]> {
  if (!text.trim()) return [];
  const { loadClassifier } = await import('./model.js');
  const classifier = await loadClassifier(modelDir);
  try {
    return await classifyWindows(text, classifier);
  } finally {
    await classifier.dispose();
  }
}
