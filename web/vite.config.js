import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The garment silhouette engine lives in server/src/shared and is imported by both runtimes.
const shared = fileURLToPath(new URL('../server/src/shared', import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  resolve: { alias: { '@shared': shared } },
  server: { port: 5173, fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['brotli-dec-wasm'] },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'], supabase: ['@supabase/supabase-js'] } } },
  },
});
