import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker, OEM, type Worker } from 'tesseract.js';

export interface ExtractedPage {
  page: number;
  text: string;
  start: number;
  end: number;
  ocr: boolean;
  confidence: number;
}

export interface ExtractedOrder {
  pages: ExtractedPage[];
  text: string;
  ocr: boolean;
}

const PAGE_BREAK = '\n\f\n';
const tessdata = fileURLToPath(new URL('../assets/tessdata/', import.meta.url));

async function createOcrWorker(): Promise<Worker> {
  await Promise.all(['eng', 'hin'].map(lang => access(join(tessdata, lang + '.traineddata'))))
    .catch(cause => {
      throw new Error('Bundled English and Hindi OCR data is missing. Run npm run fetch:ocr -w @courtplus/intake before packaging.', { cause });
    });
  // Tesseract reports language initialization failures through errorHandler.
  return new Promise((resolve, reject) => {
    createWorker(['eng', 'hin'], OEM.LSTM_ONLY, {
      langPath: tessdata,
      gzip: false,
      cacheMethod: 'none',
      errorHandler: cause => reject(new Error('Could not initialise offline OCR.', { cause })),
    }).then(resolve, reject);
  });
}

type PageText = Pick<ExtractedPage, 'text' | 'ocr' | 'confidence'>;

async function recognise(worker: Worker, bytes: Uint8Array): Promise<PageText> {
  const { data } = await worker.recognize(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .catch(cause => { throw new Error('Could not read the image with OCR.', { cause }); });
  return { text: data.text.trim(), ocr: true, confidence: data.confidence / 100 };
}

type TextItem = { str: string; hasEOL: boolean; transform: number[]; width: number };

function textLayer(items: (TextItem | { type: string })[]): string {
  let text = '';
  let previous: TextItem | undefined;
  for (const item of items) {
    if (!('str' in item)) continue;
    if (previous && item.str && !/\s$/u.test(text) && !/^\s/u.test(item.str)) {
      const [, , , height, x, y] = item.transform;
      const previousRight = previous.transform[4] + previous.width;
      if (Math.abs(y - previous.transform[5]) > Math.max(2, Math.abs(height) * 0.6)) {
        text += '\n';
      } else if (x - previousRight > Math.max(1, Math.abs(height) * 0.12)) {
        text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    previous = item;
  }
  return text.trim();
}

function assemble(input: PageText[]): ExtractedOrder {
  let offset = 0;
  const pages = input.map((page, index) => {
    const start = offset;
    const end = start + page.text.length;
    offset = end + PAGE_BREAK.length;
    return { ...page, page: index + 1, start, end };
  });
  return { pages, text: pages.map(page => page.text).join(PAGE_BREAK), ocr: pages.some(page => page.ocr) };
}

/** Page spans use zero-based UTF-16 offsets and exclusive ends. */
export async function extractText(bytes: Uint8Array, mime: string): Promise<ExtractedOrder> {
  let worker: Worker | undefined;
  try {
    switch (mime.split(';', 1)[0].trim().toLowerCase()) {
      case 'image/png':
      case 'image/jpeg':
      case 'image/jpg':
        worker = await createOcrWorker();
        return assemble([await recognise(worker, bytes)]);
      case 'application/pdf':
        break;
      default:
        throw new Error('Unsupported order format. Use PDF, PNG or JPEG.');
    }

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfRoot = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
    const task = getDocument({
      data: Uint8Array.from(bytes),
      cMapUrl: join(pdfRoot, 'cmaps') + '/',
      cMapPacked: true,
      standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
      wasmUrl: join(pdfRoot, 'wasm') + '/',
      useWorkerFetch: false,
      isEvalSupported: false,
      enableXfa: false,
    });

    try {
      const pdf = await task.promise;
      const pages: PageText[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        try {
          const text = textLayer((await page.getTextContent()).items);
          if ((text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 20) {
            pages.push({ text, ocr: false, confidence: 1 });
            continue;
          }

          worker ??= await createOcrWorker();
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 3200 / Math.max(original.width, original.height));
          const viewport = page.getViewport({ scale });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
          const ocr = await recognise(worker, canvas.toBuffer('image/png'));
          pages.push({ ...ocr, text: ocr.text || text });
        } finally {
          page.cleanup();
        }
      }
      return assemble(pages);
    } finally {
      await task.destroy();
    }
  } finally {
    await worker?.terminate();
  }
}
