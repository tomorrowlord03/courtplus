import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defineConfig } from 'vite';

const absolute = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: absolute('./ui'),
  base: './',
  plugins: [{
    name: 'desktop-board',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './screens/Board' && importer?.replaceAll('\\', '/').endsWith('/apps/ui/src/App.tsx')) {
        return absolute('./ui/board.tsx');
      }
    },
  }, react()],
  resolve: { dedupe: ['react', 'react-dom', 'react-router-dom'] },
  css: {
    postcss: {
      plugins: [tailwindcss({
        content: [absolute('./ui/**/*.{html,tsx}'), absolute('../ui/src/**/*.{ts,tsx}')],
        theme: { extend: { fontFamily: { sans: ['"Noto Sans"', 'system-ui', 'Segoe UI', 'sans-serif'] } } },
      }), autoprefixer()],
    },
  },
  build: { outDir: absolute('./resources/ui'), emptyOutDir: true },
});
