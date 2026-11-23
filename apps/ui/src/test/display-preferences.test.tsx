import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { createDevStub } from '../lib/api';
import { AppProvider } from '../lib/context';
import { setRoleOverride } from '../lib/roles';

const api = {
  ...createDevStub(),
  listCases: async () => [{
    id: 'fictional-case', personId: 'fictional-person', caseNo: 'OFFICE 7/2026',
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
});

describe('Display preferences', () => {
  it('switches the navigation, tracking, and calculator to Hindi without modifying a recorded note', async () => {
    portal('/track');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Case number or CNR'), 'OFFICE 7/2026');
    await user.selectOptions(screen.getByRole('combobox', { name: 'App language' }), 'hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(screen.getByRole('heading', { name: 'मेरे मामले की स्थिति' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'मुख्य मेनू' })).toHaveTextContent('अधिकार मार्गदर्शक');
    expect(screen.getByRole('heading', { name: 'समझौते का अनुमान' })).toBeInTheDocument();
    expect(screen.getByLabelText('मामला संख्या या सीएनआर')).toHaveValue('OFFICE 7/2026');
    await user.click(screen.getByRole('button', { name: 'मेरा मामला खोजें' }));
    const caseStatus = await screen.findByRole('region', { name: 'मामले की स्थिति' });
    expect(within(caseStatus).getByText('सुनवाई — Board')).toBeInTheDocument();
    expect(caseStatus).toHaveTextContent('विचारण');
  });

  it('restores Hindi on another screen and can switch back to English', async () => {
    const user = userEvent.setup();
    const tracking = portal('/track');
    await user.selectOptions(screen.getByRole('combobox', { name: 'App language' }), 'hi');
    expect(document.documentElement.lang).toBe('hi');
    tracking.unmount();

    portal('/profile');
    expect(screen.getByRole('heading', { name: 'मेरी प्रोफ़ाइल' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    await user.selectOptions(screen.getByRole('combobox', { name: 'ऐप की भाषा' }), 'en');
    expect(screen.getByRole('heading', { name: 'My profile' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });
});
