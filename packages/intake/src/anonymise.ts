import type { Entity } from '@courtplus/contracts';
import { caseIdLoosePattern, caseIdPattern, cnrPattern, firPattern, validSpan } from './patterns.js';

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
const relativeStart = /\b[sdw]\s*\/\s*o\b|\b(?:son|daughter|wife)\s+of\b|आत्मज|पिता(?:\s+का\s+नाम)?/giu;
const joinedRelativeStart = /\b[SDWsdw][ \t]*\/[ \t]*[Oo](?=\p{Lu}|[a-z]\b[ \t]+\p{Lu})/gu;
const relativeEnd = /(?=,[ \t]*(?:r\s*\/\s*o\b|resident\s+of\b|निवासी))|[ \t]+(?=(?:r\s*\/\s*o\b|resident\s+of\b|निवासी))|\n[ \t]*\n|\f|[ \t\n]+(?:\.{3}[ \t]*)?(?=(?:applicants?|petitioners?|respondents?|versus|vs\.?)\b)|\n[ \t]*\d+[ \t]*[-.)]|[;।!?]|\.(?=[ \t]+(?:The|He|She|They|This|That)\b)/giu;
const englishName = String.raw`(?:[A-Z][\p{Ll}\p{M}]+|[A-Z]{2,})(?:[ \t]+(?:[A-Z][\p{Ll}\p{M}]+|[A-Z]{2,})){0,3}`;
const hindiName = String.raw`[\p{Script=Devanagari}][\p{Script=Devanagari}\p{M}]+(?:[ \t]+[\p{Script=Devanagari}][\p{Script=Devanagari}\p{M}]+){0,3}`;
const nameCues: { pattern: RegExp; role: string }[] = [
  { pattern: new RegExp(`(?<name>${englishName})[ \\t]*(?:,?[ \\t]*(?:[SDWsdw]\\s*\\/\\s*[Oo]|[Ss]on of|[Dd]aughter of|[Ww]ife of)\\b)`, 'dgu'), role: 'Accused' },
  { pattern: new RegExp(`(?:\\b[SDWsdw]\\s*\\/\\s*[Oo]\\b|\\b(?:[Ss]on|[Dd]aughter|[Ww]ife) of\\b|आत्मज|पिता)[ \\t:,-]*(?<name>${englishName})`, 'dgu'), role: 'Relative' },
  { pattern: new RegExp(`(?:आत्मज|पिता)[ \\t:,-]*(?<name>${hindiName})`, 'dgu'), role: 'Relative' },
  { pattern: new RegExp(`\\b(?:[Aa]pplicants?|[Aa]ccused|[Cc]omplainants?|[Ww]itness(?:es)?|[Dd]eceased|[Vv]ictims?|[Pp]etitioners?)\\b[ \\t:,-]+(?<name>${englishName})`, 'dgu'), role: 'Person' },
  { pattern: new RegExp(`\\b(?:[Aa]dvocate|[Ll]earned counsel|Hon'?ble[ \\t]+Shri[ \\t]+Justice|[Jj]udge)\\b[ \\t:,-]+(?<name>${englishName})`, 'dgu'), role: 'Lawyer' },
  { pattern: new RegExp(`(?<name>${hindiName})[ \\t]+(?:पुत्री?|पत्नी)`, 'dgu'), role: 'Person' },
];
const nonNames = /^(?:The|This|That|State|Court|High|Bail|Application|Applicant|Accused|Witness|Victim|Deceased|Learned|Counsel|Justice|Judge|Order|Section|Police|Station|District|Government|Hon|Honble)$/iu;
const softSpace = String.raw`(?:[ \t]*\r?\n[ \t]*|[ \t]+)`;
const aliasName = `(?:${englishName}|${hindiName})`;
const partyAliases = new RegExp(
  String.raw`^[ \t]*(?:\d+[ \t]*[-.)][ \t]*)?(?<names>${aliasName}(?:${softSpace}?@${softSpace}?${aliasName})+)`
    + String.raw`(?=${softSpace}?,?${softSpace}?(?:[SDWsdw]\s*\/\s*[Oo](?:\b|(?=\p{Lu}))|[Aa]ged\b|पुत्री?|पत्नी|आत्मज))`,
  'dgmu',
);

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

function nameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
}

