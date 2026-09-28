import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// The lab edits the REAL scene code: web/src (+ server/src/shared) and serves web/public (the human assets).
// Whatever works here ships in the app — there is no copy to keep in sync.
export default defineConfig({
  base: './',
  publicDir: r('../web/public'),
  resolve: {
    alias: { '@shared': r('../server/src/shared'), '@web': r('../web/src') },
    dedupe: ['three'],
  },
  server: { port: 5174, fs: { allow: ['..'] } },
  optimizeDeps: { include: ['three'], exclude: ['brotli-dec-wasm'] },
  build: { target: 'es2022' },
});
