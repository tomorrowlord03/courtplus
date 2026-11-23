import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CaseRecord, CourtPlusApi, Status } from '@courtplus/contracts';
import { AppProvider } from '../lib/context';
import { Drafts } from '../screens/Drafts';

vi.mock('../../../../data/i18n/hi.json', () => ({ default: { _meta: { reviewed: false } } }));

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
    expect(screen.getByLabelText('Draft type')).toHaveValue('AI_ASSISTANCE_NOTE');
  });

  it('offers the application only when the engine says APPLY_NOW', async () => {
    renderDrafts('APPLY_NOW');
    await waitFor(() => expect(options()).toContain('Application under s.479(3)'));
    expect(screen.queryByTestId('s479-hidden')).toBeNull();
  });

  it('hides unreviewed Hindi for legal drafts and keeps it available on the rights card', async () => {
    renderDrafts('APPLY_NOW');
    await waitFor(() => expect(options()).toContain('Application under s.479(3)'));
    for (const kind of ['S479_3_APPLICATION', 'DLSA_7_DAY', 'AI_ASSISTANCE_NOTE']) {
      await userEvent.selectOptions(screen.getByLabelText('Draft type'), kind);
      expect(options()).not.toContain('हिन्दी (Hindi)');
    }
    await userEvent.selectOptions(screen.getByLabelText('Draft type'), 'RIGHTS_CARD');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(screen.getByText(/Machine translation, not legally reviewed/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Draft type'), 'AI_ASSISTANCE_NOTE');
    expect(screen.getByLabelText('Language')).toHaveValue('en');
  });
});
