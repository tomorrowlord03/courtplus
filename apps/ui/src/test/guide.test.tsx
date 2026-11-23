import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../lib/context';
import { createDevStub } from '../lib/api';
import { setRoleOverride } from '../lib/roles';
import { setCompanionEnabled } from '../components/companion/store';
import { Guide, type ScreenHelp } from '../components/guide/Guide';
import { searchGuide } from '../lib/guide-search';

const pair = (en: string) => ({ en, hi: `हिन्दी ${en}` });
const screens: ScreenHelp[] = [
  { id: 'home', route: '/', roles: ['judge'], name: pair('Home'), what: pair('See tasks'), when: pair('At start'), start: pair('Open the first card'), steps: [pair('Choose a task')] },
  { id: 'import', route: '/import', roles: ['judge'], name: pair('Import order'), what: pair('Import files'), when: pair('On receiving an order'), start: pair('Choose a file'), steps: [pair('Review fields')] },
  { id: 'cases', route: '/cases', roles: ['judge', 'lawyer'], name: pair('Cases'), what: pair('Review cases'), when: pair('After saving'), start: pair('Open a case'), steps: [pair('Check facts')] },
];
const mount = (path = '/') => render(<AppProvider api={createDevStub()}><MemoryRouter initialEntries={[path]}><Guide screens={screens} /></MemoryRouter></AppProvider>);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('courtplus.guide.started', 'yes');
  setRoleOverride('judge');
});
afterEach(() => {
  delete (window as unknown as { courtplus?: unknown }).courtplus;
  setRoleOverride(undefined);
  vi.useRealTimers();
});

describe('help guide', () => {
  it('starts the panel tour on the first launch with the companion off', () => {
    setCompanionEnabled(false);
    localStorage.removeItem('courtplus.guide.started');
    mount();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('See tasks');
    expect(localStorage.getItem('courtplus.guide.started')).toBe('yes');
  });

  it('does not auto-open the panel tour when the companion is on', () => {
    localStorage.removeItem('courtplus.guide.started');
    mount();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(localStorage.getItem('courtplus.guide.started')).toBe('yes');
  });

  it('opens with the keyboard and shows the current route entry', async () => {
    const user = userEvent.setup();
    mount('/import');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Need help?' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Import files');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Review fields');
  });

  it('advances through a tour and can skip it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Need help?' }));
    await user.click(screen.getByRole('tab', { name: 'Show me around' }));
    await user.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('See tasks');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Open the first card');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Import order');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(localStorage.getItem('courtplus.guide.tourDone.judge')).toBe('yes');
  });

  it('returns relevant local passages for common questions', () => {
    expect(searchGuide('How do I import an order?', 'en')[0].id).toBe('import');
    expect(searchGuide('What does Tier 1 mean?', 'en')[0].id).toBe('tier-one');
    expect(searchGuide('What is a receipt code?', 'en')[0].id).toBe('receipt-code');
  });

  it('uses the optional bridge and lists used passages', async () => {
    const user = userEvent.setup();
    const guideAsk = vi.fn(async () => ({ answer: 'Open Import order.', usedPassageIds: ['import'], mode: 'search' as const }));
    (window as unknown as { courtplus?: unknown }).courtplus = { guideAsk };
    mount('/import');
    await user.click(screen.getByRole('button', { name: 'Need help?' }));
    await user.click(screen.getByRole('tab', { name: 'Ask a question' }));
    await user.type(screen.getByLabelText('Your question'), 'How do I import an order?');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Open Import order.')).toBeInTheDocument();
    expect(guideAsk).toHaveBeenCalledWith(expect.objectContaining({ screenId: 'import', passages: expect.arrayContaining([expect.objectContaining({ id: 'import' })]) }));
    expect(screen.getByRole('link', { name: 'How do I import an order?' })).toBeInTheDocument();
  });

  it('only searches local passages with the companion off', async () => {
    const user = userEvent.setup();
    const guideAsk = vi.fn();
    (window as Window & { courtplus?: unknown }).courtplus = { guideAsk };
    setCompanionEnabled(false);
    mount('/import');
    await user.click(screen.getByRole('button', { name: 'Need help?' }));
    await user.click(screen.getByRole('tab', { name: 'Ask a question' }));
    await user.type(screen.getByLabelText('Your question'), 'How do I import an order?');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('heading', { name: 'How do I import an order?' })).toBeInTheDocument();
    expect(guideAsk).not.toHaveBeenCalled();
  });

  it('falls back to local passages on bridge rejection', async () => {
    const user = userEvent.setup();
    (window as unknown as { courtplus?: unknown }).courtplus = { guideAsk: vi.fn().mockRejectedValue(new Error('offline')) };
    mount('/import');
    await user.click(screen.getByRole('button', { name: 'Need help?' }));
    await user.click(screen.getByRole('tab', { name: 'Ask a question' }));
    await user.type(screen.getByLabelText('Your question'), 'How do I import an order?');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Open Import order, choose a document and review the extracted fields. Confirm the facts before saving a case.')).toBeInTheDocument();
  });

  it('falls back after the bridge timeout', async () => {
    const user = userEvent.setup();
    const guideAsk = vi.fn((_input: unknown) => new Promise(() => {}));
    (window as unknown as { courtplus?: unknown }).courtplus = { guideAsk };
    mount('/without-screen-help');
    await user.click(screen.getByRole('button', { name: 'Need help?' }));
    await user.click(screen.getByRole('tab', { name: 'Ask a question' }));
    await user.type(screen.getByLabelText('Your question'), 'receipt code');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('status')).toHaveTextContent('Thinking');
    expect(guideAsk).toHaveBeenCalledTimes(1);
    expect(guideAsk.mock.lastCall).toHaveLength(1);
    expect(guideAsk.mock.lastCall?.[0]).not.toHaveProperty('screenId');
    await act(async () => { await vi.advanceTimersByTimeAsync(25000); });
    expect(screen.getByText(/A receipt code identifies your submission/)).toBeInTheDocument();
  });
});
