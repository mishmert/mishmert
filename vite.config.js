import { defineConfig } from 'vite';
import { copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// Vite config for Mishmert.
//
// Design goals:
//  - Single bundled main.js that works on every browser (including older
//    mobile Safari / in-app WebViews that choke on native ES modules).
//  - Fingerprinted asset names so a deploy invalidates browser cache
//    automatically. The service worker (sw.js) is NOT fingerprinted so it
//    can self-replace on its next fetch.
//  - Copy non-build static files (sw.js, manifest.json, icons, PDFs) into
//    dist/ as-is so GitHub Pages serves them at the same URLs as before.
//  - Preserve the SRI integrity hashes on the two CDN <script>s in
//    index.html (twemoji + supabase-js) so the browser still refuses a
//    tampered CDN response.

// Files at the repo root that should copy into dist/ untouched.
const STATIC_FILES = [
  'sw.js',
  'manifest.json',
  'logo-favicon.png',
  'apple-touch-icon.png',
  'og-preview.png',
  'email-banner.png',
  'icon-192x192.png',
  'icon-512x512.png',
  'CNAME',           // keeps GitHub Pages serving on mishmert.com after each build
  'privacy.html',    // static legal page, not part of the app bundle
];

function copyStatic() {
  return {
    name: 'copy-static',
    closeBundle() {
      for (const f of STATIC_FILES) {
        const src = resolve(process.cwd(), f);
        if (existsSync(src)) {
          const dest = resolve(process.cwd(), 'dist', basename(f));
          try {
            copyFileSync(src, dest);
          } catch (e) {
            console.warn(`[copy-static] skipped ${f}: ${e.message}`);
          }
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  publicDir: false, // we manage static files ourselves via copyStatic
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2020', 'safari14', 'chrome90', 'firefox90'],
    sourcemap: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'index.html'),
      output: {
        // Keep one JS bundle so the mobile browsers that stumbled on native
        // ES modules see a single self-contained <script>.
        manualChunks: undefined,
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [copyStatic()],
});
