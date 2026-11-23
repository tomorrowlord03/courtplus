import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { PastAward, PrecedentReference, ResearchResult, ResearchSentence, SectionHint } from '@courtplus/contracts' with { 'resolution-mode': 'import' };

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

async function localJudgmentText(directory: string, hits: Hit[]): Promise<Map<string, string>> {
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

export function createResearchAdapter(resourceDirectory: string) {
  const modelDir = process.env.COURTPLUS_OLDCASES_MODELS || join(resourceDirectory, 'models', 'oldcases');
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
