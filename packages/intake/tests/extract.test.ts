import { describe, expect, it } from 'vitest';
import { extractText } from '../src/extract.js';
import { fictionalBilingualImage, fictionalOrderPdf } from './fixtures.js';

describe('order extraction', () => {
  it('extracts a generated fictional text PDF with original page offsets', async () => {
    const result = await extractText(fictionalOrderPdf(), 'application/pdf');
    expect(result.ocr).toBe(false);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({ page: 1, start: 0, confidence: 1, ocr: false });
    expect(result.pages[0].text).toContain('section 379 IPC.');
    expect(result.pages[1].text).toContain('14.03.2025.');
    for (const page of result.pages) expect(result.text.slice(page.start, page.end)).toBe(page.text);
  });

  it('reads a rendered fictional English and Hindi sentence offline', async () => {
    const result = await extractText(fictionalBilingualImage().toBuffer('image/png'), 'image/png');
    expect(result.ocr).toBe(true);
    expect(result.text).toContain('Fictional test sentence');
    expect(result.text).toContain('काल्पनिक वाक्य');
    expect(result.pages[0].confidence).toBeGreaterThan(0.5);
  }, 30_000);

  it('rasterises only the scanned page of a mixed PDF', async () => {
    const scan = fictionalBilingualImage().toBuffer('image/jpeg');
    const result = await extractText(fictionalOrderPdf(scan), 'application/pdf');
    expect(result.ocr).toBe(true);
    expect(result.pages.map(page => page.ocr)).toEqual([false, true]);
    expect(result.pages[1].text).toContain('काल्पनिक वाक्य');
    expect(result.text.slice(result.pages[1].start, result.pages[1].end)).toBe(result.pages[1].text);
  }, 30_000);
});
