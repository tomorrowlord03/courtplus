import type { CaseRecord, DashboardActivity } from '@courtplus/contracts';
import { addDays, daysBetween } from './context';

const resolvedEvents = new Set(['released', 'acquitted', 'convicted']);

export function weeklyActivity(cases: CaseRecord[], activity: DashboardActivity | null, today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const currentWeek = addDays(today, -((weekday + 6) % 7));
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(currentWeek, -7 * (7 - i));
    const label = new Date(`${start}T00:00:00Z`).toLocaleDateString('en-IN', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    });
    return { start, label, filed: 0, resolved: 0 };
  });
  const weekOf = (on: string) => on <= today ? weeks[Math.floor(daysBetween(weeks[0].start, on) / 7)] : undefined;
  const caseIds = new Set(cases.map(record => record.id));
  for (const { caseId, on } of activity?.savedCases ?? []) {
    const week = weekOf(on);
    if (week && caseIds.has(caseId)) week.filed += 1;
  }

  const resolutions = new Map<string, string>();
  function recordResolution(caseId: string, on: string) {
    if (on > today) return;
    const original = resolutions.get(caseId);
    if (!original || on < original) resolutions.set(caseId, on);
  }
  for (const { caseId, on } of activity?.closedCards ?? []) {
    if (on && caseIds.has(caseId)) recordResolution(caseId, on);
  }
  for (const record of cases) {
    if (record.releasedOn) recordResolution(record.id, record.releasedOn);
    if (record.pendingStatus === 'disposed' && record.orderDate) recordResolution(record.id, record.orderDate);
    for (const event of record.events) {
      if (resolvedEvents.has(event.kind)) recordResolution(record.id, event.on);
    }
  }
  for (const on of resolutions.values()) {
    const week = weekOf(on);
    if (week) week.resolved += 1;
  }
  return weeks.filter(week => week.filed || week.resolved).length >= 2 ? weeks : [];
}
