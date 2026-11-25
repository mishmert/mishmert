"use strict";

// view-registry.js — lazy-loading cache for the authenticated-only view
// modules.
//
// The initial page load only needs views-auth.js (login, MFA, password-reset,
// splash). The 4K-line views-main.js and 1.9K-line views-secondary.js are
// ~2/3 of the whole bundle and nothing shown pre-login references them.
// Vite's dynamic import() support means pulling them out of the initial
// bundle takes just these three async imports.
//
// Pattern:
//   - loadAll() in data.js calls preloadAuthenticatedViews() early in the
//     login flow (right after the session check). The await resolves both
//     chunks in parallel.
//   - render() in main.js calls getView('viewX')() instead of the static
//     imports it used to use. getView() reads from the in-module cache
//     populated by preload — synchronous lookup, zero per-render cost.
//
// If render() ever runs with the modules not yet loaded (e.g. a bug in the
// auth sequence), getView falls back to an "unknown view" placeholder that
// surfaces a visible error rather than a silent crash.

import { e, div } from './utils.js';

let mainMod = null;
let secondaryMod = null;
let loadPromise = null;

/**
 * Kick off dynamic import of the two authenticated-view chunks. Idempotent —
 * subsequent calls return the already-resolved promise.
 */
export function preloadAuthenticatedViews() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all([
    import('./views-main.js').then(m => { mainMod = m; }),
    import('./views-secondary.js').then(m => { secondaryMod = m; }),
  ]).catch(err => {
    // Reset so a later call can retry on recoverable network errors.
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

/** True once both authenticated-view chunks have resolved. */
export function viewsReady() {
  return mainMod !== null && secondaryMod !== null;
}

/**
 * Look up a view function by name from the loaded chunks. Returns a placeholder
 * renderer if the modules haven't finished loading yet, so render() can stay
 * synchronous without crashing during the brief window between kick-off and
 * resolution.
 */
export function getView(name) {
  if (mainMod && name in mainMod) return mainMod[name];
  if (secondaryMod && name in secondaryMod) return secondaryMod[name];
  // Fallback: visible marker so a mis-wired call doesn't just vanish.
  return () => div("card", [
    e("div", { class: "card-title" }, "טוען תצוגה…"),
    e("div", { style: "color:#94A3B8;font-size:13px" },
      `view "${name}" not loaded yet — this usually means preloadAuthenticatedViews() has not finished.`),
  ]);
}