function discoverPartyAliases(text: string, keys: Map<string, string>): Entity[] {
  return [...text.matchAll(partyAliases)].flatMap(match => {
    const [start, end] = match.indices!.groups!.names;
    const chain = text.slice(start, end);
    const key = nameKey(chain.split('@', 1)[0].trim());
    const names: Entity[] = [{ label: 'PETITIONER', text: chain, start, end, score: 0.8 }];
    for (const part of chain.matchAll(/[^@]+/gu)) {
      const name = part[0].trim();
      const offset = start + part.index + part[0].indexOf(name);
      const partKey = nameKey(name);
      if (!keys.has(partKey)) keys.set(partKey, key);
      names.push({ label: 'PETITIONER', text: name, start: offset, end: offset + name.length, score: 0.8 });
    }
    keys.set(nameKey(chain), key);
    return names;
  });
}

function partySpellingMasks(text: string, name: string, replacement: string, role: string): Mask[] {
  const parts = /^([a-z]{3,}) ([a-z]{4,})$/u.exec(name);
  if (!parts) return [];
  const [, first, surname] = parts;
  // Only accept an extra internal letter in a surname after an explicit person reference.
  const variants = Array.from({ length: surname.length - 1 }, (_, offset) => {
    const index = offset + 1;
    return surname.slice(0, index) + '[a-z]' + surname.slice(index);
  }).join('|');
  const pattern = new RegExp(
    String.raw`\b(?:possession of|statement of|applicant|accused|petitioner|respondent)${softSpace}(?<name>${first}${softSpace}(?:${variants}))`,
    'dgiu',
  );
  return [...text.matchAll(pattern)].flatMap(match => {
    const [start, end] = match.indices!.groups!.name;
    return wordBounded(text, start, end) ? [{ start, end, replacement, priority: 0, role }] : [];
  });
}

export function anonymise(text: string, entities: Entity[], { maskIds = true }: AnonymiseOptions = {}): AnonymisedOrder {
  const aliases = new Map<string, string>();
  const partyAliasKeys = new Map<string, string>();
  const mapping = new Map<string, string>();
  const roleCounts = new Map<string, number>();
  const masks: Mask[] = [
    ...ruleMasks(text, phonePattern, '[Phone]'),
    ...blockMasks(text, addressStart, addressEnd, '[Address]'),
    ...blockMasks(text, relativeStart, relativeEnd, '[Relative]'),
    ...blockMasks(text, joinedRelativeStart, relativeEnd, ' [Relative]'),
  ];
  if (maskIds) masks.push(...ruleMasks(text, cnrPattern, '[CNR]'), ...ruleMasks(text, firPattern, '[FIR]'),
    ...[...text.matchAll(caseIdPattern), ...text.matchAll(caseIdLoosePattern)].map(match => ({ start: match.index, end: match.index + match[0].length,
      replacement: '[Case Number]', priority: 1 })));

  const discovered: Entity[] = nameCues.flatMap(({ pattern, role }) => [...text.matchAll(pattern)].flatMap(match => {
    const span = match.indices?.groups?.name;
    if (!span) return [];
    const name = text.slice(span[0], span[1]);
    if (name.split(/[ \t]+/u).every(part => nonNames.test(part))) return [];
    const label: Entity['label'] = role === 'Accused' ? 'PETITIONER' : role === 'Relative' ? 'OTHER_PERSON' : role === 'Lawyer' ? 'LAWYER' : 'OTHER_PERSON';
    return [{ label, text: name, start: span[0], end: span[1], score: 0.8 }];
  }));
  const sortedNames = [...entities, ...discoverPartyAliases(text, partyAliasKeys), ...discovered]
    .filter(entity => personRoles[entity.label] && validSpan(text, entity.start, entity.end))
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
    const source = text.slice(start, end);
    const name = source.trim();
    if (!name) continue;
    const normalized = nameKey(name);
    const key = partyAliasKeys.get(normalized) ?? normalized;
    const role = personRoles[label]!;
    let replacement = aliases.get(key);
    if (!replacement) {
      const count = (roleCounts.get(role) ?? 0) + 1;
      replacement = role + '-' + count;
      roleCounts.set(role, count);
      aliases.set(key, replacement);
    }
    mapping.set(name, replacement);
    const originalStart = start + source.indexOf(name);
    masks.push({ start: originalStart, end: originalStart + name.length, replacement, priority: 0, role });
    const escaped = name.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join(softSpace);
    for (const occurrence of text.matchAll(new RegExp(escaped, 'giu'))) {
      const a = occurrence.index;
      const b = a + occurrence[0].length;
      if (a !== originalStart && wordBounded(text, a, b)) masks.push({ start: a, end: b, replacement, priority: 0, role });
    }
    if (label === 'PETITIONER' || label === 'RESPONDENT') {
      masks.push(...partySpellingMasks(text, normalized, replacement, role));
    }
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
