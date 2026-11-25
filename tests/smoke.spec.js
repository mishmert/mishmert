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
    await page.waitForTimeout(1500);
    // Try both the classic-script path (global `sb` identifier) and the
    // module-build path (where sb.js must explicitly set window.sb).
    const sbExists = await page.evaluate(() => {
      try {
        if (typeof globalThis.sb !== 'undefined' && globalThis.sb.auth) return true;
        if (window.sb && window.sb.auth) return true;
        // Final fallback: try to evaluate the identifier in global scope.
        try { return typeof sb !== 'undefined' && typeof sb.auth === 'object'; }
        catch (_) { return false; }
      } catch (_) { return false; }
    });
    expect(sbExists, 'sb client not created — supabase-js CDN probably failed, or sb.js did not run').toBe(true);
  });

  test('S state object is initialized and exposed as window.S', async ({ page }) => {
    await page.goto('/');
    // Wait specifically for state.js's `window.S = S` to execute (up to 10s).
    // Timeouts vary across projects; WebKit is slower than Chromium.
    await page.waitForFunction(() => !!window.S, null, { timeout: 10_000 });
    const shape = await page.evaluate(() => ({
      hasView: 'view' in window.S,
      hasEmployees: Array.isArray(window.S.employees),
      hasSchedule: typeof window.S.schedule === 'object',
    }));
    expect(shape.hasView).toBe(true);
    expect(shape.hasEmployees).toBe(true);
    expect(shape.hasSchedule).toBe(true);
  });

  test('key helpers are callable (classic-script globals only)', async ({ page }) => {
    // This check only makes sense when the app ships as classic scripts that
    // expose top-level names into the shared global scope. The Vite-bundled
    // module build puts everything inside the module's own closure, so these
    // names aren't globals anymore (sb / render / etc. are reachable through
    // window.S or window.sb only when state.js / sb.js explicitly expose them).
    const html = await (await page.request.get('/')).text();
    const isModule = /<script[^>]*type="module"[^>]*src="/.test(html);
    test.skip(isModule, 'module build hides helpers inside the bundle — check through window.S / window.sb instead');

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
  test('every local script referenced by index.html returns real JS', async ({ request }) => {
    const indexResp = await request.get('/');
    expect(indexResp.status()).toBe(200);
    const html = await indexResp.text();

    // Detect every local <script src="..."> (either classic js/*.js files or
    // a Vite-bundled assets/app-HASH.js). External CDN scripts are skipped.
    const srcRegex = /<script[^>]*src="([^"]+)"/g;
    const paths = [];
    let m;
    while ((m = srcRegex.exec(html)) !== null) {
      const src = m[1];
      if (src.startsWith('http://') || src.startsWith('https://')) continue; // external CDN
      paths.push(src.replace(/^\//, ''));
    }
    expect(paths.length, 'no local <script src> tags found in index.html').toBeGreaterThan(0);

    // Determine whether this is the classic (multi-script) or bundled (type="module") layout.
    const isModule = /<script[^>]*type="module"[^>]*src="/.test(html);

    for (const relPath of paths) {
      const resp = await request.get('/' + relPath);
      expect(resp.status(), `/${relPath} did not return 200`).toBe(200);
      const body = await resp.text();
      // Not accidentally serving the 404 HTML page as JS.
      expect(body.trim().startsWith('<'), `/${relPath} looks like HTML, not JS (404 page?)`).toBe(false);
      // Only enforce "no top-level import" in CLASSIC mode. In the
      // module/bundle mode, imports are legal.
      if (!isModule) {
        expect(/^import\s+\{/m.test(body), `/${relPath} has top-level 'import { ... }' but is loaded as a classic script`).toBe(false);
      }
    }
  });

  test('page stylesheet(s) return 200 with text/css', async ({ page, request }) => {
    // Pull every <link rel="stylesheet"> URL from the served HTML — covers
    // classic (styles.css) and bundled (assets/index-HASH.css) layouts.
    const html = await (await request.get('/')).text();
    const hrefs = [];
    const linkRegex = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1];
      if (href.startsWith('http://') || href.startsWith('https://')) continue; // Google Fonts etc
      hrefs.push(href.replace(/^\.?\//, ''));
    }
    expect(hrefs.length, 'no local stylesheets in index.html').toBeGreaterThan(0);
    for (const h of hrefs) {
      const resp = await request.get('/' + h);
      expect(resp.status(), `/${h} did not return 200`).toBe(200);
      const ct = resp.headers()['content-type'] || '';
      expect(ct, `/${h} content-type was ${ct}`).toMatch(/css/);
    }
  });
});
