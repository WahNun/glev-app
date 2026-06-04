// Runs once before the Playwright e2e test suite starts. Provisions one
// Supabase test user per parallel worker and stashes the credentials in a
// JSON array under `tests/.cache/` for specs to read via loadTestUserByIndex().
//
// Keeping provisioning in a global setup (rather than in `beforeAll`) means
// we hit the Supabase admin API exactly once per `npm test` run, even if
// more specs are added.

import fs from "node:fs";
import path from "node:path";
import {
  provisionTestUsers,
  TEST_USERS_FIXTURE_PATH,
} from "./support/testUser";

// Legacy single-user fixture path — kept so that any code still importing
// TEST_USER_FIXTURE_PATH continues to work. It always points to the first
// (worker-0) user.
export const TEST_USER_FIXTURE_PATH = path.join(
  __dirname,
  ".cache",
  "test-user.json",
);

// Number of parallel e2e workers. Must match the `workers` setting in
// playwright.e2e.config.ts so every worker slot gets its own Supabase user.
const E2E_WORKER_COUNT = 2;

export default async function globalSetup() {
  // Pure-unit suites (e.g. the *TranslationKeys.test.ts files run by the
  // "Translation key checks" workflow) import JSON / pure functions directly —
  // no dev server, no logged-in user. They run with PLAYWRIGHT_SKIP_WEBSERVER=1
  // (same flag that disables the webServer in playwright.config.ts). Skip the
  // Supabase test-user provisioning entirely for those runs so they don't
  // require SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. The full e2e suite does
  // NOT set this flag, so it still provisions normally.
  if (process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1") {
    return;
  }

  const users = await provisionTestUsers(E2E_WORKER_COUNT);

  fs.mkdirSync(path.dirname(TEST_USERS_FIXTURE_PATH), { recursive: true });

  // Write the full array so specs can pick by workerIndex.
  fs.writeFileSync(
    TEST_USERS_FIXTURE_PATH,
    JSON.stringify(users, null, 2),
    "utf8",
  );

  // Also write the first user as a single-object file for any legacy callers
  // that still read TEST_USER_FIXTURE_PATH directly.
  fs.writeFileSync(
    TEST_USER_FIXTURE_PATH,
    JSON.stringify(users[0], null, 2),
    "utf8",
  );
}
