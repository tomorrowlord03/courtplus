import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Card, CaseRecord, CourtPlusApi, Person, ScreeningResult } from '@courtplus/contracts';
import { AppProvider, daysBetween, todayIST } from '../lib/context';
import { Board } from '../screens/Board';
import { CaseList, CaseView } from '../screens/CaseView';
import { ImportOrder } from '../screens/ImportOrder';
import { Drafts } from '../screens/Drafts';
import { Verifier } from '../screens/Verifier';
import { App } from '../App';

vi.mock('../screens/Stats', () => {
  throw new Error('Fictional route chunk failed to load');
});

// Fictional test fixtures only.
const mockApi = (over: Partial<CourtPlusApi>): CourtPlusApi => ({
  listPersons: vi.fn(async () => []), listCases: vi.fn(async () => []), importOrder: vi.fn(),
  saveCase: vi.fn(), screen: vi.fn(), board: vi.fn(async () => []), updateCard: vi.fn(),
  exportDraft: vi.fn(), exportScReturn: vi.fn(), verify: vi.fn(), stats: vi.fn(), role: vi.fn(),
  judgeDashboard: vi.fn(async () => ({
    asOf: '2026-03-01', totalJudges: 2, totalActiveCases: 1, totalDisposedCases: 10, benchClearanceRate: 90.9,
    stateNjdg10YearComparison: { district10YearPending: 5256293, chhattisgarh10YearPending: 1166, ratioToNational: 0.02 },
    judges: [{
      judgeName: 'Fictional Judge A', courtRoom: 'Room 1', court: 'Fictional Sessions Court',
      activeCases: 0, disposedCases: 10, totalFiled: 10, clearanceRate: 100, disposalVelocity: 8,
      avgCaseLifespanDays: 95, totalAdjournmentsGranted: 4, adjournmentRatio: 0.4,
      aging: { under1Year: 0, oneToThreeYears: 0, threeToFiveYears: 0, fiveToTenYears: 0, overTenYears: 0 },
      timeline: [{ date: '2026-02-01', filed: 10, disposed: 10, clearanceRate: 100 }],
      weeks: [{ start: '2026-01-26', filed: 10, disposed: 10 }],
      byCaseType: { criminal: { pending: 0, disposed: 10 } },
    }, {
      judgeName: 'Fictional Judge B',
      activeCases: 1, disposedCases: 0, totalFiled: 1, clearanceRate: 0, disposalVelocity: 0,
      avgCaseLifespanDays: 420, totalAdjournmentsGranted: 0, adjournmentRatio: 0,
      aging: { under1Year: 0, oneToThreeYears: 1, threeToFiveYears: 0, fiveToTenYears: 0, overTenYears: 0 },
      timeline: [], weeks: [], byCaseType: { criminal: { pending: 1, disposed: 0 } },
    }],
  })),
  ...over,
} as CourtPlusApi);

const wrap = (api: CourtPlusApi, ui: JSX.Element, path = '/') =>
  render(<AppProvider api={api}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></AppProvider>);

const card = (id: string, lane: Card['lane']): Card =>
  ({ id, lane, personId: 'p1', caseId: 'c1', title: `Test card ${id}`, state: 'open', tags: ['NALSA 3'] });

