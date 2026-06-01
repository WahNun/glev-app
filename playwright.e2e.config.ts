// Playwright config for the Glev e2e test suite (specs under tests/e2e/).
//
// Each parallel worker gets its own Supabase test user
// (`playwright-e2e-{n}@glev.test`) so tests that mutate shared state
// (meals, settings, drip schedule rows) don't race each other. The
// per-worker user pool is provisioned in globalSetup before any spec runs.
//
// The dev server is booted once (or reused if already running) and shared
// across all workers — it is read-mostly from a test perspective. Any
// endpoint that mutates state does so scoped to the authenticated user_id,
// so two workers hitting the same route concurrently is safe.
//
// To run just the e2e suite:  pnpm test:e2e
// To run the full check:       pnpm test   (runs unit first, then e2e)

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 5000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Must match E2E_WORKER_COUNT in tests/global-setup.ts so every worker
// slot has a provisioned Supabase user.
const WORKERS = 2;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  workers: WORKERS,
  fullyParallel: true,
  // The first Next.js compile of /settings can take 30+ seconds in dev
  // mode under Turbopack; bump the per-test timeout accordingly.
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      scale: "css",
      threshold: 0.05,
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Force a known colorScheme so the "system" theme test is
        // deterministic across machines / CI.
        colorScheme: "dark",
        // On Replit the Nix store ships a fully-linked Chromium under
        // `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Prefer it over the
        // npm-downloaded chromium-headless-shell, which is missing the
        // libgbm / libglib system libs that Replit's Nix bundle pulls in.
        // Fall back to Playwright's default if the env var is unset
        // (so the same config works in CI / cloud runners).
        launchOptions: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? {
              executablePath:
                process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
            }
          : {},
      },
    },
    // Android Chrome device emulation — exercises the pointer-event drag
    // path under mobile viewport + hasTouch conditions.
    {
      name: "android-chrome",
      testMatch: "**/snap-slider.spec.ts",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? {
              executablePath:
                process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
            }
          : {},
      },
    },
  ],
  // Boot the dev server (or reuse an existing one) for all e2e specs.
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1"
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
