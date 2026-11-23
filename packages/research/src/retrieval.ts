import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { readJson } from './runtime.js';

export interface Precedent {
  id: string;
  title: string;
  citation: string;
  caseNumber: string;
  year: number;
  date: string;
  court: string;
  judges: string;
  excerpt: string;
  source: string;
}

interface IndexManifest {
  version: number;
  count: number;
  dimensions: number;
  lexicalWeight: number;
  termLimit: number;
}

interface LexicalIndex {
  lengths: number[];
  terms: Record<string, [start: number, count: number]>;
}

const POSTING_BYTES = 6;
const decompress = promisify(gunzip);

async function readDocuments(file: string): Promise<Precedent[]> {
  const data = await decompress(await readFile(file));
  return JSON.parse(data.toString('utf8')) as Precedent[];
}

function float16(bits: number): number {
  const exponent = (bits >> 10) & 31;
  const fraction = bits & 1023;
  const magnitude = exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15);
  return bits & 32768 ? -magnitude : magnitude;
}

export function terms(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function rank(scores: Float32Array, positiveOnly = false): number[] {
  return Array.from(scores.keys()).filter(i => !positiveOnly || scores[i] > 0)
    .sort((a, b) => scores[b] - scores[a] || a - b);
}

export function fuse(lexical: Float32Array, dense: Float32Array, weight: number): Float32Array {
  const combined = new Float32Array(dense.length);
  rank(lexical, true).forEach((doc, i) => { combined[doc] += weight / (61 + i); });
  rank(dense).forEach((doc, i) => { combined[doc] += (1 - weight) / (61 + i); });
  return combined;
}

export async function loadIndex(dir: string) {
  const [manifest, documents, lexical, postings, vectors] = await Promise.all([
    readJson<IndexManifest>(join(dir, 'manifest.json')),
    readDocuments(join(dir, 'documents.json.gz')),
    readJson<LexicalIndex>(join(dir, 'lexical.json')),
    readFile(join(dir, 'postings.bin')),
    readFile(join(dir, 'embeddings.f16')),
  ]);
  const { count, dimensions } = manifest;
  if (manifest.version !== 1 || count !== documents.length || count !== lexical.lengths.length ||
    vectors.byteLength !== count * dimensions * 2 || postings.byteLength % POSTING_BYTES) {
    throw new Error('Inconsistent local precedent index.');
  }
  const lengthAverage = lexical.lengths.reduce((sum, n) => sum + n, 0) / count || 1;
  const words = Float32Array.from({ length: 65536 }, (_, i) => float16(i));
  const stored = new Uint16Array(vectors.buffer, vectors.byteOffset, count * dimensions);
  return {
    search(query: string, vector: Float32Array, k: number) {
      if (vector.length !== dimensions) throw new Error('Precedent encoder and index dimensions differ.');
      const bm25 = new Float32Array(count);
      for (const term of new Set(terms(query).slice(0, manifest.termLimit))) {
        if (!Object.hasOwn(lexical.terms, term)) continue;
        const [start, frequency] = lexical.terms[term];
        const idf = Math.log1p((count - frequency + 0.5) / (frequency + 0.5));
        for (let n = start; n < start + frequency; n++) {
          const offset = n * POSTING_BYTES;
          const doc = postings.readUInt32LE(offset);
          const tf = postings.readUInt16LE(offset + 4);
          const denominator = tf + 1.2 * (0.25 + 0.75 * lexical.lengths[doc] / lengthAverage);
          bm25[doc] += idf * tf * 2.2 / denominator;
        }
      }
      const dense = new Float32Array(count);
      for (let doc = 0; doc < count; doc++) {
        let score = 0;
        for (let d = 0; d < dimensions; d++) score += words[stored[doc * dimensions + d]] * vector[d];
        dense[doc] = score;
      }
      const fusion = fuse(bm25, dense, manifest.lexicalWeight);
      return rank(fusion).slice(0, k).map(doc => ({
        ...documents[doc], score: fusion[doc], lexicalScore: bm25[doc], denseScore: dense[doc],
      }));
    },
  };
}
