import type { Charge, Entity, FieldSuggestion } from '@courtplus/contracts';
import { cnrPattern, validSpan } from './patterns.js';

type Sentence = { text: string; start: number; end: number; page: number };
type Candidate = { field: string; value: string; start: number; end: number; entity?: Entity; confidence: number };

const statuteNames: [string, RegExp][] = [
  ['IPC', /\bI\.?\s*P\.?\s*C\b\.?|\bIndian Penal Code\b|भारतीय दंड संहिता/iu],
  ['BNSS', /\bB\.?\s*N\.?\s*S\.?\s*S\b\.?|\bBharatiya Nagarik Suraksha Sanhita\b|भारतीय नागरिक सुरक्षा संहिता/iu],
  ['BNS', /\bB\.?\s*N\.?\s*S\b\.?|\bBharatiya Nyaya Sanhita\b|भारतीय न्याय संहिता/iu],
  ['NDPS', /\bNDPS\b|\bNarcotic Drugs and Psychotropic Substances Act\b/iu],
  ['UAPA', /\bUAPA\b|\bUnlawful Activities \(Prevention\) Act\b/iu],
  ['PMLA', /\bPMLA\b|\bPrevention of Money[- ]Laundering Act\b/iu],
  ['POCSO', /\bPOCSO\b|\bProtection of Children from Sexual Offences Act\b/iu],
  ['PC_ACT', /\bPC Act\b|\bPrevention of Corruption Act\b/iu],
  ['ARMS', /\bArms(?:\s+Act)?\b/iu],
  ['EXCISE', /\bExcise(?:\s+Act)?\b/iu],
  ['OTHER', /\b(?:Information Technology|IT|Motor Vehicles?|Chhattisgarh (?:Freedom of Religion|Agricultural Cattle Preservation)) Act\b/iu],
];

const actPattern = new RegExp(statuteNames.map(([, pattern]) => pattern.source).join('|'), 'giu');
const numberPart = '[0-9०-९]+-?[A-Z]?(?:\\s*\\([0-9०-९A-Z-]+\\))*';
const sectionList = new RegExp('(?:\\b(?:sections?|sec\\.?|u\\s*\\/\\s*s|s\\.)|धारा(?:एँ|ओं)?)\\s*(' + numberPart
  + '(?:(?:\\s*[,/&]\\s*|\\s+(?:and|or|और|व)\\s+|\\s+read\\s+with\\s+)' + numberPart + ')*)', 'dgiu');
