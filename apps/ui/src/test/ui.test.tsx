import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Card, CaseRecord, CourtPlusApi, Person } from '@courtplus/contracts';
import { AppProvider } from '../lib/context';
import { Board } from '../screens/Board';
import { CaseView } from '../screens/CaseView';
import { ImportOrder } from '../screens/ImportOrder';

// Fictional test fixtures only.
const mockApi = (over: Partial<CourtPlusApi>): CourtPlusApi => ({
  listPersons: vi.fn(async () => []), listCases: vi.fn(async () => []), importOrder: vi.fn(),
  saveCase: vi.fn(), screen: vi.fn(), board: vi.fn(async () => []), updateCard: vi.fn(),
  exportDraft: vi.fn(), exportScReturn: vi.fn(), verify: vi.fn(), stats: vi.fn(), role: vi.fn(),
  ...over,
} as CourtPlusApi);

const wrap = (api: CourtPlusApi, ui: JSX.Element, path = '/') =>
  render(<AppProvider api={api}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></AppProvider>);

const card = (id: string, lane: Card['lane']): Card =>
  ({ id, lane, personId: 'p1', caseId: 'c1', title: `Test card ${id}`, state: 'open', tags: ['NALSA 3'] });

describe('Action board', () => {
  it('shows an empty state with no cards', async () => {
    wrap(mockApi({}), <Board />);
    expect(await screen.findByText(/Import a court order to begin/)).toBeInTheDocument();
  });

  it('puts cards in their lanes and computes days-to-clear from the cap', async () => {
    const cards = [card('1', 'APPLY_NOW'), ...['a', 'b', 'c', 'd', 'e'].map((i) => card(i, 'NO_UPDATE_180'))];
    wrap(mockApi({ board: vi.fn(async () => cards) }), <Board />);
    const apply = await screen.findByRole('region', { name: 'Apply now' });
    expect(apply).toHaveTextContent('Test card 1');
    expect(screen.getAllByRole('region').filter((r) => r.tagName === 'SECTION' && r.getAttribute('aria-label')?.match(/Apply|Due|lawyer|Bail|disagree|180/))).toHaveLength(6);
    const cap = screen.getByLabelText(/Daily cap/);
    expect(screen.getByTestId('days-to-clear')).toHaveTextContent('Days to clear: 1');
    fireEvent.change(cap, { target: { value: '2' } });
    expect(screen.getByTestId('days-to-clear')).toHaveTextContent('Days to clear: 3');
  });
});

describe('Case what-if slider', () => {
  it('calls screen() again with the new as-of date', async () => {
    const person = { id: 'p1', alias: 'Accused-TEST', prisonerType: 'undertrial', priorConviction: 'no', otherHolds: 'no', caseIds: ['c1'] } as Person;
    const rec = { id: 'c1', personId: 'p1', charges: [], custody: [{ kind: 'judicial', start: '2024-01-01' }], events: [], pendingStatus: 'trial' } as CaseRecord;
    const screenFn = vi.fn(async (_id: string, asOf: string) => ({
      personId: 'p1', caseId: 'c1', asOf, ruleVersion: 't', dayConvention: 't', status: 'OUTSIDE_SCREEN',
      rawCustodyDays: 1, countedCustodyDays: 1, ceilingUrgent: false, reasons: [], alerts: [], nalsaCategories: [], trace: [],
    }) as never);
    const api = mockApi({ listCases: vi.fn(async () => [rec]), listPersons: vi.fn(async () => [person]), screen: screenFn });
    wrap(api, <Routes><Route path="/case/:caseId" element={<CaseView />} /></Routes>, '/case/c1');
    const slider = await screen.findByLabelText(/What if we look/);
    await waitFor(() => expect(screenFn).toHaveBeenCalledTimes(1));
    fireEvent.change(slider, { target: { value: '10' } });
    await waitFor(() => expect(screenFn).toHaveBeenLastCalledWith('c1', '2024-01-11'));
    expect(screen.getByTestId('asof-value')).toHaveTextContent('2024-01-11');
  });
});

describe('Import confirm / reject', () => {
  it('confirms and rejects suggestions with their source sentence shown', async () => {
    const importOrder = vi.fn(async () => ({
      docId: 'd', text: 'Test order dated 01-02-2024.', pages: 1, ocr: false, entities: [], redactedText: '',
      suggestions: [
        { field: 'orderDate', value: '2024-02-01', sentence: 'Test order dated 01-02-2024.', confidence: 0.9 },
        { field: 'court', value: 'Test Court', sentence: 'Before Test Court.', confidence: 0.6 },
      ],
    }));
    wrap(mockApi({ importOrder }), <ImportOrder />);
    const file = new File([new Uint8Array([1, 2])], 'order.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/Choose PDF or image/), file);
    const s0 = await screen.findByTestId('suggestion-0');
    expect(s0).toHaveTextContent('Test order dated 01-02-2024.');
    expect(screen.getByText(/AI helped read this order/)).toBeInTheDocument();
    await userEvent.click(s0.querySelector('button')!); // Confirm
    expect(s0).toHaveTextContent('Confirmed');
    const s1 = screen.getByTestId('suggestion-1');
    await userEvent.click([...s1.querySelectorAll('button')].find((b) => b.textContent === 'Reject')!);
    expect(s1).toHaveTextContent('Rejected');
  });
});
