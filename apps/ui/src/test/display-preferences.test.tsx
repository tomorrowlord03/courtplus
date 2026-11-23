import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { createDevStub } from '../lib/api';
import { AppProvider } from '../lib/context';
import { isReviewedLanguage } from '../lib/i18n';
import { setRoleOverride } from '../lib/roles';

const appStyles = readFileSync('src/index.css', 'utf8');
const cloudStyles = readFileSync('../appliance/web/cloud.css', 'utf8');

function luminance(color: string): number {
  const hex = color.slice(1);
  const rgb = (hex.length === 3 ? [...hex].map(digit => digit.repeat(2)) : hex.match(/../g)!).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function palette(style: string) {
  const match = /:root\s*\{([^}]+)\}/.exec(style)!;
  return Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)]
    .map(([, key, value]) => [key, value]));
}

function expectContrast(colors: Record<string, string>, pairs: readonly (readonly [string, string])[]) {
  for (const [text, background] of pairs) {
    const a = luminance(colors[text]);
    const b = luminance(colors[background]);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
}

const api = {
  ...createDevStub(),
  listCases: async () => [{
    id: 'fictional-case', personId: 'fictional-person', caseNo: 'FICTIONAL 7/2026',
    charges: [], custody: [], pendingStatus: 'trial' as const,
    events: [{ on: '2026-01-01', kind: 'hearing' as const, note: 'Board' }],
  }],
};

const portal = (path: string) => render(
  <AppProvider api={api}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></AppProvider>,
);

beforeEach(() => {
  localStorage.clear();
  setRoleOverride('citizen');
});

afterEach(() => {
  localStorage.clear();
  setRoleOverride(undefined);
  document.documentElement.lang = 'en';
  vi.restoreAllMocks();
});

describe('Display preferences', () => {
  it('keeps text and controls at 4.5:1 contrast or higher', () => {
    expectContrast({ ...palette(appStyles), 'glow-bottom': '#d6d6d9' }, [
      ['ink', 'white'], ['ink', 'tile'], ['ink', 'soft-grey'], ['white', 'tile-dark'], ['brand-grey', 'white'],
      ['muted', 'white'], ['muted', 'tile'], ['muted', 'glow-bottom'], ['accent-text', 'accent'],
      ['on-ink-muted', 'ink'], ['urgent', 'urgent-bg'], ['review', 'review-bg'], ['apply', 'apply-bg'],
    ]);
    expect(cloudStyles).not.toMatch(/data-theme|night/);
    expectContrast({ ink: '#182b40', page: '#f5f8fc', surface: '#fff', link: '#154f8a', buttonText: '#fff' }, [
      ['ink', 'page'], ['ink', 'surface'], ['link', 'surface'], ['buttonText', 'link'],
    ]);
  });

  it('keeps Hindi marked as unreviewed', () => {
    expect(isReviewedLanguage('hi')).toBe(false);
  });

  it('switches the navigation, tracking, and calculator to Hindi without modifying a recorded note', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      stage: 'trial', nextDate: null, hearingDates: ['2026-01-01'],
      summaries: [{ hearingDate: '2026-01-01', nextDate: null,
        summary: 'Fictional court approved summary.', verification: 'valid' }],
    }), { status: 200 }));
    portal('/track');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Case number or Case Number Record (CNR)'), 'FICTIONAL 7/2026');
    await user.selectOptions(screen.getByRole('combobox', { name: 'App language' }), 'hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(screen.getByRole('heading', { name: 'मेरे मामले की स्थिति देखें' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'मुख्य मेनू' })).toHaveTextContent('अपने अधिकार जानें');
    expect(screen.getByRole('heading', { name: 'समझौते का अनुमान' })).toBeInTheDocument();
    expect(screen.getByLabelText('मामला नंबर या केस नंबर रिकॉर्ड (सीएनआर)')).toHaveValue('FICTIONAL 7/2026');
    await user.click(screen.getByRole('button', { name: 'मेरा मामला खोजें' }));
    const caseStatus = await screen.findByRole('region', { name: 'मामले की स्थिति' });
    expect(within(caseStatus).getByText('Fictional court approved summary.')).toBeInTheDocument();
    expect(caseStatus).toHaveTextContent('विचारण');
  });

  it('restores Hindi on another screen and can switch back to English', async () => {
    const user = userEvent.setup();
    const tracking = portal('/track');
    await user.selectOptions(screen.getByRole('combobox', { name: 'App language' }), 'hi');
    expect(document.documentElement.lang).toBe('hi');
    tracking.unmount();

    portal('/profile');
    expect(await screen.findByRole('heading', { name: 'अपना नाम, भूमिका और भाषा तय करें' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    await user.selectOptions(screen.getByRole('combobox', { name: 'ऐप की भाषा' }), 'en');
    expect(screen.getByRole('heading', { name: 'Set your name, role, and language' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('shows Hindi labels on the newer dashboard, Cases, hearing, and verifier screens', async () => {
    localStorage.setItem('courtplus.uiLanguage', 'hi');
    setRoleOverride('judge');
    const dashboard = portal('/');
    const release = await screen.findByRole('heading', { name: 'रिहाई के लिए कौन आवेदन कर सकता है' });
    const backlog = screen.getByRole('heading', { name: 'लंबित अदालती मामले' });
    const benchmarks = screen.getByRole('heading', { name: 'लंबित मामलों के आधिकारिक आँकड़े' });
    expect(release.compareDocumentPosition(backlog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(backlog.compareDocumentPosition(benchmarks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'मुख्य मेनू' });
    for (const label of ['न्यायाधीशों के लिए', 'अधिवक्ताओं के लिए', 'नागरिकों के लिए', 'सभी के लिए']) {
      expect(nav.querySelector(`details[aria-label="${label}"]`)).toHaveTextContent(label);
    }
    dashboard.unmount();

    const cases = portal('/cases');
    expect(await screen.findByText('मामले खोजें')).toBeInTheDocument();
    cases.unmount();

    const details = portal('/case/fictional-case');
    expect(await screen.findByRole('heading', { name: 'आदेश से पुष्ट तथ्य' })).toBeInTheDocument();
    details.unmount();

    const recorder = portal('/hearings');
    expect(await screen.findByText('सुनवाई की रिकॉर्डिंग Court+ डेस्कटॉप ऐप में होती है।')).toBeInTheDocument();
    recorder.unmount();

    const verifier = portal('/verify');
    expect(await screen.findByRole('button', { name: 'फ़ाइल जाँचें' })).toBeInTheDocument();
    verifier.unmount();
  });

  it('keeps the drafting studio role choices and warns about unreviewed Hindi drafts', async () => {
    localStorage.setItem('courtplus.uiLanguage', 'hi');
    setRoleOverride('judge');
    portal('/drafts');
    expect(await screen.findByRole('heading', { name: 'आदेश और नोटिस लिखें' })).toBeInTheDocument();
    const kind = screen.getByRole('combobox', { name: 'मसौदे का प्रकार' });
    expect(within(kind).getByRole('option', { name: 'अंतरिम आदेश पत्रक' })).toBeInTheDocument();
    expect(within(kind).queryByRole('option', { name: /नियमित ज़मानत/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(kind, 'INTERIM_ORDER_SHEET');
    expect(screen.getByRole('combobox', { name: 'भाषा' })).toHaveValue('hi');
    expect(screen.getByText('हिन्दी मसौदे की समीक्षा हिन्दी में दक्ष किसी विधिक विशेषज्ञ से कराएँ।')).toBeInTheDocument();
  });
});
