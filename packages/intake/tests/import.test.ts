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
  expect(result.entities[0].page).toBe(2);
  expect(result.suggestions).toContainEqual(expect.objectContaining({ field: 'bailGrantedOn', page: 2 }));
  expect(result.redactedText).toContain('Person-1.');
  expect(result).not.toHaveProperty('mapping');
});
