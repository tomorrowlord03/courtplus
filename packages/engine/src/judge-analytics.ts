import type {
  AgingBucket,
  BenchBacklogSummary,
  CaseMeta,
  CaseRecord,
  DailyRatePoint,
  Hearing,
  ISODate,
  JudgeMetric,
} from '@courtplus/contracts';
import { day, iso } from './dates.js';
import { courtBacklog } from './jai.js';

// Official NJDG / data.gov.in benchmarks as of 27-03-2026
export const OFFICIAL_NJDG_BENCHMARKS = {
  district10YearPendingIndia: 5256293,
  district10YearPendingChhattisgarh: 1166,
  hcPendingIndia: 6396737,
  hcPendingChhattisgarh: 75525,
  hcJudgeVacanciesIndia: 308,
  hcJudgeVacanciesChhattisgarh: 7,
};

function getDisposalDate(record: CaseRecord): number | undefined {
  const explicit = day(record.disposalDate);
  if (explicit !== undefined || record.pendingStatus !== 'disposed') return explicit;
  return record.events.filter(event => event.kind === 'acquitted' || event.kind === 'convicted')
    .map(event => day(event.on)).filter(date => date !== undefined).sort((a, b) => a - b)[0];
}

type CourtRecords = { metadata: readonly CaseMeta[]; hearings: readonly Hearing[] };

function countAdjournments(record: CaseRecord, hearings: readonly Hearing[], asOf: ISODate): number {
  const recordedDates = new Set(hearings.map(hearing => hearing.date));
  const recorded = hearings.filter(hearing => hearing.outcome === 'adjourned' && hearing.date <= asOf).length;
  const legacyDates = new Set(record.events.filter(event => event.kind === 'hearing' &&
    day(event.on) !== undefined && event.on <= asOf && !recordedDates.has(event.on) &&
    /^(?:adjourned|adjournment granted|(?:the )?(?:case|matter|hearing) (?:was |is )?adjourned)\b/i.test(event.note?.trim() ?? ''))
    .map(event => event.on));
  return recorded + legacyDates.size;
}

export function classifyAging(ageDays: number): keyof AgingBucket {
  if (ageDays < 365) return 'under1Year';
  if (ageDays < 365 * 3) return 'oneToThreeYears';
  if (ageDays < 365 * 5) return 'threeToFiveYears';
  if (ageDays < 365 * 10) return 'fiveToTenYears';
  return 'overTenYears';
}

