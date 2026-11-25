import { defineConfig } from 'vite';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// Vite config for Mishmert.
//
// Design:
//  - target es2020 / safari14 so the bundle works on every browser Mishmert
//    reaches today, including older iOS Safari / in-app WebViews that
//    choked on native ES modules in the earlier refactor attempt.
//  - single JS bundle at assets/app-[hash].js, single CSS bundle at
//    assets/index-[hash].css. Hashed names → cache invalidation on deploy.
//  - sw.js, manifest.json, icons and CNAME are copied verbatim via a small
//    inline plugin so GitHub Pages serves them at the same absolute paths
//    the SW registers against.

const STATIC_FILES = [
  'sw.js',
  'manifest.json',
  'logo-favicon.png',
  'apple-touch-icon.png',
  'og-preview.png',
  'email-banner.png',
  'icon-72x72.png',
  'icon-96x96.png',
  'icon-128x128.png',
  'icon-144x144.png',
  'icon-152x152.png',
  'icon-192x192.png',
  'icon-384x384.png',
  'icon-512x512.png',
  'CNAME',
  'privacy.html',
];

function copyStatic() {
  return {
    name: 'copy-static',
    closeBundle() {
      for (const f of STATIC_FILES) {
        const src = resolve(process.cwd(), f);
        if (existsSync(src)) {
          try {
            copyFileSync(src, resolve(process.cwd(), 'dist', basename(f)));
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
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2020', 'safari14', 'chrome90', 'firefox90'],
    sourcemap: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'index.html'),
      output: {
        manualChunks: undefined,
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [copyStatic()],
});
