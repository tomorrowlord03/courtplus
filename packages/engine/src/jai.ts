import type { Authority, CaseMeta, CauseList, CourtBacklog, CourtSettings, Hearing, ISODate,
  PriorityOverride, TriageFactor, TriageRank } from '@courtplus/contracts';
import { addMonths, day, iso } from './dates.js';

export const defaultCourtSettings: CourtSettings = { capacity: 40, oldestShare: 25, minimumPreparationDays: 7 };
const constitution = 'https://www.indiacode.nic.in/bitstream/123456789/16124/1/the_constitution_of_india.pdf';
export const bnss = 'https://www.indiacode.nic.in/bitstream/123456789/20340/1/bnss%2C_2023.pdf';
const njdg: Authority = {
  act: 'National Judicial Data Grid', section: 'Pending cases',
  text: 'NJDG tracks pending cases by age and highlights cases filed by senior citizens and women.',
  url: 'https://njdg.ecourts.gov.in/njdg_v3/',
};
const cheque: Authority = {
  act: 'Negotiable Instruments Act, 1881', section: '143(3)',
  text: 'The court should endeavour to conclude the trial within six months from the filing of the complaint.',
  url: 'https://www.indiacode.nic.in/bitstream/123456789/15327/1/negotiable_instruments_act%2C_1881.pdf',
};
const ageLabels = ['<1 year', '1–<3 years', '3–<5 years', '5–10 years', '>10 years'];

function ageBucket(filed: number, asOf: number): number {
  if (asOf < addMonths(filed, 12)) return 0;
  if (asOf < addMonths(filed, 36)) return 1;
  if (asOf < addMonths(filed, 60)) return 2;
  return asOf <= addMonths(filed, 120) ? 3 : 4;
}

export function scoreCase(meta: CaseMeta, hearings: readonly Hearing[], asOf: ISODate): TriageRank {
  const on = day(asOf)!;
  const filed = day(meta.filedOn)!;
  const age = ageBucket(filed, on);
  const flags = new Set(meta.partyFlags);
  const adjournments = hearings.filter(h => h.caseId === meta.caseId && h.outcome === 'adjourned' && h.date <= asOf).length;
  const target = meta.caseType === 'cheque' ? addMonths(filed, 6) : undefined;
  const factor = (label: string, weight: number, points: number, reason: string, sources: Authority[]): TriageFactor =>
    ({ label, weight, points, reason, sources });
  const custody: Authority[] = [{
    act: 'Constitution of India', section: 'Article 21', text: 'Protects life and personal liberty.', url: constitution,
  }];
  if (meta.partiesInCustody && flags.has('undertrial')) custody.push({
    act: 'Bharatiya Nagarik Suraksha Sanhita, 2023', section: '479',
    text: 'Sets detention limits for eligible undertrial prisoners, subject to statutory conditions.', url: bnss,
  });
  const factors = [
    factor('Custody', 25, meta.partiesInCustody ? 25 : 0, meta.partiesInCustody
      ? 'A party is in custody.' : 'No party marked as in custody.', custody),
    factor('Senior citizen', 7, flags.has('seniorCitizen') ? 7 : 0,
      flags.has('seniorCitizen') ? 'A party is marked as a senior citizen.' : 'No senior citizen flag recorded.', [njdg]),
    factor('Woman', 5, flags.has('woman') ? 5 : 0,
      flags.has('woman') ? 'A party is marked as a woman.' : 'No woman flag recorded.', [njdg]),
    factor('Child', 8, flags.has('child') ? 8 : 0, flags.has('child')
      ? 'A party is marked as a child.' : 'No child flag recorded.', [{
      act: 'Constitution of India', section: 'Article 15(3)',
      text: 'Permits special provisions for women and children.', url: constitution,
    }]),
    factor('Disability', 5, flags.has('disability') ? 5 : 0, flags.has('disability')
      ? 'A party is marked as having a disability.' : 'No disability flag recorded.', [{
      act: 'Rights of Persons with Disabilities Act, 2016', section: '12',
      text: 'Provides for access to justice for persons with disabilities.',
      url: 'https://www.indiacode.nic.in/bitstream/123456789/19015/1/rpwd_act_2016.pdf',
    }]),
    factor('Case age', 25, [0, 6, 12, 18, 25][age], `Filed ${meta.filedOn}. Age band ${ageLabels[age]}.`, [njdg]),
    factor('National security', 5, meta.nationalSecurity ? 5 : 0, meta.nationalSecurity
      ? 'A national-security statute is recorded.' : 'No national-security statute recorded.', [{
      act: 'National Investigation Agency Act, 2008', section: '19',
      text: 'Provides trial precedence in specified circumstances for trials under the Act before a Special Court.',
      url: 'https://www.indiacode.nic.in/bitstream/123456789/2054/3/a2008-34.pdf',
    }, {
      act: 'Unlawful Activities (Prevention) Act, 1967', section: 'Chapter IV',
      text: 'Sets out offences under a special national-security statute.',
      url: 'https://www.indiacode.nic.in/handle/123456789/1470',
    }]),
    factor('Adjournments', 10, Math.min(10, adjournments * 2),
      `${adjournments} recorded adjournment(s). Two points each, up to ten.`, [njdg]),
    factor('Cheque trial target', 10, target !== undefined && on >= target ? 10 : 0,
      target === undefined ? 'Applies to cheque complaints under the NI Act.' :
        `Six-month endeavour date ${iso(target)} ${on >= target ? 'reached' : 'ahead'}.`, [cheque]),
  ];
  return { meta, factors, score: factors.reduce((sum, item) => sum + item.points, 0) };
}

