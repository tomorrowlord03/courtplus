import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { importOrder } from '../dist/index.js';

const [folder, modelFlag, modelDir, goldFlag, goldPath] = process.argv.slice(2);
if (!folder || modelFlag !== '--model' || !modelDir || (goldFlag && (goldFlag !== '--gold' || !goldPath))) {
  console.error('Usage: node scripts/eval-real.mjs <pdf-folder> --model <dir> [--gold <cg_gold.json>]');
  process.exit(2);
}

const gold = goldPath ? JSON.parse(await readFile(goldPath, 'utf8')) : undefined;
const files = gold ? gold.map(row => row.file) : (await readdir(folder)).filter(file => file.toLowerCase().endsWith('.pdf'));
const fields = Object.create(null);
const fieldCounts = [];
const recall = Object.fromEntries(['DATE', 'PROVISION', 'STATUTE', 'CASE_NUMBER'].map(field => [field, { found: 0, gold: 0 }]));
let maskedNames = 0;
let possibleLeakLines = 0;
let processed = 0;
let errors = 0;

function normalizedDate(value) {
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : value;
}

function normalizedCase(value) {
  const match = value.match(/(\d{1,6})\s*(?:of|\/)\s*(\d{4})/iu);
  return match ? `${Number(match[1])}/${match[2]}` : value.toLowerCase().replace(/\s+/gu, ' ');
}

function normalizedProvision(value) {
  return value.match(/\d+(?:\([a-z0-9]+\))*/iu)?.[0].toLowerCase() ?? '';
}

function normalizedStatute(value) {
  const lower = value.toLowerCase();
  if (/narcotic|ndps/u.test(lower)) return 'NDPS';
  if (/nagarik|bnss/u.test(lower)) return 'BNSS';
  if (/excise/u.test(lower)) return 'EXCISE';
  if (/arms/u.test(lower)) return 'ARMS';
  if (/nyaya|\bbns\b/u.test(lower)) return 'BNS';
  if (/penal|\bipc\b/u.test(lower)) return 'IPC';
  return lower.replace(/[^a-z0-9]/gu, '');
}

function possibleLeak(line) {
  const markers = [...line.matchAll(/\b[SRW]\s*\/\s*o\b/giu)];
  return markers.some(marker => {
    const tail = line.slice(marker.index + marker[0].length)
      .replace(/\[[^\]]+\]/gu, '')
      .replace(/\b[SRW]\s*\/\s*o\b|\b(?:Applicant|Applicants|Petitioner|Petitioners|Respondent|Respondents|Versus|State)\b/giu, '');
    return /\b[A-Z][a-z]{2,}\b/u.test(tail);
  });
}

for (const file of files) {
  try {
    const result = await importOrder({ name: basename(file), bytes: await readFile(join(folder, file)) }, modelDir);
    processed++;
    maskedNames += [...result.redactedText.matchAll(/\b(?:Accused|Respondent|Witness|Person|Lawyer|Judge)-\d+\b/gu)].length;
    possibleLeakLines += result.redactedText.split(/\r?\n|\f/gu).filter(possibleLeak).length;
    const present = new Set(result.suggestions.map(suggestion => suggestion.field));
    fieldCounts.push(present.size);
    for (const field of present) fields[field] = (fields[field] ?? 0) + 1;
    const row = gold?.find(item => item.file === file);
    if (!row) continue;
    const predicted = {
      DATE: new Set(result.suggestions.filter(s => /^(?:date|\w+On|bailDate|custodySince)$/u.test(s.field)).map(s => s.value)),
      PROVISION: new Set(result.suggestions.filter(s => s.field === 'section' || s.field === 'citedProvision').map(s => normalizedProvision(s.value))),
      STATUTE: new Set([...result.suggestions.filter(s => s.field === 'section' || s.field === 'citedProvision').map(s => normalizedStatute(s.value)),
        ...result.entities.filter(entity => entity.label === 'STATUTE').map(entity => normalizedStatute(entity.text))]),
      CASE_NUMBER: new Set(result.suggestions.filter(s => s.field === 'caseNo').map(s => normalizedCase(s.value))),
    };
    const expected = {
      DATE: row.dates.map(normalizedDate),
      PROVISION: row.provisions.map(normalizedProvision),
      STATUTE: row.statutes.map(normalizedStatute),
      CASE_NUMBER: row.case_numbers.map(normalizedCase),
    };
    for (const field of Object.keys(recall)) {
      const values = new Set(expected[field]);
      recall[field].gold += values.size;
      recall[field].found += [...values].filter(value => predicted[field].has(value)).length;
    }
  } catch {
    errors++;
  }
}

const output = {
  orders: processed,
  errors,
  fieldsFoundPerOrder: {
    min: fieldCounts.length ? Math.min(...fieldCounts) : 0,
    max: fieldCounts.length ? Math.max(...fieldCounts) : 0,
    mean: fieldCounts.length ? Number((fieldCounts.reduce((total, count) => total + count, 0) / fieldCounts.length).toFixed(2)) : 0,
  },
  ordersWithField: fields,
  maskedNameCount: maskedNames,
  possibleLeakLines,
};
if (gold) output.fieldRecall = Object.fromEntries(Object.entries(recall).map(([field, value]) =>
  [field, { ...value, recall: value.gold ? Number((value.found / value.gold).toFixed(3)) : 0 }]));
// PDF/OCR runtimes can retain workers after the aggregate has been printed.
process.stdout.write(JSON.stringify(output) + '\n', () => process.exit(errors ? 1 : 0));
