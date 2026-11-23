import { describe, expect, it } from 'vitest';
import type { Entity } from '@courtplus/contracts';
import { classifyWindows, contractLabel, groupTokens } from '../src/ner.js';

describe('NER window offsets and aggregation', () => {
  it('merges full and partial predictions from overlapping windows', async () => {
    const name = 'Fiction Person';
    const text = 'test '.repeat(350) + name + ' example '.repeat(100);
    const getEntity = (window: string, value: string, score: number): Entity => {
      const start = window.indexOf(value);
      return { start, end: start + value.length, text: value, score, label: 'WITNESS' };
    };
    const calls: string[] = [];
    const output = await classifyWindows(text, {
      maxTokens: 512,
      countTokens: window => window.trim().split(/\s+/u).length + 2,
      async classify(window) {
        calls.push(window);
        if (!window.includes(name)) return [];
        return calls.length === 1 ? [getEntity(window, 'Fiction', 0.72)] : [getEntity(window, name, 0.96)];
      },
    });
    expect(calls.length).toBeGreaterThan(1);
    expect(output).toEqual([{ label: 'WITNESS', text: name, start: 1750, end: 1764, score: 0.96 }]);
  });

  it('uses token offsets, keeps BIO groups separate and maps legal labels', () => {
    const text = 'Ficción Alpha met Fiction Beta';
    const predictions = [
      { entity: 'B-OTHER_PERSON', index: 1, score: 0.8 },
      { entity: 'I-OTHER_PERSON', index: 2, score: 1 },
      { entity: 'I-OTHER_PERSON', index: 4, score: 0.9 },
      { entity: 'I-OTHER_PERSON', index: 5, score: 0.9 },
    ];
    const offsets = [undefined, { start: 0, end: 7 }, { start: 8, end: 13 }, { start: 14, end: 17 },
      { start: 18, end: 25 }, { start: 26, end: 30 }];
    const result = groupTokens(text, predictions, offsets);
    expect(result.map(({ text, score }) => [text, score])).toEqual([['Ficción Alpha', 0.9], ['Fiction Beta', 0.9]]);
    expect(contractLabel('B-CASE-NUMBER')).toBe('CASE_NUMBER');
    expect(contractLabel('I-OTHER_PERSON')).toBe('OTHER_PERSON');
    expect(contractLabel('O')).toBeUndefined();
  });
});