function oldestFirst(a: TriageRank, b: TriageRank): number {
  return a.meta.filedOn.localeCompare(b.meta.filedOn) || a.meta.caseId.localeCompare(b.meta.caseId);
}

export function rankCases(cases: readonly CaseMeta[], hearings: readonly Hearing[], overrides: readonly PriorityOverride[],
  asOf: ISODate): TriageRank[] {
  const overrideByCase = new Map(overrides.filter(item => item.direction !== 'clear').map(item => [item.caseId, item]));
  const hearingsByCase = new Map<string, Hearing[]>();
  for (const hearing of hearings) {
    const group = hearingsByCase.get(hearing.caseId);
    if (group) group.push(hearing);
    else hearingsByCase.set(hearing.caseId, [hearing]);
  }
  const pin = (row: TriageRank) => row.override?.direction === 'up' ? -1 : row.override?.direction === 'down' ? 1 : 0;
  return cases.filter(meta => !meta.disposedOn && meta.filedOn <= asOf)
    .map(meta => ({ ...scoreCase(meta, hearingsByCase.get(meta.caseId) ?? [], asOf), override: overrideByCase.get(meta.caseId) }))
    .sort((a, b) => pin(a) - pin(b) || b.score - a.score || oldestFirst(a, b));
}

export function suggestCauseList(date: ISODate, ranked: readonly TriageRank[], settings: CourtSettings,
  booked: ReadonlyMap<string, ISODate>): CauseList {
  const entries: CauseList['entries'] = [...booked]
    .filter(([, on]) => on === date).map(([caseId]) => ({ caseId, basis: 'adjournment' }));
  const available = Math.max(0, settings.capacity - entries.length);
  const candidates = ranked.filter(row => !booked.has(row.meta.caseId));
  const reserve = Math.min(available, Math.ceil(settings.capacity * settings.oldestShare / 100));
  const oldest = candidates.filter(row => row.override?.direction !== 'down').sort(oldestFirst).slice(0, reserve);
  const reserved = new Set(oldest.map(row => row.meta.caseId));
  entries.push(...oldest.map(({ meta, score }) => ({ caseId: meta.caseId, score, basis: 'oldest' as const })),
    ...candidates.filter(row => !reserved.has(row.meta.caseId)).slice(0, available - oldest.length)
      .map(({ meta, score }) => ({ caseId: meta.caseId, score, basis: 'priority' as const })));
  return { date, capacity: settings.capacity, confirmed: false, entries };
}

type DatedCase = Pick<CaseMeta, 'caseId' | 'disposedOn'> & Partial<Pick<CaseMeta, 'filedOn'>>;

export function courtBacklog(cases: readonly DatedCase[], asOf: ISODate, closedCaseIds: ReadonlySet<string>): CourtBacklog {
  const today = day(asOf)!;
  const monday = today - ((today + 3) % 7 + 7) % 7;
  const weeks = Array.from({ length: 8 }, (_, index) => ({ start: iso(monday - (7 - index) * 7), filed: 0, disposed: 0 }));
  const age = ageLabels.map(label => ({ label, count: 0 }));
  const first = day(weeks[0].start)!;
  let activity = false;
  for (const meta of cases) {
    const filed = day(meta.filedOn);
    const disposed = day(meta.disposedOn);
    if (filed !== undefined && filed >= first && filed <= today) {
      weeks[Math.floor((filed - first) / 7)].filed++;
      activity = true;
    }
    if (disposed !== undefined && disposed >= first && disposed <= today) {
      weeks[Math.floor((disposed - first) / 7)].disposed++;
      activity = true;
    }
    if (filed !== undefined && filed <= today && !closedCaseIds.has(meta.caseId) && (disposed === undefined || disposed > today)) {
      age[ageBucket(filed, today)].count++;
    }
  }
  return { weeks: activity ? weeks : [], age: age.some(item => item.count) ? age : [] };
}
