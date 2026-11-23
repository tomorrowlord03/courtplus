import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import electronBinary from 'electron';
import { fictionalOrder } from './fictional-order.mjs';
import { launchPortable } from './portable-launch.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const packaged = process.env.COURTPLUS_SMOKE_EXE;
const find = (page, name) => page.getByRole('heading', { name, exact: true });

test('Electron imports a fictional PDF, saves a board card, exports and verifies a signed draft', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-electron-test-'));
  let electron;
  try {
    const profile = join(directory, 'profile');
    electron = /-portable\.exe$/i.test(packaged ?? '')
      ? await launchPortable(packaged, profile)
      : await _electron.launch({
          args: [...(packaged ? [] : [root]), '--courtplus-profile=' + profile],
        cwd: packaged ? dirname(packaged) : root, executablePath: packaged || electronBinary, timeout: 120_000,
    });
    await electron.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, directory);
    const window = await electron.firstWindow();
    await find(window, 'Action board').waitFor();
    await window.locator('nav').getByRole('link', { name: 'Import order' }).click();
    await window.getByLabel('Choose PDF or image').setInputFiles({
      name: 'fictional-order.pdf', mimeType: 'application/pdf', buffer: fictionalOrder(),
    });
    await find(window, 'Confirmed case facts').waitFor({ timeout: 120_000 });
    await window.getByText(/FICTIONAL TEST ORDER/).first().waitFor();
    await window.getByLabel('Person alias').fill('Accused-901');
    await window.getByLabel('Charges', { exact: true }).fill('IPC 379');
    await window.getByLabel('First remand date').fill('2024-01-10');
    await window.getByLabel('Judicial custody start').fill('2024-01-10');
    await window.getByLabel('Judicial custody is ongoing').check();
    await window.getByRole('button', { name: 'Save confirmed case' }).click();
    await window.getByRole('link', { name: /Accused-901.*Lawyer review/ }).waitFor();
    await window.getByText('Days to clear: 1 (1 remaining)', { exact: true }).waitFor();
    await window.getByRole('link', { name: 'Drafts' }).click();
    await window.getByRole('button', { name: 'Export signed PDF' }).click();
    await find(window, 'Signed PDF ready').waitFor({ timeout: 60_000 });

    const files = await readdir(directory);
    const pdf = files.find(name => name.endsWith('.pdf'));
    const receipt = files.find(name => /^[-\da-f]{36}\.json$/.test(name));
    const manifest = files.find(name => name.endsWith('.manifest.json'));
    assert.ok(pdf && receipt && manifest);
    assert.equal((await readFile(join(directory, pdf))).subarray(0, 5).toString(), '%PDF-');

    const opened = electron.waitForEvent('window');
    await electron.evaluate(({ Menu }) => {
      const courtplus = Menu.getApplicationMenu().items.find(item => item.label === 'CourtPlus');
      const verifier = courtplus.submenu.items.find(item => item.label === 'Open verifier');
      verifier.click();
    });
    const verifier = await opened;
    await find(verifier, 'Verifier').waitFor();
    await verifier.getByLabel('Signed PDF').setInputFiles(join(directory, pdf));
    await verifier.getByLabel('Receipt file').setInputFiles(join(directory, receipt));
    await verifier.getByLabel('Manifest file').setInputFiles(join(directory, manifest));
    await verifier.getByRole('button', { name: 'Verify', exact: true }).click();
    await verifier.getByText('✓ Valid', { exact: true }).waitFor();
    await verifier.getByText('✓ Unchanged', { exact: true }).waitFor();
  } finally {
    await electron?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