describe('Route loading', () => {
  it('keeps the sidebar available and recovers on navigation after a lazy import fails', async () => {
    wrap(mockApi({}), <App />, '/stats');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this screen.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Primary navigation' });
    await userEvent.click(within(sidebar).getByRole('link', { name: 'See cases that need action' }));

    expect(await screen.findByText(/Import a court order to begin/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

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

describe('Cases list', () => {
  it('shows an actionable card with the alias, charge, result and reason without exposing internal IDs', async () => {
    const record: CaseRecord = {
      id: '00000000-0000-4000-8000-000000000043', personId: 'fictional-person-43', court: 'Fictional District Court',
      charges: [{ act: 'BNS', section: '318(4)', stage: 'FRAMED', verified: true }],
      custody: [{ kind: 'judicial', start: '2026-02-21', ongoing: true }], events: [], pendingStatus: 'trial',
    };
    const person: Person = {
      id: record.personId, alias: 'Accused-TEST-43', prisonerType: 'undertrial', priorConviction: 'no', otherHolds: 'no', caseIds: [record.id],
    };
    const due: CaseRecord = { ...record, id: 'fictional-due', caseNo: 'FICTIONAL/43/2', personId: 'fictional-due-person', court: 'Fictional Sessions Court' };
    const asOf = todayIST();
    const rawCustodyDays = daysBetween(record.custody[0].start, asOf) + 1;
    wrap(mockApi({
      listCases: async () => [due, record],
      listPersons: async () => [person, { ...person, id: due.personId, alias: 'Accused-TEST-44', caseIds: [due.id] }],
      screen: async (caseId, date) => ({
        personId: caseId === record.id ? person.id : due.personId, caseId, asOf: date, ruleVersion: 'fixture', dayConvention: 'fixture',
        status: caseId === record.id ? 'NEEDS_LAWYER_REVIEW' : 'DUE_IN_N_DAYS', dueInDays: caseId === due.id ? 6 : undefined,
        rawCustodyDays, countedCustodyDays: rawCustodyDays, ceilingUrgent: false, alerts: [], nalsaCategories: [],
        reasons: caseId === record.id ? ['Pending offences or cases require review under BNSS s.479(2).'] : [],
        trace: [
          { id: 'custody', label: 'Custody accounting', inputs: { firstCustody: '2026-02-21' }, operation: '', result: '' },
          { id: 'follow-up', label: 'Court and jail records', inputs: { inCustody: true }, operation: '', result: '' },
        ],
      }),
    }), <CaseList />, '/cases');

    const [first, second] = await screen.findAllByRole('article');
    expect(within(first).getByRole('link', { name: person.alias })).toHaveAttribute('href', `/case/${record.id}`);
    expect(first).toHaveTextContent('Fictional District Court');
    expect(first).toHaveTextContent(/BNS 318\(4\) - Cheating/);
    expect(first).toHaveTextContent('▲Needs a lawyer');
    expect(first).toHaveTextContent('More than one offence or pending case - a lawyer must check (BNSS s.479(2)).');
    expect(first).toHaveTextContent(`In custody since 21 Feb 2026 - ${rawCustodyDays} days`);
    expect(second).toHaveTextContent('Due in 6 days');
    expect(second).toHaveTextContent(due.caseNo!);
    expect(document.body.textContent).not.toContain(record.id);
    expect(document.body.textContent).not.toContain(person.id);

    const search = screen.getByRole('searchbox', { name: 'Search cases' });
    await userEvent.type(search, '318(4) sessions');
    expect(screen.getAllByRole('article')).toEqual([second]);
    await userEvent.clear(search);
    await userEvent.click(screen.getByRole('button', { name: 'Needs a lawyer' }));
    expect(screen.getAllByRole('article')).toEqual([first]);
  });

  it('offers to import an order when the store is empty', async () => {
    wrap(mockApi({}), <CaseList />, '/cases');
    const empty = await screen.findByText('No cases yet');
    expect(empty.parentElement).toHaveTextContent('Import an order');
    expect(screen.getByRole('link', { name: 'Import order' })).toHaveAttribute('href', '/import');
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
    expect(screen.getByTestId('asof-value')).toHaveTextContent('11 Jan 2024');
  });

  it('shows the order-date screening result and proof trace, then returns to today', async () => {
    const record: CaseRecord = {
      id: 'c1', personId: 'p1', orderDate: '2023-12-31', charges: [],
      custody: [{ kind: 'judicial', start: '2024-01-01' }], events: [], pendingStatus: 'trial',
    };
    const screenFn = vi.fn(async (caseId: string, asOf: string): Promise<ScreeningResult> => ({
      personId: 'p1', caseId, asOf, ruleVersion: 't', dayConvention: 't',
      status: asOf === record.orderDate ? 'NEEDS_LAWYER_REVIEW' : 'OUTSIDE_SCREEN',
      rawCustodyDays: 0, countedCustodyDays: 0, ceilingUrgent: false, reasons: [], alerts: [], nalsaCategories: [],
      trace: [{ id: 'date', label: 'Fictional screening date', inputs: {}, operation: 'as of', result: asOf }],
    }));
    wrap(mockApi({ listCases: async () => [record], screen: screenFn }),
      <Routes><Route path="/case/:caseId" element={<CaseView />} /></Routes>, '/case/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'As of order date' }));
    expect(screenFn).toHaveBeenLastCalledWith(record.id, record.orderDate);
    expect(screen.getByTestId('asof-value')).toHaveTextContent('31 Dec 2023');
    expect(screen.getByRole('slider')).toHaveValue('0');
    expect(await screen.findByText('Needs a lawyer')).toBeInTheDocument();
    const proof = screen.getByText('How we checked (proof trace)').closest('details');
    expect(proof).not.toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'See how we checked' }));
    expect(proof).toHaveAttribute('open');
    expect(screen.getByRole('region', { name: 'Proof trace' })).toHaveTextContent('as of = 2023-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(screenFn).toHaveBeenLastCalledWith(record.id, todayIST());
    expect(await screen.findByText('Outside this check')).toBeInTheDocument();
  });
});

it('opens Drafts for the case in the link and exports the default AI assistance note', async () => {
  const first: CaseRecord = {
    id: 'fictional-first', personId: 'p1', bailGrantedOn: '2024-03-01', charges: [], custody: [], events: [], pendingStatus: 'trial',
  };
  const second = { ...first, id: 'fictional&B', orderDate: '2024-04-01', bailGrantedOn: undefined };
  const exportDraft = vi.fn(async () => ({ pdfPath: 'fixture.pdf', receiptPath: 'fixture.json', manifestPath: 'fixture.manifest.json' }));
  const api = mockApi({
    listCases: async () => [first, second], exportDraft,
    screen: async (caseId, asOf) => ({
      personId: 'p1', caseId, asOf, ruleVersion: 't', dayConvention: 't', status: 'NEEDS_LAWYER_REVIEW',
      rawCustodyDays: 0, countedCustodyDays: 0, ceilingUrgent: false, reasons: [], alerts: [], nalsaCategories: [], trace: [],
    }),
  });
  wrap(api, <Routes>
    <Route path="/case/:caseId" element={<CaseView />} />
    <Route path="/drafts" element={<Drafts />} />
  </Routes>, '/case/fictional%26B');
  await userEvent.click(await screen.findByText('Documents'));
  await userEvent.click(await screen.findByRole('link', { name: 'Prepare drafts for this case' }));
  expect(await screen.findByTestId('s479-hidden')).toHaveTextContent('NEEDS LAWYER REVIEW');
  expect(screen.getByLabelText('Case')).toHaveValue(second.id);
  expect(screen.getByLabelText('Draft type')).toHaveValue('AI_ASSISTANCE_NOTE');
  await userEvent.click(screen.getByRole('button', { name: 'Export signed PDF' }));
  expect(exportDraft).toHaveBeenCalledExactlyOnceWith('AI_ASSISTANCE_NOTE', second.id, 'en');
  expect(await screen.findByText('Signed PDF ready')).toBeInTheDocument();
});

it('shows verdicts for the signed and edited PDF with a neutral unchecked audit chain', async () => {
  const verify: CourtPlusApi['verify'] = async ({ pdf }) => ({
    signature: 'valid', pdf: pdf[0] === 1 ? 'unchanged' : 'changed', chain: 'not_checked',
  });
  wrap(mockApi({ verify }), <Verifier />);
  const uploadPdf = (byte: number) => userEvent.upload(screen.getByLabelText(/^Signed PDF/),
    new File([new Uint8Array([byte, 2])], 'fixture.pdf', { type: 'application/pdf' }));
  const json = new File(['{}'], 'fixture.json', { type: 'application/json' });
  await uploadPdf(1);
  await userEvent.upload(screen.getByLabelText(/^Receipt file/), json);
  await userEvent.upload(screen.getByLabelText(/^Manifest file/), json);
  await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
  expect(await screen.findByText('Unchanged since signing')).toHaveClass('border-green-700');
  expect(screen.getByText('– Not checked').parentElement).toHaveClass('border-slate-300');
  expect(screen.getByRole('region', { name: 'Verification result' }).querySelector('.border-red-700')).toBeNull();
  await uploadPdf(0);
  await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
  expect(await screen.findByText('Changed after signing')).toHaveClass('border-red-700');
  expect(screen.getByText('✓ Signature matches')).toBeInTheDocument();
});

it('verifies an evidence file and receipt without a manifest and shows the signed metadata', async () => {
  const keyId = 'a'.repeat(64);
  const hash = 'b'.repeat(64);
  const verify = vi.fn(async () => ({
    signature: 'valid', pdf: 'unchanged', chain: 'not_checked',
    details: { type: 'Evidence receipt', keyId, time: '2026-01-02T03:04:05.000Z', hash },
  }) as const);
  wrap(mockApi({ verify }), <Verifier />);
  await userEvent.upload(screen.getByLabelText(/^Signed PDF/), new File(['fictional bytes'], 'fictional.webm', { type: 'audio/webm' }));
  await userEvent.upload(screen.getByLabelText(/^Receipt file/), new File(['fictional signed receipt'], 'fictional.json'));
  await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
  expect(await screen.findByText('Evidence receipt')).toBeInTheDocument();
  expect(screen.getByText('Evidence file')).toBeInTheDocument();
  for (const value of [keyId, hash, '2026-01-02T03:04:05.000Z']) expect(screen.getByText(value)).toBeInTheDocument();
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ receipt: 'fictional signed receipt', manifest: '{}' }));
});

it.each([
  { name: 'remote v2 algorithm verdicts and digests', legacy: false },
  { name: 'the Ed25519-only notice for a legacy receipt', legacy: true },
])('shows $name in the Verifier', async ({ legacy }) => {
  const hashes = { sha256: 'a'.repeat(64), sha3_256: 'b'.repeat(64) };
  const verify = async () => ({
    signature: 'valid', pdf: 'unchanged', chain: 'not_checked', legacy,
    signatures: { ed25519: true, mldsa65: !legacy },
    details: { type: 'Draft PDF', hash: hashes.sha256, sha3_256: legacy ? undefined : hashes.sha3_256 },
    ...(legacy ? {} : { hashes }),
  }) as const;
  wrap(mockApi({ verify }), <Verifier />);
  await userEvent.upload(screen.getByLabelText(/^Signed PDF/), new File(['fictional PDF'], 'fixture.pdf'));
  const json = new File(['{}'], 'fixture.json', { type: 'application/json' });
  await userEvent.upload(screen.getByLabelText(/^Receipt file/), json);
  await userEvent.upload(screen.getByLabelText(/^Manifest file/), json);
  await userEvent.click(screen.getByRole('button', { name: 'Check file' }));

  const verification = within(await screen.findByRole('region', { name: 'Verification result' }));
  expect(verification.getByText('Ed25519: ✓ Signature matches')).toBeInTheDocument();
  if (legacy) {
    expect(verification.getByText('Ed25519 only (older receipt)')).toBeInTheDocument();
    expect(verification.queryByText(/^ML-DSA-65/)).toBeNull();
  } else {
    expect(verification.getByText('ML-DSA-65 (FIPS 204): ✓ Signature matches')).toBeInTheDocument();
    expect(verification.getByText(hashes.sha256)).toBeInTheDocument();
    expect(verification.getByText(hashes.sha3_256)).toBeInTheDocument();
  }
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
    expect(screen.getByText(/The app suggested details from this order/)).toBeInTheDocument();
    await userEvent.click(s0.querySelector('button')!); // Confirm
    expect(s0).toHaveTextContent('Confirmed');
    const s1 = screen.getByTestId('suggestion-1');
    await userEvent.click([...s1.querySelectorAll('button')].find((b) => b.textContent === 'Reject')!);
    expect(s1).toHaveTextContent('Rejected');
  });
});

