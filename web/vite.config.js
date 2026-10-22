import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The garment silhouette engine lives in server/src/shared and is imported by both runtimes.
const shared = fileURLToPath(new URL('../server/src/shared', import.meta.url));
/** A page, as an absolute path — Vite resolves the entry list against the project root. */
const page = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  resolve: { alias: { '@shared': shared } },
  server: { port: 5173, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    // No .map files on the deployed site. They would hand every visitor the
    // unminified source of the scanner, including the shared engine, which is
    // the one thing publishing the built site should not do.
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Five real pages rather than one page pretending: the home page (the way
      // in), the account screen it leads to, the scanner itself — which can also
      // be opened straight from a link — and the two the bar points at, pricing
      // and the dashboard. Each has its own address, so a stale static host
      // cannot send anyone to the wrong one; they are directories on disk, not
      // routes invented at runtime.
      input: {
        landing: page('index.html'),
        auth: page('auth/index.html'),
        size: page('size/index.html'),
        pricing: page('pricing/index.html'),
        dashboard: page('dashboard/index.html'),
      },
      output: { manualChunks: { three: ['three'], supabase: ['@supabase/supabase-js'] } },
    },
  },
});