const sectionNumber = new RegExp(numberPart, 'giu');
const datePattern = /(?<![\p{N}/.-])(?:[0-9०-९]{4}[-/.][0-9०-९]{1,2}[-/.][0-9०-९]{1,2}|[0-9०-९]{1,2}[-/.][0-9०-९]{1,2}[-/.][0-9०-९]{4})(?![\p{N}/-])/gu;
const writtenDate = /\b(\d{1,2})(?:st|nd|rd|th)?[ \t]+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?[ ,\t]+(\d{4})\b/giu;
const hindiDate = /([0-9०-९]{1,2})[ \t]+(जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर)[ ,\t]+([0-9०-९]{4})/giu;
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const hindiMonths = ['जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
const roles: [string, RegExp][] = [
  ['custodySince', /\b(?:in custody since|custody since|in jail since|in judicial custody since)\b|से\s+(?:हिरासत|न्यायिक अभिरक्षा|जेल)/giu],
  ['arrestedOn', /\barrest(?:ed)?\b|गिरफ्तार|गिरफ़्तार|गिरफ्तारी/giu],
  ['chargesheetOn', /\b(?:charge[\s-]*sheet|challan|final\s+report)s?\b|आरोप[\s-]*पत्र|चालान/giu],
  ['bailGrantedOn', /\bbail\s+(?:(?:has been|was|is)\s+)?granted\b|\bgranted\s+bail\b|जमानत\s+(?:मंजूर|स्वीकृत|प्रदान)/giu],
  ['firstRemandOn', /\b(?:first|initial)\s+(?:judicial\s+|police\s+)?remand\b/giu],
  ['remandOn', /\bremand(?:ed)?\b|रिमांड|अभिरक्षा में भेज/giu],
  ['bailDate', /\bbail\b|ज़मानत|जमानत/giu],
  ['orderDate', /\border\s+(?:on\s+board|date(?:d)?)\b|\bdate\s+of\s+(?:this\s+)?order\b|आदेश\s+दिनांक/giu],
];

function asciiDigits(text: string): string {
  return text.replace(/[०-९]/gu, digit => String(digit.charCodeAt(0) - 0x966));
}

function sentences(text: string): Sentence[] {
  const found: Sentence[] = [];
  let offset = 0;
  for (const [index, page] of text.split('\f').entries()) {
    const boundaries = /[!?।॥](?=\s|$)|\.(?=\s|$)|\n[ \t]*\n|$/gu;
    let start = 0;
    for (const match of page.matchAll(boundaries)) {
      const end = match.index + match[0].length;
      const part = page.slice(start, end);
      if (match[0] === '.' && /(?:\b(?:no|nos|sec|mr|mrs|ms|dr|shri|smt|vs|v|ps|p|s|i|r|n|b|c)|[०-९0-9]\s*\/\s*[sS])\.$/iu.test(part)) continue;
      const trimmed = part.trim();
      if (trimmed) found.push({ text: trimmed, start: offset + start + part.indexOf(trimmed), end: offset + end, page: index + 1 });
      start = end;
    }
    offset += page.length + 1;
  }
  return found;
}

function actName(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return statuteNames.find(([, pattern]) => pattern.test(normalized))?.[0] ?? normalized;
}

function sections(sentence: Sentence, entities: Entity[]): Candidate[] {
  const { text, start } = sentence;
  const statutes = [...entities.filter(e => e.label === 'STATUTE' && e.text.trim().length >= 4),
    ...[...text.matchAll(actPattern)].map(m => ({ text: m[0], start: start + m.index, end: start + m.index + m[0].length, score: 0.88 }))];
  const provisions = entities.filter(e => e.label === 'PROVISION').flatMap(entity =>
    [...entity.text.matchAll(sectionNumber)].map(m => ({
      value: m[0], start: entity.start + m.index, end: entity.start + m.index + m[0].length, entity,
    })));

  const candidates: Candidate[] = [];
  const add = (number: string, a: number, b: number, groupStart: number, groupEnd: number, entity?: Entity) => {
    const match = statutes.flatMap(statute => {
      const distance = Math.max(0, statute.start - groupEnd, groupStart - statute.end);
      if (distance > 90 || (statute.start < groupEnd && groupStart < statute.end)) return [];
      const gap = text.slice(Math.min(statute.end, groupEnd) - start, Math.max(statute.start, groupStart) - start);
      if ([...gap.matchAll(actPattern)].length || /[;.!?।]/u.test(gap.replace(/\bu\s*\/\s*s\b|\bsec\./giu, ''))) return [];
      // An act that follows the provision with a direct connector takes precedence over a previous charge.
      const direct = statute.start >= groupEnd && /^\s*(?:(?:of|under)\s+(?:the\s+)?)?$/iu.test(gap);
      return [{ statute, distance, direct }];
    }).sort((left, right) => Number(right.direct) - Number(left.direct) || left.distance - right.distance)[0];
    if (!match) return;

    const section = asciiDigits(number).replace(/\s/gu, '').replace(/^(\d+)-(?=[A-Z])/iu, '$1')
      .replace(/\(([A-Z])\)/giu, (_, part: string) => '(' + part.toLowerCase() + ')');
    const context = text.slice(Math.max(0, groupStart - start - 35), Math.min(text.length, groupEnd - start + 65));
    const act = actName(match.statute.text);
    const cited = act === 'BNSS' || act === 'IPC' && section === '34' || act === 'BNS' && section === '3(5)'
      || /\b(?:bar|embargo|restriction|reasoning|consider|applies|requirement|in view of)\b/iu.test(context)
      && !/\b(?:charged|offence|offense|crime|fir|registered|punishable)\b/iu.test(context);
    candidates.push({
      field: cited ? 'citedProvision' : 'section', value: actName(match.statute.text) + ' ' + section,
      start: a, end: b, entity, confidence: Math.min(entity?.score ?? 0.88, match.statute.score),
    });
  };

  for (const list of text.matchAll(sectionList)) {
    const [listStart, listEnd] = list.indices![1];
    for (const m of list[1].matchAll(sectionNumber)) {
      const a = start + listStart + m.index;
      const b = a + m[0].length;
      const tagged = provisions.find(provision => provision.start < b && a < provision.end);
      add(m[0], a, b, start + list.index, start + listEnd, tagged?.entity);
    }
  }
  for (const provision of provisions) {
    if (!candidates.some(candidate => candidate.start < provision.end && provision.start < candidate.end)) {
      add(provision.value, provision.start, provision.end, provision.start, provision.end, provision.entity);
    }
  }
  return candidates;
}

function dateValue(raw: string): string | undefined {
  const numeric = asciiDigits(raw.trim()).match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/u);
  const written = [...raw.matchAll(writtenDate)][0];
  const hindi = [...raw.matchAll(hindiDate)][0];
  let parts: string[];
  if (numeric) parts = numeric[1].length === 4 ? numeric.slice(1) : [numeric[3], numeric[2], numeric[1]];
  else if (written) parts = [written[3], String(months.indexOf(written[2].slice(0, 3).toLowerCase()) + 1), written[1]];
  else if (hindi) parts = [asciiDigits(hindi[3]), String(hindiMonths.indexOf(hindi[2].replace('सितम्बर', 'सितंबर').replace('नवम्बर', 'नवंबर').replace('दिसम्बर', 'दिसंबर')) + 1), asciiDigits(hindi[1])];
  else return undefined;
  if (parts[0].length !== 4 || Number(parts[0]) < 1000) return undefined;
  const value = parts.map((part, i) => part.padStart(i === 0 ? 4 : 2, '0')).join('-');
  const stamp = new Date(value);
  return Number.isFinite(stamp.valueOf()) && stamp.toISOString().slice(0, 10) === value ? value : undefined;
}