describe('Judge dashboard', () => {
  it('redirects the old route and renders one set of court metrics and sourced benchmarks', async () => {
    function Location() { return <output aria-label="Current path">{useLocation().pathname}</output>; }
    const api = mockApi({
      listCases: async () => [{ id: 'fictional-case', personId: 'fictional-person', charges: [], custody: [], events: [], pendingStatus: 'trial' }],
    });
    wrap(api, <><App /><Location /></>, '/judge-dashboard');
    expect(await screen.findByRole('heading', { name: 'Judge dashboard' }, { timeout: 3_000 })).toBeVisible();
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/$/);
    const navigation = screen.getByRole('navigation', { name: 'Main' });
    expect(within(navigation).getAllByRole('link', { name: /^Judge dashboard$/i })).toHaveLength(1);
    expect(navigation.querySelector('a[href="/judge-dashboard"]')).toBeNull();
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Filed and disposed per week' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Cases filed vs resolved' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Pending cases by age' })).toHaveLength(1);

    const sources = screen.getByRole('region', { name: 'Official backlog benchmarks' });
    expect(within(sources).getByText('52,56,293')).toBeInTheDocument();
    expect(within(sources).getByText('1,166')).toBeInTheDocument();
    expect(within(sources).getByText('District court cases pending 10+ years, Chhattisgarh').closest('li'))
      .toHaveTextContent('2026-03-27');

    await userEvent.selectOptions(screen.getByLabelText('Judge or bench'), 'Fictional Judge B');
    expect(screen.getByText('No confirmed filing or disposal dates in the last eight weeks.')).toBeVisible();
    const ageing = screen.getByRole('region', { name: 'Pending cases by age' });
    expect(within(ageing).getByText(/1–<3 years/, { selector: 'li' })).toHaveTextContent('1–<3 years · 1');
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-20' } });
    await waitFor(() => expect(api.judgeDashboard).toHaveBeenLastCalledWith('2026-02-20'));
  });

  it('shows sourced benchmarks even when there are no local cases', async () => {
    const api = mockApi({});
    wrap(api, <App />);
    expect(await screen.findByText('No case data recorded yet')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Official backlog benchmarks' })).toBeVisible();
    expect(screen.queryByText('Clearance rate')).not.toBeInTheDocument();
    expect(api.judgeDashboard).not.toHaveBeenCalled();
  });
});
