import { join, resolve } from 'node:path';
import { lazy, loadModel } from './runtime.js';
import { loadIndex, type Precedent } from './retrieval.js';
import { selectSummary, sentences } from './summary.js';

export type { Precedent } from './retrieval.js';
export const HINT_LABEL = 'Hint - the judge decides';
const hint = { hint: true, hintLabel: HINT_LABEL } as const;

export interface BnsReference {
  section: string;
  source: string;
  page: string;
  note: string;
}

interface Statute {
  label: string;
  section: string;
  title: string;
  source: string;
  bns: BnsReference[];
}

export interface SectionSuggestion extends Statute {
  act: 'IPC';
  score: number;
  aboveThreshold: boolean;
  mappingNote?: 'BNS equivalent not mapped';
  hint: true;
  hintLabel: typeof HINT_LABEL;
}

export interface RoleHint {
  index: number;
  text: string;
  role: string;
  score: number;
  source: string;
  hint: true;
  hintLabel: typeof HINT_LABEL;
}

export interface SummaryHint extends RoleHint {
  start: number;
  end: number;
}

export interface PrecedentHint extends Precedent {
  score: number;
  lexicalScore: number;
  denseScore: number;
  hint: true;
  hintLabel: typeof HINT_LABEL;
}

export function createResearch(options: { modelDir?: string; quantizedSections?: boolean } = {}) {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? 'resources';
  const root = resolve(options.modelDir ?? process.env.COURTPLUS_OLDCASES_MODELS ?? join(resources, 'models', 'oldcases'));
  const lsi = lazy(() => loadModel<Statute>(join(root, 'lsi'), options.quantizedSections ?? false));
  const rr = lazy(() => loadModel<string>(join(root, 'rr')));
  const pcr = lazy(() => Promise.all([
    loadIndex(join(root, 'pcr-index')),
    loadModel<never>(join(root, 'pcr-encoder'), true),
  ]));

  async function suggestSections(text: string): Promise<SectionSuggestion[]> {
    if (!text.trim()) return [];
    const { model, manifest } = await lsi();
    const maxima = manifest.labels.map(() => -Infinity);
    for await (const row of model.run([text], 'logits')) {
      if (row.length !== maxima.length) throw new Error('Statute labels and model output differ.');
      row.forEach((value, i) => { maxima[i] = Math.max(maxima[i], value); });
    }
    return manifest.labels.map((label, i): SectionSuggestion => {
      const score = 1 / (1 + Math.exp(-maxima[i]));
      const threshold = manifest.thresholds?.[i] ?? manifest.threshold ?? 0.5;
      return {
        ...label, ...hint, act: 'IPC', score, aboveThreshold: score >= threshold,
        ...(label.bns.length ? {} : { mappingNote: 'BNS equivalent not mapped' }),
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async function searchPrecedents(query: string, k = 5): Promise<PrecedentHint[]> {
    if (!Number.isSafeInteger(k) || k < 0) throw new RangeError('k must be a nonnegative integer.');
    if (!query.trim() || !k) return [];
    const [index, { model }] = await pcr();
    for await (const vector of model.run([query], 'embedding')) {
      return index.search(query, vector, k).map(item => ({ ...item, ...hint }));
    }
    return [];
  }

  async function classifyRoles(input: readonly string[]): Promise<RoleHint[]> {
    if (!input.length) return [];
    const { model, manifest } = await rr();
    const roles: RoleHint[] = [];
    for await (const row of model.runRoles(input)) {
      if (row.length !== manifest.labels.length) throw new Error('Role labels and model output differ.');
      const best = row.reduce((i, value, j) => value > row[i] ? j : i, 0);
      const sum = row.reduce((total, value) => total + Math.exp(value - row[best]), 0);
      const index = roles.length;
      roles.push({ ...hint, index, text: input[index], role: manifest.labels[best], score: 1 / sum, source: manifest.source });
    }
    return roles;
  }

  async function summarise(text: string): Promise<SummaryHint[]> {
    const spans = sentences(text);
    const roles = await classifyRoles(spans.map(span => span.text));
    return selectSummary(roles, 6).map(i => ({
      ...roles[i], ...spans[i], source: `Input judgment, characters ${spans[i].start}–${spans[i].end}`,
    }));
  }

  return { suggestSections, searchPrecedents, classifyRoles, summarise };
}

export const { suggestSections, searchPrecedents, classifyRoles, summarise } = createResearch();
