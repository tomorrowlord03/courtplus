import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import * as extract from '../src/extract.js';
import { AI_UNAVAILABLE, anonymise, importOrder } from '../src/index.js';
import { fictionalOrderPdf } from './fixtures.js';

it('falls back to text, pattern suggestions and rule-only masking when the model is missing', async () => {
  const missing = join(tmpdir(), 'courtplus-no-such-model-' + process.pid);
  const result = await importOrder({ name: 'fictional.pdf', bytes: fictionalOrderPdf() }, missing);
  expect(result.aiUnavailable).toBe(AI_UNAVAILABLE);
  expect(result.text).toContain('Fictional intake fixture');
  expect(result.entities).toEqual([]);
  expect(result.redactedText).toBe(anonymise(result.text, []).text);
  expect(result.suggestions).toContainEqual(expect.objectContaining({ field: 'bailGrantedOn', page: 2 }));
  expect(result.suggestions).toContainEqual(expect.objectContaining({ field: 'section' }));
});

it('still rejects unsupported files instead of falling back', async () => {
  await expect(importOrder({ name: 'note.txt', bytes: new TextEncoder().encode('plain text') }, 'unused'))
    .rejects.toThrow('Unsupported order format');
});

it('masks identifiers in fallback suggestion sentences while retaining the proposed case number', async () => {
  const text = 'Fictional intake fixture. MCRC No. 12/2025 concerns section 379 IPC and phone 6000000000.';
  const extractText = vi.spyOn(extract, 'extractText').mockResolvedValueOnce({
    text, ocr: false, pages: [{ page: 1, text, start: 0, end: text.length, ocr: false, confidence: 1 }],
  });
  try {
    const missing = join(tmpdir(), 'courtplus-no-such-model-' + process.pid);
    const result = await importOrder({ name: 'fictional.pdf', bytes: fictionalOrderPdf() }, missing);
    const sentence = '[Case Number] concerns section 379 IPC and phone [Phone].';
    expect(result.aiUnavailable).toBe(AI_UNAVAILABLE);
    expect(result.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'caseNo', value: '12/2025', sentence }),
      expect.objectContaining({ field: 'section', value: 'IPC 379', sentence }),
    ]));
    expect(result.redactedText).toContain(sentence);
  } finally {
    extractText.mockRestore();
  }
});
