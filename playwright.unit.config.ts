// Fast Playwright config for pure-function unit tests under tests/unit/.
//
// Key differences from playwright.e2e.config.ts:
//   - No `webServer`: unit tests are pure TypeScript/JS — they don't need a
//     running Next.js server, so we skip the 30-60 s cold-compile entirely.
//   - No `globalSetup`: no Supabase test users need to be provisioned.
//   - Many workers + fullyParallel: unit tests are CPU-bound, not I/O-bound,
//     so we can saturate all available cores safely.
//
// Running this config first (before the e2e suite) means a breaking change
// in a pure-function — evaluation logic, ICR math, translation keys, etc. —
// fails within ~10 s rather than waiting for a browser + server to boot.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/unit",
  // No webServer, no globalSetup — unit tests are self-contained.
  workers: "50%",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    headless: true,
  },
  // No projects needed — unit tests don't require browser emulation. Using
  // the default (no projects key) runs all tests once in the default context,
  // which for unit tests means plain Node.js via Playwright's runner.
});
