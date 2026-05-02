// Shared helpers for provisioning a Supabase test user used by the
// Playwright suite.
//
// We don't ship a fixed test account in the repo (that would leak a real
// credential and risk colliding with production data). Instead we use the
// service-role key that's already in the dev env to create — or reset
// the password of — a dedicated `playwright-*@glev.test` user on demand.
// The local `.test` TLD is non-routable, so even if Supabase tries to
// send a confirmation email it goes nowhere; we mark `email_confirm: true`
// so the user can sign in straight away.
//
// Pattern: a single global setup creates the user once per `npm test`
// run and writes the credentials into a JSON file under `tests/.cache/`
// so individual specs don't have to re-provision.

import { createClient } from "@supabase/supabase-js";

export interface TestUserCredentials {
  email: string;
  password: string;
  userId: string;
}

const TEST_USER_EMAIL = "playwright-theme@glev.test";
// Random per-run password keeps stale sessions from accidentally leaking
// between unrelated test runs / dev work.
function randomPassword(): string {
  // 24 hex chars = 96 bits of entropy — plenty for a throwaway test user.
  return "Pw_" + Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("") + "!1Aa";
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Cannot provision Playwright test user: SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set in the environment.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create the test user if it doesn't exist, or reset its password if it
 * does. Returns the credentials the test should use to sign in.
 */
export async function provisionTestUser(): Promise<TestUserCredentials> {
  const admin = getAdminClient();
  const password = randomPassword();

  // listUsers paginates; with the unique `@glev.test` suffix the test
  // user almost always lands on page 1, but be defensive and walk pages
  // until we find it (or run out).
  async function findUserId(): Promise<string | null> {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      const hit = data.users.find(u => u.email?.toLowerCase() === TEST_USER_EMAIL);
      if (hit) return hit.id;
      if (data.users.length < 200) return null;
    }
    return null;
  }

  const existingId = await findUserId();

  let userId: string;
  if (existingId) {
    const { error } = await admin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);
    userId = existingId;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed: ${error?.message ?? "no user returned"}`);
    }
    userId = data.user.id;
  }

  // Pre-clear the onboarding gate for the test user. Without this, the
  // protected-layout gate added on 2026-05-02 redirects every newly
  // provisioned playwright user to /onboarding before they can reach
  // /dashboard or /settings — breaking specs that drive through real
  // login. Service-role client bypasses RLS so this works even when
  // the profiles row doesn't exist yet (insert on conflict do update).
  // Soft-fails: if the migration hasn't been applied in the test env
  // we still let the run proceed (the gate itself is also soft-fail).
  try {
    await admin.from("profiles").upsert(
      { user_id: userId, onboarding_completed_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  } catch {
    /* ignore — see comment above */
  }

  return { email: TEST_USER_EMAIL, password, userId };
}