function dateRole(sentence: Sentence, date: Pick<Candidate, 'start' | 'end'>, dates: Pick<Candidate, 'start' | 'end'>[]): string {
  const cues = roles.flatMap(([field, pattern]) => [...sentence.text.matchAll(pattern)].flatMap(match => {
    const start = sentence.start + match.index;
    const end = start + match[0].length;
    const distance = Math.max(0, date.start - end, start - date.end);
    const between = dates.some(other => (other.start >= end && other.end <= date.start) || (other.start >= date.end && other.end <= start));
    const gap = sentence.text.slice(Math.min(end, date.end) - sentence.start, Math.max(start, date.start) - sentence.start);
    if (distance > 45 || between || /[;,।!?]/u.test(gap)) return [];
    return [{ field, start, end, distance, after: start >= date.end }];
  }));
  const nearest = cues.filter(cue => !cues.some(other => other !== cue && other.start <= cue.start && other.end >= cue.end
    && (other.start < cue.start || other.end > cue.end)))
    .sort((a, b) => a.distance + Number(a.after) * 8 - b.distance - Number(b.after) * 8);
  if (nearest.length > 1 && nearest[0].field !== nearest[1].field
    && nearest[0].distance + Number(nearest[0].after) * 8 === nearest[1].distance + Number(nearest[1].after) * 8) return 'date';
  return nearest[0]?.field ?? 'date';
}

