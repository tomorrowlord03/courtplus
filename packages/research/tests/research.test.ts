import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createResearch, HINT_LABEL } from '../src/index.js';
import { fuse, loadIndex, rank, terms } from '../src/retrieval.js';
import { tokenWindows } from '../src/runtime.js';
import { selectSummary, sentences } from '../src/summary.js';

const fictionalText = 'Dr. Finch delivered the fictional lantern. The tribunal recorded the delivery. It issued this sample order.';

describe('research helpers', () => {
  it('short-circuits empty input even without a model folder', async () => {
    const research = createResearch({ modelDir: 'missing-fictional-model-dir' });
    await expect(research.suggestSections(' ')).resolves.toEqual([]);
    await expect(research.classifyRoles([])).resolves.toEqual([]);
    await expect(research.searchPrecedents('Fictional case', 0)).resolves.toEqual([]);
    await expect(research.searchPrecedents('Fictional case', -1)).rejects.toThrow(RangeError);
    await expect(research.summarise(' ')).resolves.toEqual([]);
  });

  it('covers long facts with overlapping windows and skips redundant final windows', () => {
    const tokens = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(tokenWindows(tokens, 8, 2)).toEqual([[1, 2, 3, 4, 5, 6], [5, 6, 7, 8]]);
    expect(tokenWindows(tokens.slice(0, 6), 8, 2)).toEqual([[1, 2, 3, 4, 5, 6]]);
    expect(tokenWindows(tokens, 8, 0)).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  it('preserves source spans and favours one sentence from each requested role', () => {
    const spans = sentences(fictionalText);
    expect(spans).toHaveLength(3);
    expect(spans[0].text).toMatch(/^Dr\. Finch/);
    expect(spans.every(span => fictionalText.slice(span.start, span.end) === span.text)).toBe(true);
    expect(selectSummary([
      { role: 'Fact', score: 0.7 },
      { role: 'Fact', score: 0.75 },
      { role: 'Issue', score: 0.8 },
      { role: 'RatioOfTheDecision', score: 0.7 },
      { role: 'RulingByPresentCourt', score: 0.55 },
    ], 4)).toEqual([0, 2, 3, 4]);
  });

  it('normalizes lexical words and combines ranks across both retrieval signals', () => {
    expect(terms('Ｆinch § 12-A')).toEqual(['finch', '12', 'a']);
    const lexical = Float32Array.of(3, 0, 2, 0);
    const dense = Float32Array.of(0, 3, 2, 1);
    expect(rank(fuse(lexical, dense, 0.5))[0]).toBe(2);
    expect(rank(fuse(lexical, dense, 1))).toEqual([0, 2, 1, 3]);
  });

  it('reads BM25 postings, fp16 vectors and source metadata from a tiny local index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'courtplus-research-'));
    try {
      const docs = ['lantern', 'compass'].map(id => ({
        id, title: `Fictional ${id} case`, citation: 'Fictional Reporter 1',
        caseNumber: 'FICTIONAL/1', year: 2099, date: '2099-01-01',
        court: 'Fictional Court', judges: 'Judge Finch',
        excerpt: `The ${id} was entered as fictional evidence.`, source: 'https://example.invalid/judgment',
      }));
      const postings = Buffer.alloc(6);
      postings.writeUInt16LE(1, 4);
      const vectors = Buffer.alloc(8);
      vectors.writeUInt16LE(0x3c00, 0);
      vectors.writeUInt16LE(0x3c00, 6);
      await Promise.all([
        writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, count: 2, dimensions: 2, lexicalWeight: 0.8, termLimit: 512 })),
        writeFile(join(root, 'documents.json.gz'), gzipSync(JSON.stringify(docs))),
        writeFile(join(root, 'lexical.json'), JSON.stringify({ lengths: [1, 1], terms: { lantern: [0, 1] } })),
        writeFile(join(root, 'postings.bin'), postings),
        writeFile(join(root, 'embeddings.f16'), vectors),
      ]);
      const index = await loadIndex(root);
      const [first, second] = index.search('lantern', Float32Array.of(0, 1), 2);
      expect(first).toMatchObject({ id: 'lantern', source: docs[0].source, denseScore: 0 });
      expect(first.lexicalScore).toBeCloseTo(Math.log(2));
      expect(second).toMatchObject({ id: 'compass', lexicalScore: 0, denseScore: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const modelDir = process.env.COURTPLUS_OLDCASES_MODELS ?? join('resources', 'models', 'oldcases');
const research = createResearch({ modelDir });
const ready = (...folders: string[]) => folders.every(folder => existsSync(join(modelDir, folder, 'manifest.json')));
// Real sessions can open hundreds of megabytes of weights from the external cache.
const modelTimeout = 180_000;

it.skipIf(!ready('lsi'))('ranks statutes with references and the human-review label', async () => {
  const suggestions = await research.suggestSections(fictionalText);
  expect(suggestions).toHaveLength(5);
  for (const item of suggestions) {
    expect(item).toMatchObject({ act: 'IPC', hint: true, hintLabel: HINT_LABEL, source: expect.stringMatching(/^https:/) });
    expect(item.score).toBeGreaterThan(0);
    expect(item.score).toBeLessThanOrEqual(1);
    if (!item.bns.length) expect(item.mappingNote).toBe('BNS equivalent not mapped');
  }
}, modelTimeout);

it.skipIf(!existsSync(join(modelDir, 'lsi', 'model_quantized.onnx')))('runs the int8 statute model on overlapping windows', async () => {
  const quantized = createResearch({ modelDir, quantizedSections: true });
  const result = await quantized.suggestSections(fictionalText.repeat(45));
  expect(result).toHaveLength(5);
  expect(result.every((item, i) => item.hint && (i === 0 || result[i - 1].score >= item.score))).toBe(true);
}, modelTimeout);

it.skipIf(!ready('rr'))('classifies and summarises only supplied sentences', async () => {
  const roles = await research.classifyRoles(sentences(fictionalText).map(span => span.text));
  expect(roles).toHaveLength(3);
  expect(roles[0]).toMatchObject({ index: 0, hint: true, hintLabel: HINT_LABEL });
  const summary = await research.summarise(fictionalText);
  expect(summary.every(item => item.text === fictionalText.slice(item.start, item.end) && item.hint)).toBe(true);
  expect(summary).toHaveLength(3);
}, modelTimeout);

it.skipIf(!ready('pcr-index', 'pcr-encoder'))('searches installed government judgments offline', async () => {
  const results = await research.searchPrecedents('Fictional dispute over delivery of a lantern', 2);
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({
    hint: true, hintLabel: HINT_LABEL, source: expect.stringMatching(/^https:/),
  });
  expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  expect([...results[0].excerpt].length).toBeLessThanOrEqual(300);
}, modelTimeout);
