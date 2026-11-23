import { expect, it, vi } from 'vitest';
import type { Entity } from '@courtplus/contracts';
import { importOrder } from '../src/index.js';
import { fictionalOrderPdf } from './fixtures.js';

vi.mock('../src/ner.js', () => ({
  runNer: vi.fn(async (text: string, path: string): Promise<Entity[]> => {
    expect(path).toBe('fictional-model-directory');
    const start = text.indexOf('Fictional second page');
    return [{ label: 'OTHER_PERSON', text: 'Fictional second page', start, end: start + 21, score: 1 }];
  }),
}));

it('composes the contract result, with source pages and no redaction mapping in the response', async () => {
  const result = await importOrder({ name: 'fictional.pdf', bytes: fictionalOrderPdf() }, 'fictional-model-directory');
  expect(result.docId).toMatch(/^[a-f0-9]{64}$/);
  expect(result.pages).toBe(2);
  expect(result.entities[0]).toEqual({
    label: 'OTHER_PERSON', text: 'Person-1', start: result.text.indexOf('Fictional second page'),
    end: result.text.indexOf('Fictional second page') + 'Fictional second page'.length, score: 1, page: 2,
  });
  expect(result.suggestions).toContainEqual(expect.objectContaining({ field: 'bailGrantedOn', page: 2 }));
  expect(result.redactedText).toContain('Person-1.');
  expect(result).not.toHaveProperty('mapping');
});

it('masks names in suggestion source sentences with the same alias as the redacted text', async () => {
  const { runNer } = await import('../src/ner.js');
  vi.mocked(runNer).mockImplementationOnce(async text => {
    const start = text.indexOf('example');
    return [{ label: 'PETITIONER', text: 'example', start, end: start + 7, score: 1 }];
  });
  const result = await importOrder({ name: 'fictional.pdf', bytes: fictionalOrderPdf() }, 'fictional-model-directory');
  const section = result.suggestions.find(suggestion => suggestion.field === 'section');
  expect(section?.sentence).toMatch(/^The \S+-1 concerns section 379 IPC\.$/);
  expect(section?.sentence).not.toContain('example');
  expect(result.redactedText).toContain(section!.sentence);
  expect(result).not.toHaveProperty('aiUnavailable');
});
