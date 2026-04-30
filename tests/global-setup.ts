// Runs once before the Playwright test suite starts. Provisions the
// shared Supabase test user and stashes the credentials in a JSON file
// under `tests/.cache/` for the specs to read. Keeping this in a global
// setup (rather than in `beforeAll`) means we hit the Supabase admin
// API exactly once per `npm test` run, even if more specs are added.

import fs from "node:fs";
import path from "node:path";
import { provisionTestUser } from "./support/testUser";

export const TEST_USER_FIXTURE_PATH = path.join(
  __dirname,
  ".cache",
  "test-user.json",
);

export default async function globalSetup() {
  const creds = await provisionTestUser();
  fs.mkdirSync(path.dirname(TEST_USER_FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(TEST_USER_FIXTURE_PATH, JSON.stringify(creds, null, 2), "utf8");
}
