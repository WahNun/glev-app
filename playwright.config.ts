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
  // Widened from `./tests/e2e` so the runner also picks up the
  // pure-function unit suites under `./tests/unit/*.test.ts` (no
  // browser involvement, no dev-server dependency). The default
  // Playwright `testMatch` already covers both `*.spec.ts` and
  // `*.test.ts`, so no extra config is needed here. Support files
  // under `./tests/support/` don't match either glob and are ignored.
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  // The dev server is single-process / shared state — keep workers serial
  // so Supabase test users don't race each other.
  workers: 1,
  fullyParallel: false,
  // The first Next.js compile of /settings can take 30+ seconds in dev
  // mode under Turbopack; bump the per-test timeout accordingly.
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    // Defaults for `toHaveScreenshot` so the marketing-mockup pixel
    // snapshots are stable across local + CI runs.
    //
    //   • `animations: "disabled"` pauses CSS animations + transitions
    //     and freezes them on the first frame, so e.g. the engine
    //     mic pulse (`@keyframes engVPulseM`) and the Verlauf row
    //     expand/collapse don't introduce per-run jitter.
    //   • `scale: "css"` captures at logical CSS pixels regardless of
    //     the host's devicePixelRatio (Replit dev container vs CI).
    //   • `threshold: 0.05` tightens the per-pixel YIQ color tolerance
    //     well below Playwright's lax 0.2 default. The default is so
    //     forgiving that a full red↔blue accent swap (#4F6EF7 → #FF0000)
    //     produces zero "different" pixels because the two colors have
    //     similar luminance in YIQ. 0.05 is strict enough to catch a
    //     real color regression while still tolerating the tiny YIQ
    //     wobble of identical pixels rendered through different
    //     compositor paths (Replit dev container vs CI).
    //   • `maxDiffPixelRatio: 0.01` then bounds the overall budget for
    //     sub-pixel anti-aliasing noise (gradient edges, text
    //     rasterization). A meaningful regression — a wrong gradient
    //     color, a layout shift, a clipped sparkline — touches far
    //     more than 1% of pixels (the broken-color experiment hit 21%).
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
          ? { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  // Boot the dev server (or reuse an existing one) for the e2e specs.
  // Pure-function unit suites under `tests/unit/` don't need the
  // server — the `PLAYWRIGHT_SKIP_WEBSERVER=1` escape hatch lets a
  // unit-only run skip the 60-90s Next.js cold-compile entirely.
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
