import { cpSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function copyAssetsPlugin(): Plugin {
  const baseDir = import.meta.dirname ?? resolve('.');
  const rootDir = resolve(baseDir, '../..');
  return {
    name: 'copy-courtplus-assets',
    closeBundle() {
      const distDir = resolve(baseDir, 'dist');
      if (!existsSync(distDir)) return;
      const fontsSrc = resolve(rootDir, 'assets/fonts');
      const fontsDst = resolve(distDir, 'assets/fonts');
      if (existsSync(fontsSrc)) {
        mkdirSync(fontsDst, { recursive: true });
        cpSync(fontsSrc, fontsDst, { recursive: true });
      }
      const i18nSrc = resolve(rootDir, 'data/i18n');
      const i18nDst = resolve(distDir, 'data/i18n');
      if (existsSync(i18nSrc)) {
        mkdirSync(i18nDst, { recursive: true });
        cpSync(i18nSrc, i18nDst, { recursive: true });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url?.startsWith('/assets/fonts/')) {
          const rel = url.slice('/assets/fonts/'.length);
          const filePath = resolve(rootDir, 'assets/fonts', rel);
          if (existsSync(filePath)) {
            res.setHeader('Content-Type', filePath.endsWith('.css') ? 'text/css' : 'font/ttf');
            createReadStream(filePath).pipe(res);
            return;
          }
        }
        if (url?.startsWith('/data/i18n/')) {
          const rel = url.slice('/data/i18n/'.length);
          const filePath = resolve(rootDir, 'data/i18n', rel);
          if (existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/json');
            createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyAssetsPlugin()],
  base: './',
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
});