function matchFields(sentence: Sentence, entities: Entity[]): Candidate[] {
  const { text, start } = sentence;
  const suggestions = sections(sentence, entities);
  const fieldLabels: Partial<Record<Entity['label'], string>> = { COURT: 'court', CASE_NUMBER: 'caseNo', ORG: 'policeStation' };
  for (const entity of entities) {
    const field = fieldLabels[entity.label];
    if (!field || (entity.label === 'ORG' && !/police station|थाना/iu.test(entity.text))) continue;
    suggestions.push({ field, value: entity.text, start: entity.start, end: entity.end, confidence: entity.score, entity });
  }

  const patterns: [string, RegExp, number][] = [
    ['cnr', cnrPattern, 0.95],
    ['caseNo', /\b(?:case|crime|bail\s+(?:application|petition)|criminal\s+(?:appeal|revision)|MCRC|CRL\.?\s*(?:A|M))\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z]*\s*\d+\s*(?:\/|of|-)\s*\d{4})\b/dgiu, 0.85],
    ['court', /^[ \t]*(?:in\s+the\s+)?((?:high court|supreme court|court of|district court|sessions court)[^\n।!?]*)/dgimu, 0.75],
    ['policeStation', /(?:\b(?:police\s+station|P\.?\s*S\.?)\b\.?|थाना)\s*[:–-]?\s*([\p{L}\p{M}][\p{L}\p{M}' -]{0,55}?)(?=[,;.!?\n।]|$|\s+(?:District|State|in|under|and|was)\b)/dgiu, 0.82],
  ];
  for (const [field, pattern, confidence] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const group = match[1] === undefined ? 2 : 1;
      const [a, b] = match.indices![group];
      const value = field === 'cnr' ? match[group].toUpperCase() : match[group].trim().replace(/\.$/, '');
      if (field === 'caseNo' && suggestions.some(s => s.field === field && start + a < s.end && s.start < start + b)) continue;
      if (field === 'court' && suggestions.some(s => s.field === field && start + a < s.end && s.start < start + b)) continue;
      suggestions.push({ field, value, start: start + a, end: start + b, confidence });
    }
  }

  const dates: Candidate[] = [];
  for (const entity of entities.filter(e => e.label === 'DATE')) {
    dates.push({ field: 'date', value: dateValue(entity.text) ?? entity.text, start: entity.start, end: entity.end, confidence: entity.score, entity });
  }
  for (const match of [...text.matchAll(datePattern), ...text.matchAll(writtenDate), ...text.matchAll(hindiDate)]) {
    const value = dateValue(match[0]);
    if (!value) continue;
    const a = start + match.index;
    const b = a + match[0].length;
    const prior = dates.findIndex(date => a < date.end && date.start < b);
    if (prior !== -1) {
      dates[prior].value = value;
    } else {
      dates.push({ field: 'date', value, start: a, end: b, confidence: 0.78 });
    }
  }
  for (const date of dates) {
    let field = dateRole(sentence, date, dates);
    const before = text.slice(Math.max(0, date.start - start - 90), date.start - start);
    if (sentence.page === 1 && sentence.start < 1800 &&
      (/\b(?:order\s+on\s+board|date\s+of\s+(?:this\s+)?order|order\s+date(?:d)?)\b/iu.test(before)
        || /(?:^|\n)\s*(?:order|dated)\s*[:.-]?\s*$/iu.test(before))) field = 'orderDate';
    suggestions.push({ ...date, field });
  }
  return suggestions;
}

