import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Card, CaseRecord, CourtPlusApi, ScreeningResult } from '@courtplus/contracts';
import { addDays, AppProvider, todayIST } from '../lib/context';
import type { WorkspaceApi } from '../lib/api';
import { App } from '../App';
import { datedAlerts } from '../lib/deadlines';
import { Dashboard } from '../screens/Dashboard';
import { DeadlineCalendar } from '../screens/DeadlineCalendar';

// Fictional data used only in tests.
const record: CaseRecord = { id: 'fictional-case', personId: 'fictional-person', caseNo: 'FICTIONAL-1', charges: [], custody: [], events: [], pendingStatus: 'trial' };
const asOf = todayIST();
const dueOn = `${asOf.slice(0, 7)}-15`;
const result: ScreeningResult = {
  personId: record.personId, caseId: record.id, asOf, ruleVersion: 'test', dayConvention: 'test',
  status: 'DUE_IN_N_DAYS', thresholdDate: dueOn, rawCustodyDays: 1, countedCustodyDays: 1,
  ceilingUrgent: false, reasons: [], alerts: [{ kind: 'POST_BAIL_7_DAYS', message: 'Fictional 7-day check', dueOn }],
  nalsaCategories: [], trace: [],
};
function api(cases: CaseRecord[] = [record], cards: Card[] = []): WorkspaceApi {
  return {
    listCases: vi.fn(async () => cases), listPersons: vi.fn(async () => []), board: vi.fn(async () => cards),
    screen: vi.fn(async () => result), stats: vi.fn(async () => null),
    importOrder: vi.fn(), saveCase: vi.fn(), updateCard: vi.fn(), exportDraft: vi.fn(), exportScReturn: vi.fn(), verify: vi.fn(), role: vi.fn(),
  } as CourtPlusApi;
}
function show(ui: JSX.Element, mock = api()) {
  return render(<AppProvider api={mock}><MemoryRouter>{ui}</MemoryRouter></AppProvider>);
}
describe('release dashboard and calendar', () => {
  it('counts open board cards and shows sourced figures', async () => {
    const cards: Card[] = [
      { id: 'a', lane: 'APPLY_NOW', caseId: record.id, personId: record.personId, title: 'Fictional card', state: 'open', tags: [] },
      { id: 'b', lane: 'APPLY_NOW', caseId: record.id, personId: record.personId, title: 'Closed card', state: 'closed', tags: [] },
    ];
    show(<Dashboard />, api([record], cards));
    expect(await screen.findByRole('link', { name: 'Apply now: 1' })).toBeInTheDocument();
    expect(screen.getByText('127.6%')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /NCRB, Prison Statistics India 2024.*Table 1.2$/ })).toBeInTheDocument();
  });
  it('shows a useful empty state when no cases are saved', async () => {
    show(<Dashboard />, api([], []));
    expect(await screen.findByText('No cases saved yet')).toBeInTheDocument();
    expect(screen.getByText('Import orders to see your trend')).toBeInTheDocument();
  });
  it('shows eight weeks of dated saves and deduplicated case resolutions', async () => {
    const mock = api([record, { ...record, id: 'fictional-second' }]);
    mock.dashboardActivity = vi.fn(async () => ({
      savedCases: [{ caseId: record.id, on: addDays(asOf, -7) }, { caseId: 'fictional-second', on: asOf }],
      closedCards: [
        { cardId: 'fictional-a', caseId: record.id, on: asOf },
        { cardId: 'fictional-b', caseId: record.id, on: asOf },
      ],
    }));
    show(<Dashboard />, mock);
    const chart = await screen.findByRole('region', { name: 'Cases filed vs resolved' });
    await userEvent.click(within(chart).getByText('Weekly figures'));
    const rows = within(chart).getAllByRole('row');
    expect(rows).toHaveLength(9);
    expect(within(rows[7]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0']);
    expect(within(rows[8]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '1']);
    expect(within(chart).getByText('Cases saved changed by 0% from the previous week.')).toBeVisible();
  });
  it('counts dated alerts from today through seven days ahead and opens the calendar', async () => {
    const mock = api();
    mock.screen = vi.fn<WorkspaceApi['screen']>(async () => ({
      ...result, thresholdDate: addDays(asOf, 7),
      alerts: [
        { kind: 'POST_BAIL_7_DAYS', message: 'Fictional check today', dueOn: asOf },
        { kind: 'DEFAULT_BAIL_CHECK', message: 'Fictional past review', dueOn: addDays(asOf, -1) },
        { kind: 'POST_BAIL_1_MONTH', message: 'Fictional later check', dueOn: addDays(asOf, 8) },
      ],
    }));
    show(<App />, mock);
    const bell = await screen.findByRole('link', { name: '2 deadlines due in the next 7 days' });
    await userEvent.click(bell);
    expect(await screen.findByRole('heading', { name: 'Deadline Calendar' })).toBeVisible();
  });
  it('uses engine-confirmed future dates and leaves unsupported milestones out of the bell', async () => {
    const mock = api();
    const grant = addDays(asOf, -6);
    const postBail = addDays(grant, 7);
    mock.screen = vi.fn<WorkspaceApi['screen']>(async (_, on) => ({
      ...result, thresholdDate: undefined,
      trace: [{ id: 'follow-up', label: '', operation: '', result: '', inputs: { grantDate: grant } }],
      alerts: on === postBail ? [{ kind: 'POST_BAIL_7_DAYS', message: 'Fictional post-bail date', dueOn: on }] : [],
    }));
    show(<App />, mock);
    expect(await screen.findByRole('link', { name: '1 deadline due in the next 7 days' })).toBeVisible();
    expect(mock.screen).toHaveBeenCalledWith(record.id, postBail);
  });
  it('keeps the month grid visible with no saved cases', async () => {
    show(<DeadlineCalendar />, api([], []));
    expect(await screen.findByRole('region', { name: 'Month view' })).toBeInTheDocument();
    expect(screen.getByText('No cases saved yet')).toBeInTheDocument();
  });
  it('marks partial dates when screening fails', async () => {
    const mock = api();
    mock.screen = vi.fn(async () => { throw new Error('screening failed'); });
    show(<DeadlineCalendar />, mock);
    expect(await screen.findByText(/Screening unavailable for 1 saved case/)).toBeInTheDocument();
  });
  it('uses only deterministic dated engine fields and links them to the case', async () => {
    expect(datedAlerts([record], [result])).toHaveLength(2);
    show(<DeadlineCalendar />);
    expect(await screen.findByRole('heading', { name: 'Dated alerts' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'FICTIONAL-1' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Fictional 7-day check')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText(/No dated alerts in/)).toBeInTheDocument();
  });
});
