import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchPackaged } from './portable-launch.mjs';

const executable = process.env.COURTPLUS_PERF_EXE;
if (!executable) throw new Error('Set COURTPLUS_PERF_EXE to a win-unpacked CourtPlus.exe.');
process.env.COURTPLUS_PERF = '1';
const rounds = Number(process.env.COURTPLUS_PERF_RUNS ?? 3);
const caseCount = Number(process.env.COURTPLUS_PERF_CASES ?? 120);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0, 'COURTPLUS_PERF_RUNS must be a positive integer.');
assert.ok(Number.isSafeInteger(caseCount) && caseCount >= 0, 'COURTPLUS_PERF_CASES must be a nonnegative integer.');
const now = () => Date.now();
const round = value => Math.round(value * 10) / 10;
const nav = (page, name) => page.locator('nav[aria-label="Main"]').getByRole('link', { name, exact: true }).first();

async function seed(page) {
  await page.evaluate(async count => {
    await window.courtplus.saveProfile({
      fullName: 'Fictional Performance Judge', role: 'judge', office: 'Fictional District Court',
      district: 'Fictional District', designation: 'Judge', language: 'en',
    });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await Promise.all(Array.from({ length: count }, (_, index) => {
      const id = 'perf-' + index;
      const personId = 'person-' + id;
      const person = { id: personId, alias: 'Fictional alias ' + index, prisonerType: 'undertrial',
        priorConviction: 'no', otherHolds: 'no', caseIds: [id] };
      const record = { id, personId, court: 'Fictional District Court', caseNo: 'FICTIONAL/' + index,
        charges: [{ act: 'IPC', section: '379', stage: 'FRAMED', verified: true }],
        custody: [{ kind: 'judicial', start: '2025-01-01', ongoing: true }], events: [], pendingStatus: 'trial' };
      return window.courtplus.saveCase(person, record).then(() => window.courtplusJudge.courtWorkspace(date, {
        kind: 'meta', meta: { caseId: id, caseType: 'criminal', filedOn: '2025-01-01',
          stage: 'Evidence', partiesInCustody: true, partyFlags: ['undertrial'], nationalSecurity: false },
      }));
    }));
  }, caseCount);
}

async function trace(page, profile, label, action) {
  const session = await page.context().newCDPSession(page);
  const events = [];
  const finished = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await session.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
  });
  try {
    await action();
  } finally {
    await session.send('Tracing.end');
    await finished;
    await session.detach();
  }
  const mainThreads = new Set(events.filter(event => event.name === 'thread_name' && event.args.name === 'CrRendererMain')
    .map(event => event.pid + ':' + event.tid));
  if (!mainThreads.size) throw new Error('Trace missing renderer main thread metadata.');
  const tasks = events.filter(event => event.name === 'RunTask' && mainThreads.has(event.pid + ':' + event.tid));
  if (!tasks.length) throw new Error('Trace missing renderer main-thread RunTask events.');
  const durations = tasks.map(event => event.dur / 1000).filter(Number.isFinite);
  const directory = process.env.COURTPLUS_PERF_TRACE_DIR;
  if (directory) await writeFile(join(directory, profile + '-' + label + '.json'), JSON.stringify({ traceEvents: events }));
  return { longestMs: round(Math.max(...durations)), over50Ms: durations.filter(duration => duration > 50).length };
}

async function scroll(page) {
  await page.evaluate(() => scrollTo(0, 0));
  const height = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  if (height <= 1_000) throw new Error('Expected a scrolling list, got ' + height + ' CSS pixels of overflow.');
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(viewport.width - 90, viewport.height - 180);
  for (let step = 0; step < 40; step++) {
    await page.mouse.wheel(0, height / 34);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  if (await page.evaluate(() => scrollY < 1000)) throw new Error('Scroll input did not reach the list.');
}

for (let run = 1; run <= rounds; run++) {
  const directory = await mkdtemp(join(tmpdir(), 'courtplus-perf-'));
  let app;
  try {
    const start = now();
    app = await launchPackaged(executable, directory);
    const page = await app.firstWindow();
    const appUrlObservedMs = now() - start;
    await page.getByText('No cases saved yet', { exact: true }).waitFor({ timeout: 60_000 });
    const dashboardObservedMs = now() - start;
    const firstPaintMs = await page.evaluate(async start => {
      const entry = performance.getEntriesByName('first-paint')[0] ?? await new Promise(resolve => {
        const observer = new PerformanceObserver(list => {
          const paint = list.getEntriesByName('first-paint')[0];
          if (paint) { observer.disconnect(); resolve(paint); }
        });
        observer.observe({ type: 'paint', buffered: true });
      });
      return performance.timeOrigin + entry.startTime - start;
    }, start);
    console.log(JSON.stringify({ run, appUrlObservedMs, firstPaintMs: round(firstPaintMs), dashboardObservedMs }));
    console.log(app.output().split(/\r?\n/).filter(line => line.includes('[courtplus-perf]')).join('\n'));
    if (run !== rounds || !caseCount) continue;

    await page.getByRole('button', { name: 'Skip for now' }).click();
    await nav(page, 'Cases').click();
    await seed(page);
    // Reload to let AppProvider pick up the saved judge profile and discard fixture setup work.
    await page.reload();
    const cases = page.getByRole('list', { name: 'Cases, most urgent first' });
    await cases.waitFor({ timeout: 120_000 });
    assert.equal(await cases.evaluate(list => list.children.length), caseCount);
    const caseScroll = await trace(page, 'run-' + run, 'case-scroll', () => scroll(page));
    console.log(JSON.stringify({ caseCount, caseScroll }));
    const triageLoad = await trace(page, 'run-' + run, 'triage-load', async () => {
      await nav(page, 'Smart triage').click();
      await page.getByRole('heading', { name: 'Ranked pending cases' }).waitFor({ timeout: 60_000 });
    });
    const triageScroll = await trace(page, 'run-' + run, 'triage-scroll', () => scroll(page));
    const dashboard = await trace(page, 'run-' + run, 'dashboard', async () => {
      await nav(page, 'Judge dashboard').click();
      await page.getByRole('region', { name: 'Undertrial release check' }).waitFor({ timeout: 60_000 });
    });
    console.log(JSON.stringify({ caseCount, triageLoad, triageScroll, dashboard }));
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}