function outcomeSuggestion(text: string): FieldSuggestion | undefined {
  const tailStart = Math.max(0, text.length - 1600);
  const tail = text.slice(tailStart);
  const patterns: [string, RegExp][] = [
    ['granted', /\b(?:application|petition|bail)[^.!?\n]{0,90}\b(?:is|stands|are|hereby)?\s*allowed\b|\breleased?\s+on\s+bail\b|\bbail\s+is\s+granted\b/giu],
    ['rejected', /\b(?:application|petition|bail)[^.!?\n]{0,90}\b(?:is|stands|are|hereby)?\s*(?:rejected|dismissed)\b/giu],
    ['withdrawn', /\b(?:dismissed|rejected)\s+as\s+withdrawn\b|\b(?:application|petition)[^.!?\n]{0,90}\bwithdrawn\b/giu],
  ];
  const hits = patterns.flatMap(([value, pattern]) => [...tail.matchAll(pattern)].map(match => ({ value, start: tailStart + match.index, text: match[0] })));
  if (!hits.length) return undefined;
  hits.sort((a, b) => a.start - b.start || (a.value === 'withdrawn' ? 1 : -1));
  const evidence = hits.at(-1)!;
  const near = hits.filter(hit => evidence.start - hit.start < 260);
  const value = new Set(near.map(hit => hit.value)).size > 1
    && /\b(?:applicants?|accused)\s*(?:no\.?|nos\.?|numbers?)\s*\d|\b(?:one|other|another|first|second)\s+(?:bail\s+)?(?:application|applicant)\b/iu.test(tail.slice(Math.max(0, evidence.start - tailStart - 260)))
    ? 'mixed' : evidence.value;
  return { field: 'bailOutcome', value, sentence: evidence.text, page: text.slice(0, evidence.start).split('\f').length, confidence: 0.78 };
}

/** Values are proposals. Dates carry their inferred role in field, with date as a fallback. */
export function suggestFields(text: string, entities: Entity[]): FieldSuggestion[] {
  const ordered = entities.filter(e => validSpan(text, e.start, e.end)).sort((a, b) => a.start - b.start);
  let cursor = 0;
  const suggestions: FieldSuggestion[] = sentences(text).flatMap(sentence => {
    const related: Entity[] = [];
    while (cursor < ordered.length && ordered[cursor].start < sentence.end) {
      const entity = ordered[cursor++];
      if (entity.start >= sentence.start) related.push(entity);
    }
    const emitted = new Set<string>();
    return matchFields(sentence, related).sort((a, b) => a.start - b.start).flatMap(candidate => {
      const key = JSON.stringify([candidate.field, candidate.value]);
      if (emitted.has(key)) return [];
      emitted.add(key);
      return [{
        field: candidate.field, value: candidate.value, entity: candidate.entity,
        sentence: sentence.text, page: sentence.page, confidence: candidate.confidence,
      }];
    });
  });
  const outcome = outcomeSuggestion(text);
  if (outcome) suggestions.push(outcome);
  return suggestions;
}

/** The earliest offence-bearing section sentence is the conservative charge proposal; later citations remain available for review. */
export function chargedOffenceSuggestions(suggestions: FieldSuggestion[]): FieldSuggestion[] {
  const first = suggestions.find(suggestion => suggestion.field === 'section');
  if (!first) return [];
  const seen = new Set<string>();
  return suggestions.filter(suggestion => {
    if (suggestion.field !== 'section' || suggestion.page !== first.page || suggestion.sentence !== first.sentence
      || seen.has(suggestion.value)) return false;
    seen.add(suggestion.value);
    return true;
  });
}

/** Parse a charge proposal into contract-shaped act and section parts for review. */
export function parseChargeSuggestion(value: string): Pick<Charge, 'act' | 'section' | 'subsection' | 'variant'> | undefined {
  const match = /^(IPC|BNS|NDPS|UAPA|PMLA|POCSO|PC_ACT|ARMS|EXCISE|OTHER)\s+([0-9]+[a-z]?)(?:\(([^)]+)\))?(?:\(([^)]+)\))?$/iu.exec(value);
  if (!match) return undefined;
  return { act: match[1].toUpperCase() as Charge['act'], section: match[2],
    ...(match[3] ? { subsection: match[3].toLowerCase() } : {}),
    ...(match[4] ? { variant: match[4].toLowerCase() } : {}) };
}
