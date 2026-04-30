import { defineConfig, devices } from "@playwright/test";

// Playwright config for the regular Glev test suite.
//
// We bind to the same dev-server port as `npm run dev` (5000) so the
// tests run against the live Next.js server. CI / local runs can either
// bring up the server themselves (via the existing "Start application"
// workflow) or let Playwright start one via `webServer`.
//
// The `webServer` block only spins up a server if none is already
// listening (`reuseExistingServer: true`). That keeps `npm test` ergonomic
// in two environments:
//   * Replit dev: workflow already serves on :5000 → reused.
//   * CI / cold local: Playwright boots `npm run dev` itself.

const PORT = Number(process.env.PORT ?? 5000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/global-setup.ts",
  // The dev server is single-process / shared state — keep workers serial
  // so Supabase test users don't race each other.
  workers: 1,
  fullyParallel: false,
  // The first Next.js compile of /settings can take 30+ seconds in dev
  // mode under Turbopack; bump the per-test timeout accordingly.
  timeout: 120_000,
  expect: { timeout: 15_000 },
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
          ? { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
