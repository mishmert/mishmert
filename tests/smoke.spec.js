// @ts-check
// Smoke suite — the minimum we need to prove the app loaded rather than
// crashed into a blue screen. Each test runs against every project configured
// in playwright.config.js (chromium-desktop, webkit-desktop, mobile-safari,
// mobile-chrome).
//
// If this test file had existed yesterday, every ES-Modules / Vite attempt
// would have failed CI at "console errors found: Cannot use import statement
// outside a module" and nothing would have reached production.

const { test, expect } = require('@playwright/test');

test.describe('app smoke', () => {
  /**
   * Capture every console message and uncaught error for the page under test.
   * The arrays are shared across the single test case so assertions can inspect
   * them at the end.
   */
  function hookConsole(page) {
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('requestfailed', (req) => {
      // Ignore the two external CDN scripts occasionally failing from CI IPs — we
      // only care about our own origin here.
      const url = req.url();
      if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net')) return;
      failedRequests.push(`${req.method()} ${url} — ${req.failure()?.errorText}`);
    });

    return { consoleErrors, pageErrors, failedRequests };
  }

  test('loads without console errors', async ({ page }) => {
    const { consoleErrors, pageErrors, failedRequests } = hookConsole(page);

    await page.goto('/', { waitUntil: 'networkidle', timeout: 20_000 });

    // Wait a beat for late-firing scripts to settle.
    await page.waitForTimeout(1500);

    // 1. The app container must exist in the DOM. Blue-screen stall produces
    //    an empty #app, so we assert it has *some* content after render.
    const app = page.locator('#app');
    await expect(app).toBeAttached();

    // 2. The render dispatcher populates #app with at least one child. A blue
    //    splash that never resolved would leave #app empty.
    const appChildCount = await app.evaluate((el) => el.children.length);
    expect(appChildCount, 'no app content rendered — blue-screen stall').toBeGreaterThan(0);

    // 3. No uncaught page errors (SyntaxError, ReferenceError, etc). This is
    //    the check that would have caught yesterday's "Cannot use import
    //    statement outside a module".
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toHaveLength(0);

    // 4. No console.error output either (lesser-severity bugs the app itself
    //    reports).
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);

    // 5. No failed network requests to our own origin.
    expect(failedRequests, `failed requests:\n${failedRequests.join('\n')}`).toHaveLength(0);
  });

  test('document title is Hebrew Mishmert branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/משמרת/);
  });

  test('login screen eventually renders a password field', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // checkAuth routes anonymous visitors to viewLogin → a password input shows.
    const pw = page.locator('input[type="password"]').first();
    await expect(pw).toBeVisible({ timeout: 15_000 });
  });

  test('service worker is registered and healthy', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    // The current SW is unversioned for the client — we just confirm registration
    // completed without an exception from registerForNavigate.
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'no-registration';
      const sw = reg.active || reg.installing || reg.waiting;
      return sw ? sw.state : 'no-worker';
    });
    expect(['activated', 'installing', 'installed']).toContain(swState);
  });
});
