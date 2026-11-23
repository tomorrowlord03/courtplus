import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Alert, Card, CaseRecord, DashboardActivity, ScreeningResult } from '@courtplus/contracts';
import type { WorkspaceApi } from './api';
import { addDays, todayIST, useApp } from './context';
import { errMsg } from '../components/ui';

export interface DatedAlert {
  caseId: string;
  caseLabel: string;
  on: string;
  label: string;
  kind: string;
}
export interface WorkData {
  cases: CaseRecord[];
  cards: Card[];
  alerts: DatedAlert[];
  screeningFailures: number;
  activity: DashboardActivity | null;
  boardIncluded: boolean;
}

export function datedAlerts(cases: CaseRecord[], results: ScreeningResult[]): DatedAlert[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const entries: DatedAlert[] = [];
  for (const result of results) {
    const record = byId.get(result.caseId);
    if (!record) continue;
    const caseLabel = record.caseNo ?? record.cnr ?? record.id;
    if (result.thresholdDate && /^\d{4}-\d{2}-\d{2}$/.test(result.thresholdDate)) {
      entries.push({
        caseId: result.caseId, caseLabel, on: result.thresholdDate,
        label: result.status === 'DUE_IN_N_DAYS' ? 's.479 threshold due' : 's.479 threshold', kind: 'THRESHOLD',
      });
    }
    for (const alert of result.alerts) {
      if (!alert.dueOn || !/^\d{4}-\d{2}-\d{2}$/.test(alert.dueOn)) continue;
      entries.push({ caseId: result.caseId, caseLabel, on: alert.dueOn, label: alert.message, kind: alert.kind });
    }
  }
  return entries.sort((a, b) => a.on.localeCompare(b.on) || a.caseLabel.localeCompare(b.caseLabel));
}

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

function oneMonthAfter(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

const upcomingLabels: Partial<Record<Alert['kind'], string>> = {
  POST_BAIL_7_DAYS: 'Post-bail 7-day check',
  POST_BAIL_1_MONTH: 'Post-bail 1-month review',
  DEFAULT_BAIL_CHECK: 'Default-bail expiry check',
  NO_COURT_UPDATE_180: '180-day court update check',
};

async function loadCaseDeadlines(api: WorkspaceApi, record: CaseRecord, asOf: string) {
  const current = await api.screen(record.id, asOf);
  const candidates = new Map<string, Alert['kind'][]>();
  function checkOn(on: string, kind: Alert['kind']) {
    if (on > asOf) candidates.set(on, [...(candidates.get(on) ?? []), kind]);
  }
  const grant = current.trace.find(step => step.id === 'follow-up')?.inputs.grantDate;
  if (isDate(grant)) {
    checkOn(addDays(grant, 7), 'POST_BAIL_7_DAYS');
    checkOn(oneMonthAfter(grant), 'POST_BAIL_1_MONTH');
  }
  const lastUpdate = [...record.events.map(event => event.on), record.firstRemandOn, record.chargesheetOn,
    record.bailGrantedOn, record.releasedOn].filter(isDate).filter(on => on <= asOf).sort().at(-1);
  if (lastUpdate) checkOn(addDays(lastUpdate, 180), 'NO_COURT_UPDATE_180');
  const reviewDates = current.trace.find(step => step.id === 'default-bail')?.inputs.firstReviewDates;
  if (Array.isArray(reviewDates) && reviewDates.length === 1 && isDate(reviewDates[0])) {
    checkOn(reviewDates[0], 'DEFAULT_BAIL_CHECK');
  }

  // Let screening determine whether the check applies on each recorded milestone.
  const checked = await Promise.allSettled(Array.from(candidates, async ([on, kinds]) => {
    const result = await api.screen(record.id, on);
    return result.alerts.filter(alert => alert.dueOn === on && kinds.includes(alert.kind) &&
      !current.alerts.some(earlier => earlier.kind === alert.kind && earlier.dueOn === on))
      .map(alert => ({ ...alert, message: upcomingLabels[alert.kind] ?? alert.message }));
  }));
  const upcoming = checked.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  return { result: { ...current, alerts: [...current.alerts, ...upcoming] }, partial: checked.some(item => item.status === 'rejected') };
}

function useLoadWorkData(enabled: boolean, includeBoard: boolean, revision: string) {
  const { api } = useApp();
  const [data, setData] = useState<WorkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const asOf = todayIST();
    const load = async () => {
      try {
        const cases = await api.listCases();
        const [cards, activity, settled] = await Promise.all([
          includeBoard ? api.board(asOf) : [],
          includeBoard ? api.dashboardActivity?.().catch(() => null) : null,
          Promise.allSettled(cases.map(record => loadCaseDeadlines(api, record, asOf))),
        ]);
        const results = settled.flatMap(item => item.status === 'fulfilled' ? [item.value.result] : []);
        const screeningFailures = settled.filter(item => item.status === 'rejected' || item.value.partial).length;
        if (live) {
          setData({ cases, cards, activity: activity ?? null, alerts: datedAlerts(cases, results), screeningFailures, boardIncluded: includeBoard });
          setError(null);
        }
      } catch (e) {
        if (live) { setData(null); setError(errMsg(e)); }
      }
    };
    void load();
    return () => { live = false; };
  }, [api, enabled, includeBoard, revision]);
  return { data, error };
}

const WorkContext = createContext<ReturnType<typeof useLoadWorkData> | null>(null);

export function WorkDataProvider({ page, children }: { page: string; children: ReactNode }) {
  const value = useLoadWorkData(true, page === '/', page);
  return createElement(WorkContext.Provider, { value }, children);
}

export function useWorkData() {
  const shared = useContext(WorkContext);
  const standalone = useLoadWorkData(shared === null, true, '');
  return shared ?? standalone;
}
