import type { ISODate, LookupOffenceFn, Tri } from '@courtplus/contracts';
import { addMonths, BNSS_START, day } from './dates.js';
import type { EngineCharge } from './facts.js';
import { offences } from './generated/offences.js';
import type { Offence } from './generated/offences.js';

function part(value = ''): string {
  const key = value.trim().toLowerCase().replace(/[()\s_–-]/g, '');
  if (key === 'parti' || key === 'part1') return 'i';
  if (key === 'partii' || key === 'part2') return 'ii';
  if (key === 'intermediatequantity' || key === 'intermediate') return 'intermediate';
  if (key === 'smallquantity') return 'small';
  if (key === 'commercialquantity') return 'commercial';
  return key;
}

const bySection = new Map<string, Offence[]>();
for (const row of offences) {
  const key = row.act + ':' + row.section;
  const rows = bySection.get(key) ?? [];
  rows.push(row);
  bySection.set(key, rows);
}

function findOffence(act: string, section: string, subsection?: string, variant?: string): Offence | undefined {
  act = act.trim().toUpperCase();
  const match = /^(?:s(?:ection)?\.?\s*)?(\d+[a-z]?)(.*)$/i.exec(section.trim());
  if (!match) return undefined;
  const rows = bySection.get(act + ':' + match[1].toUpperCase()) ?? [];
  const sub = part(subsection || match[2]);
  const choice = part(variant);
  const quantity = ['small', 'intermediate', 'commercial'].find(value => value === (choice || sub));
  if (act === 'NDPS' && quantity && (!choice || !sub || sub === 'b' && match[1] === '20')) {
    return rows.find(row => row.notes.startsWith('Quantity: ' + quantity + '.'));
  }
  if (!sub && !choice) return rows.find(row => !row.subsection && !row.variant);
  return rows.find(row => part(row.subsection) === sub && part(row.variant) === choice)
    ?? rows.find(row => part(row.subsection + row.variant) === sub + choice)
    ?? rows.find(row => part(row.subsection) === sub && !row.variant
      && (choice === '' || choice === 'ordinary' || act === 'NDPS' && ['small', 'intermediate', 'commercial'].includes(choice)
        && row.notes.includes('Quantity: ' + choice + '.')))
    ?? rows.find(row => !choice && part(row.variant) === sub && !row.subsection);
}

function penaltyVariantIssue(row: Offence, variant: string | undefined, prior: Tri): string | undefined {
  const maximum = row.maxMonths;
  if (row.variant || maximum === null) return undefined;
  const provision = row.act + ' s.' + row.section + (row.subsection ? '(' + row.subsection + ')' : '');
  const higher = bySection.get(row.act + ':' + row.section)?.filter(candidate => candidate.subsection === row.subsection
    && candidate.variant && (candidate.maxMonths === null || candidate.maxMonths > maximum)) ?? [];
  if (prior !== 'no' && higher.some(candidate => candidate.variant === 'repeat')) {
    return 'Verify whether the repeat-conviction penalty applies to ' + provision + '.';
  }
  if (part(variant) !== 'ordinary' && higher.some(candidate => candidate.variant !== 'repeat')) {
    return 'Specify the penalty variant for ' + provision + '.';
  }
  return undefined;
}

const REFERENCE_TERM_START = '2025-01-01';

export function lookupOffence(
  act: string, section: string, subsection?: string, termStart: ISODate = REFERENCE_TERM_START
): ReturnType<LookupOffenceFn> {
  const row = findOffence(act, section, subsection);
  if (!row || penaltyVariantIssue(row, undefined, 'unknown')) return null;
  const start = day(termStart);
  return {
    ...(row.maxMonths !== null && start !== undefined && { maxDays: termDays(start, row.maxMonths) }),
    maxText: row.death ? row.life ? 'death or life imprisonment' : 'death'
      : row.life ? 'life imprisonment' : row.fineOnly ? 'fine only'
        : row.maxMonths! % 12 === 0 ? row.maxMonths! / 12 + (row.maxMonths === 12 ? ' year' : ' years')
          : row.maxMonths + (row.maxMonths === 1 ? ' month' : ' months'),
    minYears: row.minYears, death: row.death, life: row.life,
    ...(row.bnsEquivalent && { bnsEquivalent: row.bnsEquivalent }),
    source: sourceUrl(row)
  };
};

export function sourceUrl(row: Offence): string {
  return row.sourceUrl + '#page=' + row.sourcePage;
}

const EXCISE_AMENDMENT = day('2011-04-30')!;
const NDPS_AMENDMENT = day('2014-05-01')!;
const ARMS_AMENDMENT = day('2019-12-14')!;

