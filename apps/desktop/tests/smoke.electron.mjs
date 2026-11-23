import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright';
import electronBinary from 'electron';
import { fictionalOrder } from './fictional-order.mjs';
import { launchPackaged, startupTimeout } from './portable-launch.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
// Git-ignored (apps/desktop/.gitignore): failure screenshots and the app's last output.
const results = join(root, 'test-results');
const packaged = process.env.COURTPLUS_SMOKE_EXE;
const launchBudget = (packaged ? startupTimeout(packaged) : 60_000) + 30_000;
const folderTitle = 'Choose a folder for the signed draft bundle';
const find = (page, name) => page.getByRole('heading', { name, exact: true });
const started = Date.now();
const log = message => console.log('[smoke +' + ((Date.now() - started) / 1000).toFixed(1) + 's] ' + message);

// Dev runs drive the unpacked tree with Playwright's Electron launcher and stub the dialog in main.
async function launchDevelopment(profile) {
  const electron = await _electron.launch({
    args: [root, '--courtplus-profile=' + profile], cwd: root, executablePath: electronBinary, timeout: 60_000,
  });
  return {
    output: () => '',
    close: () => electron.close(),
    firstWindow: () => electron.firstWindow(),
    pickFolder: directory => electron.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, directory),
    openVerifier: async () => {
      const opened = electron.waitForEvent('window');
      await electron.evaluate(({ Menu }) => {
        const courtplus = Menu.getApplicationMenu().items.find(item => item.label === 'CourtPlus');
        courtplus.submenu.items.find(item => item.label === 'Open verifier').click();
      });
      return opened;
    },
  };
}

// The packaged exe is fused shut to main-process debugging, so the real folder dialog is answered
// through Windows UI Automation, exactly as a user would answer it.
const pickWithAutomation = directory => promisify(execFile)('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests', 'pick-folder.ps1'),
  '-Title', folderTitle, '-Folder', directory, '-TimeoutSeconds', '60',
], { windowsHide: true, timeout: 90_000 });

test('Electron imports a fictional PDF, saves a board card, exports and verifies a signed draft', { timeout: 2 * launchBudget + 480_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-electron-test-'));
  const exportDirectory = join(directory, 'export');
  await mkdir(exportDirectory);
  let app;
  let page;
  let current = 'setup';

  async function step(name, timeout, run) {
    current = name;
    const begun = Date.now();
    log('▶ ' + name);
    let timer;
    try {
      const result = await Promise.race([
        run(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('step timed out after ' + timeout / 1000 + ' s')), timeout); }),
      ]);
      log('✓ ' + name + ' (' + ((Date.now() - begun) / 1000).toFixed(1) + ' s)');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const profile = join(directory, 'profile');
    log('mode: ' + (packaged ? 'packaged ' + packaged : 'development tree'));
    app = await step('launch', launchBudget, () => packaged
      ? launchPackaged(packaged, profile, log).then(launched => ({ ...launched, pickFolder: pickWithAutomation }))
      : launchDevelopment(profile));
    page = await step('first window', 60_000, () => app.firstWindow());
    await step('board renders', 60_000, () => find(page, 'Action board').waitFor({ timeout: 60_000 }));

    await step('open import', 30_000, async () => {
      await page.locator('nav').getByRole('link', { name: 'Import order' }).click();
      await page.getByLabel('Choose PDF or image').setInputFiles({
        name: 'fictional-order.pdf', mimeType: 'application/pdf', buffer: fictionalOrder(),
      });
    });
    // First run loads the OCR/NER models, so this is the slowest step.
    await step('PDF import, OCR and NER', 180_000, async () => {
      await find(page, 'Confirmed case facts').waitFor({ timeout: 180_000 });
      await page.getByText(/FICTIONAL TEST ORDER/).first().waitFor();
    });
    await step('confirm and save case', 60_000, async () => {
      await page.getByLabel('Person alias').fill('Accused-901');
      await page.getByLabel('Charges', { exact: true }).fill('IPC 379');
      await page.getByLabel('First remand date').fill('2024-01-10');
      await page.getByLabel('Judicial custody start').fill('2024-01-10');
      await page.getByLabel('Judicial custody is ongoing').check();
      // Saving requires a named confirmer since w19; the form blocks submit without one.
      await page.getByLabel('Confirmed by').fill('Smoke Tester, test clerk');
      await page.getByRole('button', { name: 'Save confirmed case' }).click();
    });
    await step('board card', 60_000, async () => {
      await page.getByRole('link', { name: /Accused-901.*Lawyer review/ }).waitFor({ timeout: 60_000 });
      await page.getByText('Days to clear: 1 (1 remaining)', { exact: true }).waitFor();
    });
    await step('export signed PDF', 120_000, async () => {
      await page.getByRole('link', { name: 'Drafts' }).click();
      const picked = app.pickFolder(exportDirectory);
      await page.getByRole('button', { name: 'Export signed PDF' }).click();
      await picked;
      await find(page, 'Signed PDF ready').waitFor({ timeout: 60_000 });
    });

    const files = await readdir(exportDirectory);
    const pdf = files.find(name => name.endsWith('.pdf'));
    const receipt = files.find(name => /^[-\da-f]{36}\.json$/.test(name));
    const manifest = files.find(name => name.endsWith('.manifest.json'));
    assert.ok(pdf && receipt && manifest, 'export bundle incomplete: ' + files.join(', '));
    assert.equal((await readFile(join(exportDirectory, pdf))).subarray(0, 5).toString(), '%PDF-');

    page = await step('open verifier', launchBudget, () => app.openVerifier());
    await step('verify signed PDF', 60_000, async () => {
      await find(page, 'Verifier').waitFor();
      await page.getByLabel('Signed PDF').setInputFiles(join(exportDirectory, pdf));
      await page.getByLabel('Receipt file').setInputFiles(join(exportDirectory, receipt));
      await page.getByLabel('Manifest file').setInputFiles(join(exportDirectory, manifest));
      await page.getByRole('button', { name: 'Verify', exact: true }).click();
      await page.getByText('✓ Valid', { exact: true }).waitFor();
      await page.getByText('✓ Unchanged', { exact: true }).waitFor();
    });
  } catch (error) {
    log('✗ failed at step "' + current + '": ' + error.message);
    await mkdir(results, { recursive: true });
    if (page) {
      const shot = join(results, 'smoke-failure.png');
      await page.screenshot({ path: shot, timeout: 10_000 }).then(() => log('screenshot: ' + shot), () => log('screenshot failed'));
    }
    const output = app?.output();
    if (output) log('app output (tail):\n' + output);
    throw new Error('Smoke step "' + current + '" failed: ' + error.message, { cause: error });
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
