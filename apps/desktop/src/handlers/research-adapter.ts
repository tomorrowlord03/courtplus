import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type {
  HintDecision, HintResult, PastAward, PrecedentHit, PrecedentQuery, PrecedentReference, PrecedentText, ResearchApi,
  ResearchResult, ResearchSentence, ResearchStatus, RoleHint, SectionHint, SectionSuggestion,
} from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { z } from 'zod';
import { validateArguments } from '../validation';

// Every call into `packages/research` goes through this file, so the app keeps working (and says so)
// while the package or its model files are not installed.

type Hit = {
  id: string; title: string; citation: string; caseNumber: string; year: number; court: string;
  excerpt: string; source: string;
};

interface Research {
  summarise(text: string): Promise<ResearchSentence[]>;
  classifyRoles(sentences: string[]): Promise<{ index: number; role: string }[]>;
  suggestSections(text: string): Promise<(SectionHint & { aboveThreshold: boolean })[]>;
  searchPrecedents(text: string, count: number): Promise<Hit[]>;
}

const segmenter = new Intl.Segmenter('en-IN', { granularity: 'sentence' });
const abbreviation = /\b(?:rs|inr|v|vs|no|nos|sec|para|mr|mrs|dr|smt)\.$/iu;

export function sourceSentences(text: string): ResearchSentence[] {
  const sentences: { text: string; start: number; end: number }[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    if (!segment.trim()) continue;
    const before = sentences.at(-1);
    const end = index + segment.trimEnd().length;
    if (before && abbreviation.test(before.text)) {
      before.text = text.slice(before.start, end);
      before.end = end;
    } else {
      sentences.push({ text: segment.trim(), start: index + segment.length - segment.trimStart().length, end });
    }
  }
  return sentences.map(({ text: sentence, start, end }) => ({
    text: sentence, source: `Masked case file, characters ${start + 1}–${end}`,
  }));
}

function precedent(hit: Hit): PrecedentReference {
  return {
    id: hit.id, title: hit.title || hit.caseNumber || hit.id,
    citation: hit.citation || hit.caseNumber || 'Citation unavailable',
    year: hit.year > 0 ? hit.year : null, court: hit.court,
    url: URL.parse(hit.source)?.protocol === 'https:' ? hit.source : '',
    paragraph: hit.excerpt,
  };
}

const currency = /(?:₹[\s:]*|\b(?:Rs\.?|INR|Rupees)\s*)(\d+(?:,\d+)*(?:\.\d{1,2})?)(?!\d|\.\d)(?:\s*(crores?|lakhs?|lacs?|thousand))?/giu;
const numeral = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/u;
const award = /\b(?:we (?:hereby )?(?:award|grant|enhance|reduce|fix|determine)|(?:is|are) (?:hereby )?(?:awarded|entitled to|enhanced|reduced|fixed|determined)|(?:total|overall)\s+(?:compensation|award|maintenance|alimony)\s+(?:is|comes to|works out to|amounts to)|(?:shall|must) pay)\b/i;
const subject = /\b(?:compensation|maintenance|alimony|award|damages|claimants?)\b/i;
const history = /\b(?:claimed|prayed|sought|argued|contended|submitted|prayer|tribunal (?:had )?awarded|court below (?:had )?awarded|illustration)\b/i;

