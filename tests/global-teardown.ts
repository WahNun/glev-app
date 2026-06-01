// Runs once after the full Playwright e2e suite finishes.
// Deletes all `playwright-e2e-*@glev.test` users from Supabase so they
// never appear in the production user list.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USERS_FIXTURE_PATH } from "./support/testUser";

export default async function globalTeardown() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !key) {
    console.warn("[teardown] SUPABASE_URL/SERVICE_ROLE_KEY not set — skipping test-user cleanup");
    return;
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Collect IDs from the fixture file (fastest path — no list API call needed).
  const ids: string[] = [];
  try {
    const raw = fs.readFileSync(TEST_USERS_FIXTURE_PATH, "utf8");
    const users = JSON.parse(raw) as Array<{ userId: string }>;
    ids.push(...users.map((u) => u.userId));
  } catch {
    // Fixture missing — fall back to listing by email pattern.
  }

  // Fallback: find any remaining @glev.test accounts via listUsers.
  if (ids.length === 0) {
    const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const test = (data?.users ?? []).filter((u) =>
      u.email?.endsWith("@glev.test"),
    );
    ids.push(...test.map((u) => u.id));
  }

  if (ids.length === 0) {
    console.log("[teardown] no test users to delete");
    return;
  }

  const results = await Promise.all(ids.map((id) => sb.auth.admin.deleteUser(id)));
  results.forEach((r, i) => {
    if (r.error) {
      console.warn(`[teardown] could not delete ${ids[i]}: ${r.error.message}`);
    } else {
      console.log(`[teardown] deleted test user ${ids[i]}`);
    }
  });

  // Clean up fixture file.
  try {
    fs.unlinkSync(TEST_USERS_FIXTURE_PATH);
  } catch {
    /* ignore */
  }
}
