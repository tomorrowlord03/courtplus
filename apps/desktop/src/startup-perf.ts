import { performance } from 'node:perf_hooks';
import type { BrowserWindow } from 'electron';

const enabled = process.env.COURTPLUS_PERF === '1';

export function markStartup(label: string): void {
  if (!enabled) return;
  const mark = performance.mark(label);
  console.log(`[courtplus-perf] ${label} +${mark.startTime.toFixed(1)} ms`);
}

export async function timeStartup<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    console.log(`[courtplus-perf] ${label} ${(performance.now() - start).toFixed(1)} ms`);
  }
}

function logRendererMark(label: string, epochMs: number): void {
  console.log(`[courtplus-perf] ${label} +${(epochMs - performance.timeOrigin).toFixed(1)} ms`);
}

export function observeRenderer(window: BrowserWindow, url: string, label: string, dashboard = false): void {
  if (!enabled) return;
  const contents = window.webContents;
  // Match committed main-frame navigation. dom-ready is later than the first paint on some runs.
  contents.once('dom-ready', () => {
    if (contents.getURL() !== new URL(url).href) return;
    void contents.executeJavaScript(`new Promise(resolve => {
      const report = entry => resolve(performance.timeOrigin + entry.startTime);
      const paint = performance.getEntriesByName('first-paint')[0];
      if (paint) return report(paint);
      const observer = new PerformanceObserver(list => {
        const entry = list.getEntriesByName('first-paint')[0];
        if (entry) { observer.disconnect(); report(entry); }
      });
      observer.observe({ type: 'paint', buffered: true });
    })`).then(value => logRendererMark(label + ' first paint', value), () => undefined);

    if (dashboard) {
      void contents.executeJavaScript(`new Promise(resolve => {
        const ready = () => {
          if (!document.querySelector('main .dashboard, main #rights-description')) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now())));
        };
        const observer = new MutationObserver(ready);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        ready();
      })`).then(value => logRendererMark('dashboard interactive', value), () => undefined);
    }
  });
}
