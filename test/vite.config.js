import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// The lab edits the REAL scene code: web/src/scene + server/src/shared.
// Whatever works here ships in the app — there is no copy to keep in sync.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@shared': r('../server/src/shared'), '@web': r('../web/src') },
    dedupe: ['three'],
  },
  server: { port: 5174, fs: { allow: ['..'] } },
  optimizeDeps: { include: ['three'] },
  build: { target: 'es2022' },
});
