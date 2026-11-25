// @ts-check
// Playwright config: run smoke tests against a locally-served copy of the repo
// AND against the live mishmert.com. The LOCAL server catches a broken commit
// BEFORE it ships; the LIVE suite catches CDN/SW/Cloudflare issues after it ships.

const { defineConfig, devices } = require("@playwright/test");

// Target host comes from the TEST_URL env var so the same tests run against:
//   • a CI-local http server (default),
//   • a Vite preview (http://localhost:4173),
//   • the production site (https://mishmert.com)
// without any config changes.
const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:4173";

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Desktop — the browser that always worked yesterday
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    // WebKit (Safari engine) is the critical one — this is what yesterday's
    // mobile breakage ran on. A WebKit test here would have caught it.
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"] },
    },
    // Mobile Safari emulation (iPhone 14).
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
    // Mobile Chrome emulation (Pixel 7).
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Serve the right directory for the test run:
  //  - TEST_URL set           → run against a remote URL, no local server.
  //  - VITE_SERVE_DIST=1      → serve the Vite-built dist/ (CI after build).
  //  - otherwise               → serve the repo root (local source dev).
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command: process.env.VITE_SERVE_DIST
          ? "python3 -m http.server --directory dist 4173"
          : "python3 -m http.server 4173",
        port: 4173,
        timeout: 10_000,
        reuseExistingServer: !process.env.CI,
      },
});
