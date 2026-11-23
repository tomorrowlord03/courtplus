import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import help from '../../../../data/ui/screen-help.json';
import appSource from '../App.tsx?raw';
import { App } from '../App';
import { createDevStub } from '../lib/api';
import { AppProvider } from '../lib/context';
import { languageKey } from '../lib/preferences';

const routesInApp = Array.from(appSource.matchAll(/<Route path="([^"]+)"/g), match => match[1]);

it('has one bilingual help entry for every declared route', () => {
  expect(help.screens.map(({ route }) => route).sort()).toEqual(routesInApp.sort());
  expect(new Set(help.screens.map(({ id }) => id)).size).toBe(help.screens.length);

  for (const { roles, name, what, when, start, steps } of help.screens) {
    expect(roles.length).toBeGreaterThan(0);
    expect(['judge', 'lawyer', 'citizen', 'staff']).toEqual(expect.arrayContaining(roles));
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(5);
    for (const text of [name, what, when, start, ...steps]) {
      expect(text.en.trim()).not.toBe('');
      expect(text.hi.trim()).not.toBe('');
      expect(text.en.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
      expect(text.hi.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
    }
  }
});

function openRoute(path: string) {
  return render(<AppProvider api={createDevStub()}>
    <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
  </AppProvider>);
}

// Settings is provided by the desktop host.
const screenRoutes = help.screens.filter(({ id }) => id !== 'settings');

it.each(screenRoutes)('shows the intro for $route', async entry => {
  const route = entry.route.replace(/:[^/]+/g, 'fictional-id');
  openRoute(route);
  const id = entry.id === 'judge-dashboard' ? 'dashboard' : entry.id;
  const expected = help.screens.find(item => item.id === id)!;
  const what = await screen.findByText(expected.what.en, undefined, { timeout: 3_000 });
  const intro = what.closest('header');
  expect(intro).toHaveAttribute('data-guide-screen', id);
  expect(document.querySelectorAll('[data-guide-screen]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-guide="start"]').length).toBeLessThanOrEqual(1);
  expect(within(intro!).getByText(expected.when.en)).toBeVisible();
  expect(within(intro!).getByText(expected.start.en)).toBeVisible();
});

it('shows Hindi guidance and marks the first action on the document check', async () => {
  localStorage.setItem(languageKey, 'hi');
  try {
    openRoute('/verify');
    const title = await screen.findByRole('heading', { name: 'जाँचें कि दस्तावेज़ बदला है या नहीं' });
    const intro = title.closest('header');
    expect(intro).toHaveAttribute('data-guide-screen', 'verify');
    expect(within(intro!).getByText('यहाँ से शुरू करें')).toBeVisible();
    expect(screen.getByRole('button', { name: 'फ़ाइल जाँचें' })).toHaveAttribute('data-guide', 'start');
    expect(screen.getByRole('link', { name: title.textContent! })).toBeVisible();
  } finally {
    localStorage.removeItem(languageKey);
  }
});
