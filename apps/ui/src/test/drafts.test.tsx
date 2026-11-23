import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CaseRecord, CourtPlusApi, Status } from '@courtplus/contracts';
import { AppProvider } from '../lib/context';
import { Drafts } from '../screens/Drafts';

// Fictional test fixtures only.
const rec = (id: string): CaseRecord => ({
  id, personId: 'p-' + id, orderDate: '2025-05-02', charges: [],
  custody: [{ kind: 'judicial', start: '2025-01-01', ongoing: true }], events: [], pendingStatus: 'trial',
});

function renderDrafts(status: Status) {
  const screenFn = vi.fn(async (caseId: string, asOf: string) => ({
    personId: 'p', caseId, asOf, ruleVersion: 't', dayConvention: 't', status,
    rawCustodyDays: 1, countedCustodyDays: 1, ceilingUrgent: false, reasons: [], alerts: [], nalsaCategories: [], trace: [],
  }) as never);
  const api = {
    listPersons: vi.fn(async () => []), listCases: vi.fn(async () => [rec('c-test')]), importOrder: vi.fn(),
    saveCase: vi.fn(), screen: screenFn, board: vi.fn(async () => []), updateCard: vi.fn(),
    exportDraft: vi.fn(), exportScReturn: vi.fn(), verify: vi.fn(), stats: vi.fn(), role: vi.fn(async () => 'legal_aid'),
  } as unknown as CourtPlusApi;
  render(<AppProvider api={api}><MemoryRouter><Drafts /></MemoryRouter></AppProvider>);
  return screenFn;
}

const options = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('Drafts s.479(3) offer', () => {
  it('hides the application and says why when the engine routes the case to review', async () => {
    const screenFn = renderDrafts('NEEDS_LAWYER_REVIEW');
    expect(await screen.findByTestId('s479-hidden')).toHaveTextContent('NEEDS LAWYER REVIEW');
    expect(screenFn).toHaveBeenCalledWith('c-test', '2025-05-02');
    expect(options()).not.toContain('Application under s.479(3)');
    expect(screen.getByLabelText('Draft type')).toHaveValue('DLSA_7_DAY');
  });

  it('offers the application only when the engine says APPLY_NOW', async () => {
    renderDrafts('APPLY_NOW');
    await waitFor(() => expect(options()).toContain('Application under s.479(3)'));
    expect(screen.queryByTestId('s479-hidden')).toBeNull();
  });
});
