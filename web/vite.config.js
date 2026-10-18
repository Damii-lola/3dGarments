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
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Three real pages rather than one page pretending: the landing (the way
      // in), the account screen it leads to, and the scanner itself, which can
      // also be opened straight from a link. Each has its own address, so a
      // stale static host cannot send anyone to the wrong one; /size and /auth
      // are directories on disk, not routes invented at runtime.
      input: {
        landing: page('index.html'),
        auth: page('auth/index.html'),
        size: page('size/index.html'),
      },
      output: { manualChunks: { three: ['three'], supabase: ['@supabase/supabase-js'] } },
    },
  },
});