export function computeJudgePerformance(
  cases: CaseRecord[],
  asOf: ISODate,
  targetJudgeName?: string,
  court?: CourtRecords,
): BenchBacklogSummary {
  const asOfNum = day(asOf) ?? Math.floor(Date.now() / 86_400_000);
  const snapshot = iso(asOfNum);
  const metadata = new Map(court?.metadata.map(meta => [meta.caseId, meta]));
  const hearingsByCase = new Map<string, Hearing[]>();
  for (const hearing of court?.hearings ?? []) {
    const group = hearingsByCase.get(hearing.caseId) ?? [];
    group.push(hearing);
    hearingsByCase.set(hearing.caseId, group);
  }

  const judgeGroups = new Map<string, { record: CaseRecord; filed?: number; disposed?: number; hearings: Hearing[] }[]>();
  for (const c of cases) {
    const judge = c.judgeName?.trim() || 'Court Bench (Unassigned)';
    if (targetJudgeName && judge.toLowerCase() !== targetJudgeName.trim().toLowerCase()) {
      continue;
    }
    const meta = metadata.get(c.id);
    const hearings = hearingsByCase.get(c.id) ?? [];
    const filed = day(meta?.filedOn) ?? day(c.filingDate);
    if (filed !== undefined && filed > asOfNum) continue;
    const disposedFromHearing = hearings.filter(hearing => hearing.outcome === 'disposed')
      .map(hearing => day(hearing.date)).filter(date => date !== undefined).sort((a, b) => a - b)[0];
    const disposed = day(meta?.disposedOn) ?? disposedFromHearing ?? getDisposalDate(c);
    const group = judgeGroups.get(judge) ?? [];
    group.push({ record: c, filed, disposed, hearings });
    judgeGroups.set(judge, group);
  }

  const judges: JudgeMetric[] = [];
  let benchActiveTotal = 0;
  let benchDisposedTotal = 0;

  for (const [judgeName, judgeCases] of judgeGroups.entries()) {
    let activeCases = 0;
    let disposedCases = 0;
    let totalAdjournmentsGranted = 0;
    let totalLifespanDays = 0;
    let datedLifespans = 0;
    let disposalVelocity = 0;
    const closed = new Set<string>();

    const byCaseType: Record<string, { pending: number; disposed: number }> = {};
    const timelineMap = new Map<ISODate, { filed: number; disposed: number }>();
    function countOn(date: number | undefined, kind: 'filed' | 'disposed') {
      if (date === undefined || date > asOfNum) return;
      const on = iso(date);
      const entry = timelineMap.get(on) ?? { filed: 0, disposed: 0 };
      entry[kind]++;
      timelineMap.set(on, entry);
    }

    for (const { record: c, filed, disposed, hearings } of judgeCases) {
      const caseType = c.caseType ?? (c.charges.length > 0 ? 'criminal' : 'civil');
      if (!byCaseType[caseType]) byCaseType[caseType] = { pending: 0, disposed: 0 };
      totalAdjournmentsGranted += countAdjournments(c, hearings, snapshot);
      const isDisposed = disposed === undefined ? c.pendingStatus === 'disposed' : disposed <= asOfNum;
      countOn(filed, 'filed');
      countOn(disposed, 'disposed');

      if (isDisposed) {
        closed.add(c.id);
        disposedCases += 1;
        byCaseType[caseType].disposed += 1;
        if (disposed !== undefined && disposed > asOfNum - 30) disposalVelocity++;
      } else {
        activeCases += 1;
        byCaseType[caseType].pending += 1;
      }
      const end = isDisposed ? disposed : asOfNum;
      if (filed !== undefined && end !== undefined && end >= filed) {
        totalLifespanDays += end - filed;
        datedLifespans++;
      }
    }

    const backlog = courtBacklog(judgeCases.map(({ record, filed, disposed }) => ({
      caseId: record.id,
      filedOn: filed === undefined ? undefined : iso(filed),
      disposedOn: disposed === undefined ? undefined : iso(disposed),
    })), snapshot, closed);
    const [under1Year = 0, oneToThreeYears = 0, threeToFiveYears = 0, fiveToTenYears = 0, overTenYears = 0] =
      backlog.age.map(bucket => bucket.count);
    const totalFiled = activeCases + disposedCases;
    const clearanceRate = totalFiled > 0
      ? Math.round((disposedCases / totalFiled) * 1000) / 10
      : 0;
    const avgCaseLifespanDays = datedLifespans > 0
      ? Math.round(totalLifespanDays / datedLifespans)
      : 0;
    const adjournmentRatio = disposedCases > 0
      ? Math.round((totalAdjournmentsGranted / disposedCases) * 10) / 10
      : totalAdjournmentsGranted;

    // Construct sorted timeline for filings vs resolutions
    const timeline: DailyRatePoint[] = [...timelineMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14) // Last 14 reporting points
      .map(([date, counts]) => ({
        date,
        filed: counts.filed,
        disposed: counts.disposed,
        clearanceRate: counts.filed > 0 ? Math.round((counts.disposed / counts.filed) * 100) : 0,
      }));

    const sampleCase = judgeCases[0].record;
    judges.push({
      judgeName,
      courtRoom: sampleCase.courtRoom,
      court: sampleCase.court,
      activeCases,
      disposedCases,
      totalFiled,
      clearanceRate,
      disposalVelocity,
      avgCaseLifespanDays,
      totalAdjournmentsGranted,
      adjournmentRatio,
      aging: { under1Year, oneToThreeYears, threeToFiveYears, fiveToTenYears, overTenYears },
      timeline,
      weeks: backlog.weeks,
      byCaseType,
    });

    benchActiveTotal += activeCases;
    benchDisposedTotal += disposedCases;
  }

  const benchTotal = benchActiveTotal + benchDisposedTotal;
  const benchClearanceRate = benchTotal > 0
    ? Math.round((benchDisposedTotal / benchTotal) * 1000) / 10
    : 0;

  return {
    asOf,
    totalJudges: judges.length,
    totalActiveCases: benchActiveTotal,
    totalDisposedCases: benchDisposedTotal,
    benchClearanceRate,
    stateNjdg10YearComparison: {
      district10YearPending: OFFICIAL_NJDG_BENCHMARKS.district10YearPendingIndia,
      chhattisgarh10YearPending: OFFICIAL_NJDG_BENCHMARKS.district10YearPendingChhattisgarh,
      ratioToNational: Math.round((OFFICIAL_NJDG_BENCHMARKS.district10YearPendingChhattisgarh / OFFICIAL_NJDG_BENCHMARKS.district10YearPendingIndia) * 10000) / 100,
    },
    judges,
  };
}
