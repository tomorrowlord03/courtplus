import type { Entity } from '@courtplus/contracts';
import { cnrPattern, firPattern, validSpan } from './patterns.js';

const personRoles: Partial<Record<Entity['label'], string>> = {
  PETITIONER: 'Accused', RESPONDENT: 'Respondent', WITNESS: 'Witness',
  OTHER_PERSON: 'Person', LAWYER: 'Lawyer', JUDGE: 'Judge',
};

type Mask = { start: number; end: number; replacement: string; priority: number; role?: string };
export interface AnonymiseOptions { maskIds?: boolean }
export interface AnonymisedOrder { text: string; mapping: Map<string, string> }

const phonePattern = /(?<![\p{L}\p{N}/-])((?:(?:\+91|0091)[\t -]*)?[6-9](?:[\t -]?[0-9]){9}|(?:\+91[\t -]*)?\(?0[1-9][0-9]{1,3}\)?[\t -]+[0-9]{6,8})(?![\p{L}\p{N}/-])/dgu;
const addressStart = /\br\s*\/\s*o\b|\bresident\s+of\b|निवासी/giu;
const addressEnd = /\n[ \t]*\n|\f|[ \t\n]+(?:\.{3}[ \t]*)?(?=(?:applicants?|petitioners?|respondents?|versus|vs\.?)\b)|\n[ \t]*\d+[ \t]*[-.)]|\.(?=[ \t]+(?:The|He|She|They|This|That)\b)/giu;
const relativeStart = /\b[sdw]\s*\/\s*o\b|\b(?:son|daughter|wife)\s+of\b|पिता(?:\s+का\s+नाम)?/giu;
const relativeEnd = /(?=,[ \t]*(?:r\s*\/\s*o\b|resident\s+of\b|निवासी))|[ \t]+(?=(?:r\s*\/\s*o\b|resident\s+of\b|निवासी))|\n[ \t]*\n|\f|[ \t\n]+(?:\.{3}[ \t]*)?(?=(?:applicants?|petitioners?|respondents?|versus|vs\.?)\b)|\n[ \t]*\d+[ \t]*[-.)]|[;।!?]|\.(?=[ \t]+(?:The|He|She|They|This|That)\b)/giu;

function ruleMasks(text: string, pattern: RegExp, replacement: string): Mask[] {
  return [...text.matchAll(pattern)].map(match => {
    const [start, end] = match.indices![match[1] === undefined ? 2 : 1];
    return { start, end: start + text.slice(start, end).trimEnd().length, replacement, priority: 1 };
  }).filter(mask => mask.start < mask.end);
}

function blockMasks(text: string, markerPattern: RegExp, stopPattern: RegExp, replacement: string): Mask[] {
  const masks: Mask[] = [];
  for (const marker of text.matchAll(markerPattern)) {
    const start = marker.index + marker[0].length;
    const remainder = text.slice(start);
    const stop = remainder.search(stopPattern);
    const end = stop < 0 ? text.length : start + stop;
    const content = text.slice(start, end);
    const leading = /^[ \t]*[:–-]?[ \t]*/u.exec(content)?.[0].length ?? 0;
    const trailing = content.trimEnd().length;
    if (trailing > leading) masks.push({ start: start + leading, end: start + trailing, replacement, priority: 2 });
  }
  return masks;
}

function wordBounded(text: string, start: number, end: number): boolean {
  const word = /[\p{L}\p{N}\p{M}]/u;
  return (!word.test(text[start - 1] ?? '') || !word.test(text[start]))
    && (!word.test(text[end] ?? '') || !word.test(text[end - 1]));
}

export function anonymise(text: string, entities: Entity[], { maskIds = false }: AnonymiseOptions = {}): AnonymisedOrder {
  const aliases = new Map<string, string>();
  const mapping = new Map<string, string>();
  const roleCounts = new Map<string, number>();
  const masks: Mask[] = [
    ...ruleMasks(text, phonePattern, '[Phone]'),
    ...blockMasks(text, addressStart, addressEnd, '[Address]'),
    ...blockMasks(text, relativeStart, relativeEnd, '[Relative]'),
  ];
  if (maskIds) masks.push(...ruleMasks(text, cnrPattern, '[CNR]'), ...ruleMasks(text, firPattern, '[FIR]'));

  const sortedNames = entities.filter(entity => personRoles[entity.label] && validSpan(text, entity.start, entity.end))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const names: Entity[] = [];
  for (const entity of sortedNames) {
    const previous = names.at(-1);
    if (previous?.label === entity.label && previous.end === entity.start) {
      previous.end = entity.end;
      previous.text = text.slice(previous.start, previous.end);
    } else {
      names.push({ ...entity });
    }
  }
  for (const { start, end, label } of names) {
    if (!wordBounded(text, start, end)) continue;
    const name = text.slice(start, end).trim();
    const key = name.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
    if (!key) continue;
    const role = personRoles[label]!;
    let replacement = aliases.get(key);
    if (!replacement) {
      const count = (roleCounts.get(role) ?? 0) + 1;
      replacement = role + '-' + count;
      roleCounts.set(role, count);
      aliases.set(key, replacement);
    }
    mapping.set(name, replacement);
    masks.push({ start, end, replacement, priority: 0, role });
  }

  const merged: Mask[] = [];
  for (const mask of masks.sort((a, b) => a.start - b.start || b.end - a.end || b.priority - a.priority)) {
    const previous = merged.at(-1);
    if (!previous || mask.start > previous.end || (mask.start === previous.end && mask.role !== previous.role)) {
      merged.push({ ...mask });
      continue;
    }
    if (mask.start === previous.end && (!mask.role || !previous.role)) {
      merged.push({ ...mask });
      continue;
    }
    previous.end = Math.max(previous.end, mask.end);
    if (mask.priority > previous.priority) {
      previous.replacement = mask.replacement;
      previous.priority = mask.priority;
      previous.role = mask.role;
    }
  }

  let cursor = 0;
  const chunks = merged.map(({ start, end, replacement }) => {
    const part = text.slice(cursor, start) + replacement;
    cursor = end;
    return part;
  });
  chunks.push(text.slice(cursor));
  return { text: chunks.join(''), mapping };
}
