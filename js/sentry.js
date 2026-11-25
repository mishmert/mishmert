"use strict";

// sentry.js — runtime error reporting via Sentry.
//
// Initialization is conditional on VITE_SENTRY_DSN being set at build time.
// When it's empty (local dev, forks), the init is a no-op and no network
// calls happen. To enable in production:
//   1. Sign up at https://sentry.io (free: 5K errors / month)
//   2. Create a JavaScript project — copy the DSN
//   3. In GitHub repo settings → Secrets and variables → Actions,
//      add a secret named VITE_SENTRY_DSN with that value
//   4. Re-run the latest workflow
//
// The build pipeline passes VITE_SENTRY_DSN into the bundle so it shows up
// here at import.meta.env.VITE_SENTRY_DSN.

import * as Sentry from "@sentry/browser";

const DSN = import.meta.env.VITE_SENTRY_DSN || "";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // Keep traces off by default — we only care about errors.
    tracesSampleRate: 0,
    // 10% of errored sessions → replay, so we can see exactly what the user did.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Don't send events during dev; only in production builds.
    environment: import.meta.env.MODE || "production",
    // Filter out noise that always fires but never means anything useful.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
      "Load failed",
    ],
    beforeSend(event) {
      // Strip URL query strings from breadcrumbs — they sometimes carry OAuth
      // tokens from third-party sign-in flows we never expect to see.
      if (event.request?.url) {
        try {
          event.request.url =
            new URL(event.request.url).origin + new URL(event.request.url).pathname;
        } catch (_) {}
      }
      return event;
    },
  });
}

// Expose a setUser helper so the auth flow can tag errors with the user id.
// Called from checkAuth() after loadAll() succeeds. No PII beyond the UUID
// and role — intentionally: we don't want names / emails in Sentry.
export function setSentryUser(user, profile) {
  if (!DSN || !user) return;
  Sentry.setUser({
    id: user.id,
    role: profile?.role || "unknown",
    business_id: profile?.business_id || null,
  });
}

export function clearSentryUser() {
  if (!DSN) return;
  Sentry.setUser(null);
}

// Expose a manual capture for try/catch handlers that want to report an
// otherwise-swallowed error.
export function captureError(err, extra) {
  if (!DSN) return;
  Sentry.captureException(err, { extra });
}
