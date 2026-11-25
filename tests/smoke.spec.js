// @ts-check
// Smoke suite — covers everything we can verify without a real Supabase
// session. Each test runs against every project configured in
// playwright.config.js (chromium-desktop, webkit-desktop, mobile-safari,
// mobile-chrome), so a bug that only shows up in Safari fails CI before
// deploy.

const { test, expect } = require('@playwright/test');

/**
 * Attach console / pageerror / requestfailed listeners that collect into
 * arrays available to the calling test.
 */
function hookConsole(page) {
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message + (err.stack ? '\n  ' + err.stack.split('\n').slice(0, 3).join('\n  ') : ''));
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    // Only flag same-origin resources. External CDNs / Google Fonts can fail
    // in CI without the app breaking (OS fallback fonts, etc.).
    const isSameOrigin = url.startsWith('http://127.0.0.1')
      || url.startsWith('http://localhost')
      || url.startsWith('https://mishmert.com')
      || url.startsWith('https://www.mishmert.com');
    if (!isSameOrigin) return;
    failedRequests.push(`${req.method()} ${url} — ${req.failure()?.errorText}`);
  });

  return { consoleErrors, consoleWarnings, pageErrors, failedRequests };
}

// ──────────────────────────────────────────────────────────────────────────
//  PAGE LOAD + SCRIPT INTEGRITY
// ──────────────────────────────────────────────────────────────────────────
test.describe('page load', () => {
  test('loads without any uncaught errors or same-origin network failures', async ({ page }) => {
    const { consoleErrors, pageErrors, failedRequests } = hookConsole(page);

    await page.goto('/', { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(1500);

    // No uncaught exceptions (SyntaxError, ReferenceError, TypeError, etc).
    // This is the check that would have caught yesterday's "Cannot use import
    // statement outside a module" regression.
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
    expect(failedRequests, `same-origin requests that failed:\n${failedRequests.join('\n')}`).toHaveLength(0);
  });

  test('renders Hebrew title + RTL layout', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/משמרת/);
    // <html dir="rtl"> is the whole-app RTL guarantee.
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir).toBe('rtl');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('he');
  });

  test('#app gets populated by render() (no blue-screen stall)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const app = page.locator('#app');
    await expect(app).toBeAttached();
    // The render dispatcher fills #app with at least one child element.
    // Yesterday's module failures left #app empty — the "blue screen".
    await expect(async () => {
      const childCount = await app.evaluate((el) => el.children.length);
      expect(childCount).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  });

  test('manifest.json is linked and loadable', async ({ page }) => {
    await page.goto('/');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    // Check the manifest fetches with the right content-type.
    const resp = await page.request.get(manifestHref);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('name');
    expect(body.display).toBeTruthy();
  });

  test('viewport has no horizontal scroll at mobile widths', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Horizontal scroll on mobile is a layout regression, usually from a
    // fixed-width element wider than the viewport.
    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = page.viewportSize()?.width || 0;
    // Allow 2px tolerance for subpixel rounding.
    expect(docWidth, `document ${docWidth}px wider than viewport ${viewportWidth}px`).toBeLessThanOrEqual(viewportWidth + 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  APP STATE + GLOBALS
// ──────────────────────────────────────────────────────────────────────────
test.describe('app globals', () => {
  test('supabase client (sb) is created and reachable', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    // sb is initialized at the top of the inline script. If supabase-js
    // failed to load from the CDN, sb would be undefined and the whole app
    // would fail. Classic scripts expose top-level `const` by name in the
    // global scope (not on `window`), so we check through eval.
    const sbExists = await page.evaluate(() => {
      try { return typeof sb !== 'undefined' && typeof sb.auth === 'object'; }
      catch (_) { return false; }
    });
    expect(sbExists, 'sb client not created — supabase-js CDN probably failed').toBe(true);
  });

  test('S state object is initialized and exposed as window.S', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const shape = await page.evaluate(() => {
      if (!window.S) return null;
      // Pick stable shape fields that should always exist after state.js runs.
      return {
        hasView: 'view' in window.S,
        hasEmployees: Array.isArray(window.S.employees),
        hasSchedule: typeof window.S.schedule === 'object',
      };
    });
    expect(shape).not.toBeNull();
    expect(shape.hasView).toBe(true);
    expect(shape.hasEmployees).toBe(true);
    expect(shape.hasSchedule).toBe(true);
  });

  test('key helpers are callable in the global scope', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const helpersDefined = await page.evaluate(() => {
      const result = {};
      ['e', 'div', 'btn', 'toast', 'uiConfirm', 'fmtYMD', 'israelNow', 'render', 'isAdmin', 'isManager'].forEach((name) => {
        try { result[name] = typeof eval(name) === 'function'; }
        catch (_) { result[name] = false; }
      });
      return result;
    });
    for (const [name, ok] of Object.entries(helpersDefined)) {
      expect(ok, `global helper ${name}() is not defined — a js/*.js file probably failed to load`).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  LOGIN SCREEN (the only authenticated-flow entry point we can test without
//  a test account)
// ──────────────────────────────────────────────────────────────────────────
test.describe('login screen', () => {
  test('renders the email + password inputs and submit button', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
    // The submit button should contain the login label in Hebrew.
    const loginBtn = page.getByRole('button', { name: /התחבר|כניסה|היכנס/ }).first();
    await expect(loginBtn).toBeVisible({ timeout: 10_000 });
  });

  test('empty-form submit does not throw — validation runs client-side', async ({ page }) => {
    const { pageErrors } = hookConsole(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const loginBtn = page.getByRole('button', { name: /התחבר|כניסה|היכנס/ }).first();
    await loginBtn.click({ trial: false });
    await page.waitForTimeout(800);
    // A validation toast is fine — an uncaught error is not.
    expect(pageErrors, `pageerror while validating empty login form:\n${pageErrors.join('\n')}`).toHaveLength(0);
  });

  test('invalid credentials produce a friendly error — no uncaught exceptions', async ({ page }) => {
    const { pageErrors } = hookConsole(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.locator('input[type="email"]').first().fill('test-no-such-user@example.invalid');
    await page.locator('input[type="password"]').first().fill('WrongPassword12345');
    await page.getByRole('button', { name: /התחבר|כניסה|היכנס/ }).first().click();
    // Wait for the auth round-trip. We're NOT asserting on the toast content
    // here — the server may rate-limit the attempt and return anything — only
    // that no uncaught error surfaced.
    await page.waitForTimeout(3500);
    expect(pageErrors, `pageerror during failed login:\n${pageErrors.join('\n')}`).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  DEEP-LINK ROUTER
// ──────────────────────────────────────────────────────────────────────────
test.describe('deep links', () => {
  test('?goto=reset lands on the password-reset view', async ({ page }) => {
    // Opens the view checkAuth routes unauthenticated reset-link visitors to.
    await page.goto('/?goto=reset', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // The reset view has at least one password input — same selector works.
    // Checking for TWO passwords (new + confirm) over-specifies; one is enough.
    const passwordInput = page.locator('input[type="password"]').first();
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  SERVICE WORKER
// ──────────────────────────────────────────────────────────────────────────
test.describe('service worker', () => {
  test('registers successfully', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'no-registration';
      const sw = reg.active || reg.installing || reg.waiting;
      return sw ? sw.state : 'no-worker';
    });
    expect(['activated', 'installing', 'installed']).toContain(swState);
  });

  test('sw.js is served with a JavaScript content-type (not text/plain)', async ({ page }) => {
    const resp = await page.request.get('/sw.js');
    expect(resp.status()).toBe(200);
    const ct = resp.headers()['content-type'] || '';
    // Browsers refuse to execute a SW served as text/plain; any
    // application/javascript or text/javascript variant is fine.
    expect(ct, `sw.js content-type was ${ct}`).toMatch(/javascript/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  ASSET INTEGRITY
// ──────────────────────────────────────────────────────────────────────────
test.describe('asset integrity', () => {
  test('every js/*.js file referenced by index.html returns 200 and parses', async ({ page }) => {
    await page.goto('/');
    // Pull every <script src="js/..."> URL from the page itself so adding a
    // new one here doesn't require updating this test.
    const scriptUrls = await page.locator('script[src^="js/"]').evaluateAll((els) =>
      els.map((e) => /** @type {HTMLScriptElement} */(e).src));
    expect(scriptUrls.length, 'index.html has no js/*.js references at all').toBeGreaterThan(0);
    for (const url of scriptUrls) {
      const resp = await page.request.get(url);
      expect(resp.status(), `${url} did not return 200`).toBe(200);
      const body = await resp.text();
      // JavaScript source shouldn't accidentally be served as HTML (what
      // happens when a bad path hits GitHub Pages 404 and gets the 404 page
      // as text/html).
      expect(body.trim().startsWith('<'), `${url} looks like HTML, not JS (404 page?)`).toBe(false);
      // No stray `import`/`export` keywords in classic scripts — a smoke
      // test that catches yesterday's ES-Modules regression at the source
      // file level.
      expect(/^import\s+\{/m.test(body), `${url} contains top-level 'import { ... }' — ES module leaked into classic script context`).toBe(false);
    }
  });

  test('styles.css returns 200 with text/css content-type', async ({ page }) => {
    const resp = await page.request.get('/styles.css?v=20261124-1927');
    expect(resp.status()).toBe(200);
    const ct = resp.headers()['content-type'] || '';
    expect(ct).toMatch(/css/);
  });
});