export function resolveCharges(charges: EngineCharge[], latestOffenceDay: number, prior: Tri = 'unknown') {
  return charges.map(charge => {
    const row = findOffence(charge.act, charge.section, charge.subsection, charge.variant);
    const offenceOn = charge.offenceOn === undefined ? latestOffenceDay : day(charge.offenceOn);
    let issue: string | undefined;
    if (offenceOn === undefined || offenceOn > latestOffenceDay) {
      issue = 'Offence date is invalid or later than first custody or the screening date.';
    } else if (charge.act === 'IPC' && charge.offenceOn !== undefined && offenceOn >= BNSS_START) {
      issue = 'IPC offence date is on or after 1 July 2024.';
    } else if (charge.act === 'BNS' && offenceOn < BNSS_START) {
      issue = 'BNS offence predates commencement based on the offence date or first custody.';
    } else if (row) {
      if (row.act === 'EXCISE' && offenceOn < EXCISE_AMENDMENT
        || row.act === 'NDPS' && row.notes.startsWith('Quantity: small.') && offenceOn < NDPS_AMENDMENT
        || row.act === 'ARMS' && (row.section !== '27' || row.subsection === '3') && offenceOn < ARMS_AMENDMENT) {
        issue = 'Offence predates the sourced ' + row.act + ' penalty edition.';
      } else {
        issue = penaltyVariantIssue(row, charge.variant, prior);
      }
    }
    return { charge, row: issue ? undefined : row, issue };
  });
}

export type ResolvedCharges = ReturnType<typeof resolveCharges>;

function termDays(start: number, months: number): number {
  return addMonths(start, months) - start;
}

export function maxDaysFrom(resolved: ResolvedCharges, first: number | undefined): number | undefined {
  const months = maxMonths(resolved);
  if (months === 0) return 0;
  if (first === undefined || months === undefined) return undefined;
  return termDays(first, months);
}

export function maxMonths(resolved: ResolvedCharges): number | undefined {
  if (!resolved.length || resolved.some(({ row }) => row?.maxMonths == null)) return undefined;
  return Math.max(...resolved.map(({ row }) => row!.maxMonths!));
}

export const specialReviewActs = new Set<string>(['NDPS', 'UAPA', 'PMLA', 'POCSO', 'PC_ACT']);
const bailableSections = new Set([
  'IPC:323', 'IPC:334', 'IPC:337', 'IPC:338', 'IPC:352',
  'IPC:417', 'IPC:418', 'IPC:419', 'IPC:426', 'IPC:427', 'IPC:447', 'IPC:448', 'IPC:451',
  'IPC:504',
  'BNS:115:2', 'BNS:117:2', 'BNS:122:1', 'BNS:125:a', 'BNS:125:b',
  'BNS:131', 'BNS:318:2', 'BNS:318:3', 'BNS:319:2', 'BNS:324:2', 'BNS:329:3', 'BNS:329:4',
  'BNS:332:c', 'BNS:351:2', 'BNS:351:3', 'BNS:352'
]);
const nonBailableSections = new Set([
  'IPC:302', 'IPC:304', 'IPC:304B', 'IPC:307', 'IPC:326', 'IPC:363A', 'IPC:364', 'IPC:364A',
  'IPC:365', 'IPC:379', 'IPC:380', 'IPC:392', 'IPC:393', 'IPC:394', 'IPC:395', 'IPC:396',
  'IPC:406', 'IPC:409', 'IPC:420', 'IPC:452', 'IPC:457', 'IPC:498A',
  'BNS:80:2', 'BNS:85', 'BNS:103:1', 'BNS:105', 'BNS:109:1', 'BNS:118:2', 'BNS:140:1',
  'BNS:140:2', 'BNS:140:3', 'BNS:303:2', 'BNS:305', 'BNS:309:4', 'BNS:309:5', 'BNS:309:6',
  'BNS:310:2', 'BNS:310:3', 'BNS:316:2', 'BNS:316:5', 'BNS:318:4', 'BNS:331', 'BNS:333'
]);

export function scheduleBailability(resolved: ResolvedCharges): 'yes' | 'no' | 'unknown' {
  const keys = resolved.flatMap(({ row }) => row ? [[row.act, row.section, row.subsection].filter(Boolean).join(':')] : []);
  if (resolved.some(({ row }) => row?.variant === 'theft' && (row.section === '451' || row.section === '332'))) return 'no';
  if (keys.some(key => nonBailableSections.has(key) || nonBailableSections.has(key.split(':').slice(0, 2).join(':')))) return 'no';
  // For offences whose classification can vary with local amendment, require case evidence.
  if (keys.length && keys.length === resolved.length && keys.every(key => bailableSections.has(key))) return 'yes';
  return 'unknown';
}

export function antilCategory(
  resolved: ResolvedCharges, twinConditions: boolean, economic: boolean
): 'A' | 'B' | 'C' | 'D' | undefined {
  if (twinConditions || resolved.some(({ charge, row }) =>
    charge.act === 'UAPA' && /^(?:1[5-9]|2[0-3]|3[5-9]|40)$/.test(charge.section)
    || charge.act === 'PMLA' && /^[34]$/.test(charge.section)
    || charge.act === 'NDPS' && (['19', '24', '27A'].includes(charge.section.toUpperCase())
      || row?.notes.includes('Quantity: commercial.')))) return 'C';
  if (resolved.some(({ row }) => row && (row.death || row.life || (row.maxMonths ?? 0) > 84))) return 'B';
  if (economic && !resolved.some(({ charge }) => specialReviewActs.has(charge.act))) return 'D';
  if (maxMonths(resolved) !== undefined) return 'A';
  return undefined;
}
