import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createGuideHandler, loadGuideModel } from '../src/handlers/guide-llm';

const modelPath = resolve(process.env.COURTPLUS_GUIDE_MODEL
  ?? 'E:/AI-cache/models/guide/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const input = {
  question: 'How do I import an order?', lang: 'en' as const, passages: [
    { id: 'import', title: 'Import an order', text: 'Open Import Case and select the order PDF from your computer.' },
    { id: 'review', title: 'Review the order', text: 'Verify the suggested fields, correct any mistakes, and save the case.' },
  ],
};

it.runIf(process.env.COURTPLUS_GUIDE_MODEL_TEST === '1')('answers with the local guide model in under 20 seconds', async () => {
  let loadMs = 0;
  const rssBefore = process.memoryUsage.rss();
  const ask = createGuideHandler('resources', () => {}, async (_path, signal) => {
    const loadStart = performance.now();
    const model = await loadGuideModel(modelPath, signal);
    loadMs = performance.now() - loadStart;
    return model;
  });

  try {
    const started = performance.now();
    const result = await ask(input);
    const totalMs = performance.now() - started;
    const answerMs = totalMs - loadMs;
    const rss = process.memoryUsage.rss();
    const mib = 1024 ** 2;
    process.stdout.write(`Guide model load ${(loadMs / 1000).toFixed(2)} s, answer ${(answerMs / 1000).toFixed(2)} s, ` +
      `total ${(totalMs / 1000).toFixed(2)} s, RSS ${(rss / mib).toFixed(1)} MiB (+${((rss - rssBefore) / mib).toFixed(1)} MiB)\n`);
    expect(result.mode).toBe('llm');
    expect(result.answer.trim()).not.toBe('');
    expect(answerMs).toBeLessThan(20_000);
  } finally {
    await ask.dispose();
  }
}, 120_000);

it.runIf(process.env.COURTPLUS_GUIDE_MODEL_TEST === '1')('stops native evaluation after the answer timeout', async () => {
  const finished = Promise.withResolvers<number>();
  let abortedAt = 0;
  let rejected = false;
  const ask = createGuideHandler('resources', () => {}, async (_path, loadSignal) => {
    const model = await loadGuideModel(modelPath, loadSignal);
    return {
      async answer(request, signal) {
        signal.addEventListener('abort', () => { abortedAt = performance.now(); }, { once: true });
        try {
          return await model.answer(request, signal);
        } catch (error) {
          rejected = true;
          throw error;
        } finally {
          finished.resolve(performance.now());
        }
      },
      dispose: model.dispose,
    };
  }, 50);

  try {
    const result = await ask(input);
    expect(result.mode).toBe('search');
    expect(abortedAt).toBeGreaterThan(0);
    await expect.poll(() => rejected, { timeout: 2000 }).toBe(true);
    const stopMs = await finished.promise - abortedAt;
    expect(stopMs).toBeLessThan(2000);

    const cpuStart = process.cpuUsage();
    await setTimeout(500);
    const cpu = process.cpuUsage(cpuStart);
    const idleCpuMs = (cpu.user + cpu.system) / 1000;
    expect(idleCpuMs).toBeLessThan(250);
    process.stdout.write(`Guide model stopped ${stopMs.toFixed(1)} ms after abort, then used ${idleCpuMs.toFixed(1)} ms CPU over 500 ms\n`);
  } finally {
    await ask.dispose();
  }
}, 120_000);
