import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CaseTier, CourtWorkspace, CourtWorkspaceApi, TriageRank } from '@courtplus/contracts';
import { Triage } from '../screens/Triage';
import { loadLang } from '../lib/i18n';

vi.mock('../lib/context', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/context')>(),
  useApp: () => ({ profile: { role: 'judge' } }),
}));

function row(id: string, tier: CaseTier): TriageRank {
  return {
    meta: {
      caseId: id, caseType: 'civil', filedOn: '2026-01-01', stage: 'Fictional hearing',
      partyFlags: [], partiesInCustody: false, nationalSecurity: tier.level === 1,
    },
    tier, score: 0, factors: [],
  };
}

const niaUrl = 'https://www.indiacode.nic.in/indiacode/handle/123456789/2054';
const ranked = [
  row('fictional-urgent', { level: 1, label: 'Liberty / custody', triggers: [{
    rule: 'Case flagged as a special-statute trial (NIA Act / UAPA)',
    source: { act: 'National Investigation Agency Act, 2008', section: '19', text: 'Trial precedence', url: niaUrl },
  }] }),
  row('fictional-regular', { level: 3, label: 'Regular', triggers: [] }),
  row('fictional-second-regular', { level: 3, label: 'Regular', triggers: [] }),
];

function show(rows = ranked) {
  const courtWorkspace = vi.fn<CourtWorkspaceApi['courtWorkspace']>(async date => ({
    ranked: rows,
    settings: { capacity: 40, minimumPreparationDays: 7, oldestShare: 25 },
    cases: rows.map(({ meta }) => ({
      id: meta.caseId, label: meta.caseId, disposed: false, adjournments: [], orderDates: [],
    })),
    metadata: rows.map(({ meta }) => meta),
    hearings: [],
    causeList: { date, capacity: 40, entries: [], confirmed: false },
    backlog: { weeks: [], age: [] },
  } satisfies CourtWorkspace));
  vi.stubGlobal('courtplusJudge', { courtWorkspace });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Triage /></MemoryRouter>);
  return courtWorkspace;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await loadLang('en');
});

describe('triage priority tiers', () => {
  it('links an s.479 trigger to the case proof trace', async () => {
    show([row('fictional-479', { level: 1, label: 'Liberty / custody', triggers: [{
      rule: 'BNSS s.479: Apply now (checked 2026-11-23)',
      source: { act: 'Bharatiya Nagarik Suraksha Sanhita, 2023', section: '479', text: 'Detention limit', url: niaUrl },
    }] })]);
    await userEvent.setup().click(await screen.findByText('Why this tier'));
    const proof = screen.getByRole('link', { name: 'View s.479 proof trace' });
    expect(proof.closest('li')).toHaveTextContent('BNSS s.479: Apply now (checked 2026-11-23)');
    expect(proof).toHaveAttribute('href', '/case/fictional-479');
  });
  it('shows tier badges, filters by counts and explains the tier with a linked source', async () => {
    const courtWorkspace = show();
    const user = userEvent.setup();
    const chips = within(await screen.findByRole('group', { name: 'Filter by priority tier' }));
    expect(chips.getByRole('button', { name: 'Tier 2 (0)' })).toBeVisible();
    expect(chips.getByRole('button', { name: 'Tier 3 (2)' })).toBeVisible();
    expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Rule-based priority - not AI, not a judgement about any person. The judge decides.')).toBeVisible();

    await user.click(chips.getByRole('button', { name: 'Tier 1 (1)' }));
    const badge = screen.getByText('Tier 1 — Liberty / custody');
    expect(badge).toBeVisible();
    expect(badge.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('Tier 3 — Regular')).not.toBeInTheDocument();
    await user.click(screen.getByText('Why this tier'));
    expect(screen.getByText('Case flagged as a special-statute trial (NIA Act / UAPA)')).toBeVisible();
    expect(screen.getByText('Tiers order the list from recorded case facts. They do not decide any legal right.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: /\/100/ })).not.toBeInTheDocument();
    await user.click(screen.getByText('Factor reasons and sources'));
    expect(screen.getByText('Ordering aid (not a tier): 0/100')).toBeVisible();
    expect(screen.getByRole('link', { name: 'National Investigation Agency Act, 2008 19' })).toHaveAttribute('href', niaUrl);

    await user.click(screen.getByRole('button', { name: 'Judge override' }));
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    expect(courtWorkspace.mock.calls.map(([, action]) => action.kind)).toEqual(['read']);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Fictional scheduling reason');
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    expect(courtWorkspace).toHaveBeenLastCalledWith(expect.any(String), {
      kind: 'override', override: { caseId: 'fictional-urgent', direction: 'up', reason: 'Fictional scheduling reason' },
    });

    await user.click(chips.getByRole('button', { name: 'Tier 3 (2)' }));
    expect(screen.getAllByText('Tier 3 — Regular')).toHaveLength(2);
    await user.click(screen.getAllByText('Why this tier')[0]);
    expect(screen.getAllByText('No priority trigger recorded')[0]).toBeVisible();
    await user.click(chips.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Tier 1 — Liberty / custody')).toBeVisible();
  });

  it('localizes the tier controls and explanation in Hindi', async () => {
    await loadLang('hi');
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'स्तर 1 (1)' }));
    expect(screen.getByText('स्तर 1 — स्वतंत्रता / हिरासत')).toBeVisible();
    await user.click(screen.getByText('यह स्तर क्यों'));
    expect(screen.getByText('मामला विशेष अधिनियम के तहत विचारण के रूप में दर्ज है (एनआईए अधिनियम / यूएपीए)')).toBeVisible();
  });
});