export function extractPastAward(hit: Hit, text = hit.excerpt): PastAward[] {
  const results = new Map<string, PastAward>();
  for (const { text: sentence } of sourceSentences(text.replace(/\s+/g, ' '))) {
    if (!/[.!?।]["'”’)]?$/.test(sentence) || !subject.test(sentence) || !award.test(sentence) || history.test(sentence)) continue;
    const amounts = [...new Set([...sentence.matchAll(currency)].flatMap(([, number, unit = '']) => {
      if (!numeral.test(number)) return [];
      const scale = /^crore/i.test(unit) ? 10_000_000 : /^la(?:kh|c)/i.test(unit) ? 100_000 : unit ? 1_000 : 1;
      const amount = Number(number.replaceAll(',', '')) * scale;
      return Number.isSafeInteger(Math.round(amount * 100)) && amount > 0 ? [amount] : [];
    }))];
    if (!amounts.length) continue;
    const monthly = /\b(?:per month|a month|p\.?\s*m\.?|monthly)\b/i.test(sentence);
    const annual = /\b(?:per annum|per year|a year|annually|yearly)\b/i.test(sentence);
    const basis = monthly && !annual ? 'monthly' : annual && !monthly ? 'annual'
      : !monthly && !annual && /\b(?:total compensation|compensation|damages|lump[- ]sum)\b/i.test(sentence) ? 'lump sum' : 'unclear';
    results.set(sentence, { precedent: precedent(hit), amounts, sentence, basis });
  }
  return [...results.values()];
}

export async function localJudgmentText(directory: string, hits: Pick<Hit, 'id' | 'year'>[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  const ids = new Set(hits.map(({ id }) => id));
  if (!ids.size) return texts;
  const files = await readdir(directory).catch(() => []);
  const prefixes = new Set(hits.map(({ id, year }) => id.split(':')[0] + '-' + year + '-'));
  for (const file of files) {
    if (!file.endsWith('.jsonl.gz') || ![...prefixes].some(prefix => file.startsWith(prefix))) continue;
    const source = createReadStream(join(directory, file));
    const gzip = createGunzip();
    source.on('error', error => gzip.destroy(error));
    const lines = createInterface({ input: source.pipe(gzip), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const row: { id?: string; text?: string } = JSON.parse(line);
        if (typeof row.id === 'string' && typeof row.text === 'string' && ids.delete(row.id)) texts.set(row.id, row.text);
        if (!ids.size) return texts;
      }
    } catch {
      // An optional corpus shard can be absent or corrupt while the index remains usable.
    } finally {
      lines.close();
      source.destroy();
      gzip.destroy();
    }
  }
  return texts;
}

const modelFolder = (resourceDirectory: string) =>
  process.env.COURTPLUS_OLDCASES_MODELS || join(resourceDirectory, 'models', 'oldcases');

export function createResearchAdapter(resourceDirectory: string) {
  const modelDir = modelFolder(resourceDirectory);
  const name = '@courtplus/research';
  let installed: Research | undefined;

  async function run<T>(operation: (research: Research) => Promise<T>): Promise<ResearchResult<T>> {
    try {
      if (!installed) {
        const module = await import(name) as { createResearch?: (options: { modelDir: string }) => Research } & Partial<Research>;
        const candidate = module.createResearch?.({ modelDir }) ?? module;
        if (!candidate.summarise || !candidate.classifyRoles || !candidate.suggestSections || !candidate.searchPrecedents) {
          return { available: false };
        }
        installed = candidate as Research;
      }
      return { available: true, value: await operation(installed) };
    } catch {
      // A package without installed model files can fail only when the function is first called.
      return { available: false };
    }
  }

  return {
    summary: (text: string) => run(research => research.summarise(text)),
    roles: (sentences: string[]) => run(research => research.classifyRoles(sentences)),
    sections: (text: string) => run(async research => (await research.suggestSections(text))
      .filter(section => section.aboveThreshold).map(({ act, section, title, source, bns }) => ({ act, section, title, source, bns }))),
    precedents: (text: string) => run(async research => (await research.searchPrecedents(text, 8)).map(precedent)),
    awards: (text: string) => run(async research => {
      const hits = await research.searchPrecedents(text, 25);
      const texts = await localJudgmentText(join(modelDir, 'government-extract'), hits);
      return hits.flatMap(hit => extractPastAward(hit, texts.get(hit.id)));
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Research screen and judge hints (ResearchApi over IPC). Hints only, each with its source.

type Fn = (...args: unknown[]) => unknown;
export type ResearchModule = Partial<Record<
  'suggestSections' | 'searchPrecedents' | 'classifyRoles' | 'getPrecedent' | 'createResearch', Fn>>;

export interface ResearchPorts {
  resourceDirectory: string;
  audit: (action: string, payload: unknown) => void;
  /** Test seam; the default dynamically imports `@courtplus/research`. */
  load?: () => Promise<ResearchModule | undefined>;
}

export const RESEARCH_MISSING = 'Precedent search is being installed';
const DEFAULT_SOURCE = 'Court+ precedent index (published judgments)';
const MODEL_SOURCE = 'Court+ research models (trained on published Indian judgments)';

async function importPackage(): Promise<ResearchModule | undefined> {
  // A string variable keeps TypeScript from resolving the optional package at build time.
  const specifier: string = '@courtplus/research';
  try {
    return await import(specifier) as ResearchModule;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
const num = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const pick = (row: Row, ...keys: string[]) => keys.map(key => row[key]).find(value => text(value) !== undefined);
const isHttps = (value: string | undefined) => Boolean(value && URL.parse(value)?.protocol === 'https:');

/** Accepts an array or an object wrapping one (`items`, `results`, `hits`, ...). */
export function asRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((row): row is Row => Boolean(row) && typeof row === 'object');
  if (value && typeof value === 'object') {
    for (const key of ['items', 'results', 'hits', 'sections', 'roles']) {
      const inner = (value as Row)[key];
      if (Array.isArray(inner)) return asRows(inner);
    }
  }
  return [];
}

function yearOf(row: Row): number | undefined {
  const year = num(row.year);
  if (year && year > 0) return year;
  const date = text(pick(row, 'date', 'decisionDate', 'decision_date', 'judgmentDate'));
  const match = date?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

export function toHit(row: Row, index: number): PrecedentHit {
  const title = text(pick(row, 'title', 'name', 'caseTitle', 'case_title', 'caseNumber')) ?? 'Untitled judgment';
  // The research index stores the official judgment URL as its `source`.
  const source = text(row.source);
  const url = text(pick(row, 'url', 'sourceUrl', 'source_url', 'link')) ?? (isHttps(source) ? source : undefined);
  return {
    id: text(pick(row, 'id', 'docId', 'doc_id', 'cnr')) ?? `hit-${index}`,
    title,
    citation: text(pick(row, 'citation', 'caseNumber', 'case_number', 'caseNo', 'cnr')) ?? title,
    year: yearOf(row),
    court: text(pick(row, 'court', 'courtName', 'court_name')) ?? 'Court not stated',
    snippet: (text(pick(row, 'snippet', 'excerpt', 'preview', 'text', 'summary')) ?? '').slice(0, 600),
    score: num(row.score) ?? 0,
    url,
    source: source && !isHttps(source) ? source : DEFAULT_SOURCE,
    hint: true,
  };
}

const STATUTE = /^(?:section\s+)?(\d+[A-Z]*)\s*(?:of|in)?\s*(?:the\s+)?(.+)$/i;
export function toSection(row: Row): SectionSuggestion | undefined {
  if (row.aboveThreshold === false) return undefined;
  let act = text(row.act);
  let section = text(pick(row, 'section', 'sectionNo'))?.replace(/^section\s+/i, '');
  const statute = text(pick(row, 'statute', 'label', 'name'));
  if ((!act || !section) && statute) {
    const short = statute.match(/^([A-Za-z.]+)\s*(?:s\.|section)?\s*(\d+[A-Z]*)$/i);
    const long = statute.match(STATUTE);
    if (short) [act, section] = [short[1].replace(/\./g, '').toUpperCase(), short[2]];
    else if (long) [section, act] = [long[1], long[2].replace(/,?\s*\d{4}$/, '')];
  }
  if (!act || !section) return undefined;
  const mapped = Array.isArray(row.bns)
    ? row.bns.map(item => text((item as Row | undefined)?.section)).filter(Boolean).join(', ')
    : text(pick(row, 'bnsEquivalent', 'bns', 'bns_section'));
  return {
    act: /indian penal code/i.test(act) ? 'IPC' : act,
    section,
    label: text(pick(row, 'title', 'label', 'statute')),
    score: num(row.score) ?? 0,
    ...(mapped ? { bnsEquivalent: mapped } : { bnsNote: text(pick(row, 'bnsNote', 'mappingNote')) ?? 'BNS equivalent not mapped' }),
    source: text(row.source) ?? MODEL_SOURCE,
    hint: true,
  };
}

export function toRole(row: Row, sentences: string[], index: number): RoleHint {
  return {
    sentence: text(pick(row, 'sentence', 'text')) ?? sentences[num(row.index) ?? index] ?? '',
    role: text(pick(row, 'role', 'label')) ?? 'other',
    score: num(row.score) ?? 0,
    source: text(row.source) ?? MODEL_SOURCE,
    hint: true,
  };
}

/** Court substring and year range; hits without a year pass a year filter only when none is set. */
export function filterHits(hits: PrecedentHit[], query: PrecedentQuery): PrecedentHit[] {
  const court = query.court?.trim().toLowerCase();
  return hits.filter(hit => (!court || hit.court.toLowerCase().includes(court))
    && (query.yearFrom === undefined || (hit.year !== undefined && hit.year >= query.yearFrom))
    && (query.yearTo === undefined || (hit.year !== undefined && hit.year <= query.yearTo)));
}

export function createResearchHints(ports: ResearchPorts): ResearchApi {
  const modelDir = modelFolder(ports.resourceDirectory);
  const load = ports.load ?? importPackage;
  let loaded: Promise<ResearchModule | undefined> | undefined;
  const seen = new Map<string, PrecedentHit>(); // Recent hits, so full text can be found by id and year.

  async function module(): Promise<ResearchModule | undefined> {
    loaded ??= load().then(found => {
      const created = found?.createResearch?.({ modelDir }) as ResearchModule | undefined;
      return created ? { ...found, ...created } : found;
    }).catch(() => undefined);
    const found = await loaded;
    if (!found) loaded = undefined; // Look again next time: the package may be installed while the app runs.
    return found;
  }

  async function call<T>(name: 'suggestSections' | 'searchPrecedents' | 'classifyRoles', args: unknown[],
    map: (value: unknown) => T[]): Promise<HintResult<T>> {
    const fn = (await module())?.[name];
    if (!fn) return { available: false, reason: RESEARCH_MISSING };
    try {
      return { available: true, items: map(await fn(...args)) };
    } catch {
      // Without model files the package fails on first use; that is an install still in progress.
      return { available: false, reason: RESEARCH_MISSING };
    }
  }

  return {
    async status(): Promise<ResearchStatus> {
      const found = await module();
      const features = {
        search: Boolean(found?.searchPrecedents), sections: Boolean(found?.suggestSections),
        roles: Boolean(found?.classifyRoles), fullText: Boolean(found?.searchPrecedents),
      };
      const available = features.search || features.sections || features.roles;
      return available ? { available, features } : { available, reason: RESEARCH_MISSING, features };
    },
    async searchPrecedents(query) {
      const k = Math.min(Math.max(query.k ?? 10, 1), 50);
      const filtered = Boolean(query.court?.trim() || query.yearFrom || query.yearTo);
      const result = await call('searchPrecedents', [query.query, filtered ? k * 5 : k], value => asRows(value).map(toHit));
      if (!result.available) return result;
      for (const hit of result.items) seen.set(hit.id, hit);
      while (seen.size > 500) seen.delete(seen.keys().next().value!);
      return { available: true, items: filterHits(result.items, query).slice(0, k) };
    },
    async openPrecedent(id) {
      const found = await module();
      const fromPackage = await found?.getPrecedent?.(id) as Row | null | undefined;
      const hit = fromPackage ? toHit(fromPackage, 0) : seen.get(id);
      if (!hit) return null;
      const body = (fromPackage && text(pick(fromPackage, 'text', 'fullText', 'body')))
        ?? (hit.year ? (await localJudgmentText(join(modelDir, 'government-extract'), [{ id, year: hit.year }])).get(id) : undefined);
      return { id, title: hit.title, citation: hit.citation, text: body, url: hit.url, source: hit.source } satisfies PrecedentText;
    },
    suggestSections: input => call('suggestSections', [input],
      value => asRows(value).map(toSection).filter((hint): hint is SectionSuggestion => hint !== undefined)),
    classifyRoles: sentences => call('classifyRoles', [sentences],
      value => asRows(value).map((row, index) => toRole(row, sentences, index))),
    async logHint(decision: HintDecision) {
      ports.audit('research.hint', decision);
    },
  };
}

const shortText = z.string().trim().min(1).max(2000);
const year = z.number().int().min(1800).max(2200);
const schemas: { [K in keyof ResearchApi]: z.ZodType<Parameters<ResearchApi[K]>> } = {
  status: z.tuple([]),
  searchPrecedents: z.tuple([z.strictObject({
    query: shortText, k: z.number().int().min(1).max(50).optional(),
    court: z.string().trim().max(200).optional(), yearFrom: year.optional(), yearTo: year.optional(),
  })]),
  openPrecedent: z.tuple([z.string().min(1).max(500)]),
  suggestSections: z.tuple([z.string().trim().min(1).max(100_000)]),
  classifyRoles: z.tuple([z.array(z.string().max(5000)).min(1).max(1000)]),
  logHint: z.tuple([z.strictObject({
    caseId: z.string().min(1).max(200), kind: z.enum(['section', 'precedent', 'structure']),
    hintId: z.string().min(1).max(500), label: z.string().max(1000), source: z.string().max(1000),
    decision: z.enum(['accepted', 'dismissed']),
  })]),
};

export const researchMethods = Object.keys(schemas) as (keyof ResearchApi)[];

export function registerResearch(ipcMain: IpcMain, isTrusted: (event: IpcMainInvokeEvent, method: string) => boolean, research: ResearchApi) {
  for (const name of researchMethods) {
    ipcMain.handle('research:' + name, (event, ...args: unknown[]) => {
      if (!isTrusted(event, 'research:' + name)) throw new Error('FORBIDDEN');
      const method = research[name] as (...input: unknown[]) => unknown;
      return method(...validateArguments(schemas[name] as z.ZodType<unknown[]>, args));
    });
  }
}
