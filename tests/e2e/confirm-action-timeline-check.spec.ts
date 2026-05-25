// End-to-end coverage for POST /api/ai/confirm-action with
// kind="add_timeline_check" (Task #705).
//
// Why this exists:
//   Task #691 added the `add_timeline_check` executor and the
//   confirm-action route handler. The unit tests in
//   `tests/unit/addTimelineCheck.test.ts` (and the new handler-level
//   tests in `tests/unit/confirmActionTimelineCheck.test.ts`) verify
//   the logic with mock Supabase clients, but they cannot prove that
//   the full HTTP flow — authentication, pending_action lifecycle, and
//   the actual DB write — works end-to-end against a real Supabase
//   instance. This spec does exactly that.
//
// What this asserts:
//   1. Seeding — a real `meals` row and an `ai_pending_actions` row
//      are inserted for the test user via the service-role admin
//      client (same pattern as `last-appointment.spec.ts`).
//   2. HTTP flow — an authenticated POST to /api/ai/confirm-action
//      (using `page.request` which carries the browser session's
//      auth cookies) returns HTTP 200 with { ok: true }.
//   3. Response shape — `insertedId` is a valid UUID and
//      `scheduleReminder.mealId` matches the seeded meal's ID.
//   4. DB persistence — a `meal_timeline_checks` row actually exists
//      in Supabase after the call, with the correct `meal_id`,
//      `check_type`, `planned_at`, non-null `confirmed_at`, and
//      `user_id`. The admin client verifies this without relying on
//      the route's own response.
//   5. Idempotency guard — re-sending the same token returns HTTP 409
//      ("already confirmed") and does NOT create a second row.
//
// We drive the endpoint via `page.request.post()` (authenticated via
// the browser session's cookies) rather than the bare `request`
// fixture (which is unauthenticated) because the route calls
// `authedClient(req)` and returns 401 without a valid session cookie.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "confirm-action-timeline-check spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── UUID regex ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Insert a minimal meals row for the test user and return its id.
 * We keep carbs/insulin/type to their simplest valid values — the
 * timeline-check route only uses the meal_id for RLS verification
 * in the executor; by the time confirm-action runs the meal_id just
 * needs to exist in the params envelope.
 */
async function seedMeal(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "e2e-confirm-action test meal",
      parsed_json: [],
      glucose_before: null,
      glucose_after: null,
      carbs_grams: 40,
      protein_grams: null,
      fat_grams: null,
      insulin_units: null,
      meal_type: "BALANCED",
      evaluation: null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`meals seed failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/**
 * Insert an ai_pending_actions row for kind="add_timeline_check".
 * The token is a random string — no signature is required; the route
 * only looks up by token equality in the user's own rows (RLS).
 * expires_at is set 10 minutes in the future so it passes the TTL
 * check in handleConfirmPost.
 */
async function seedPendingAction(
  admin: SupabaseClient,
  userId: string,
  mealId: string,
  token: string,
  plannedAt: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error } = await admin
    .from("ai_pending_actions")
    .insert({
      token,
      user_id: userId,
      kind: "add_timeline_check",
      params: {
        meal_id: mealId,
        meal_label: "e2e test Bolognese",
        check_type: "post_1",
        planned_at: plannedAt,
      },
      summary: "Post-Check für e2e test Bolognese",
      expires_at: expiresAt,
      used_at: null,
    });
  if (error) {
    throw new Error(`ai_pending_actions seed failed: ${error.message}`);
  }
}

/**
 * Read the meal_timeline_checks row for (userId, mealId, "post_1")
 * via the service-role admin client, bypassing RLS.
 */
async function readTimelineCheckRow(
  admin: SupabaseClient,
  userId: string,
  mealId: string,
): Promise<{
  id: string;
  meal_id: string;
  check_type: string;
  planned_at: string;
  confirmed_at: string | null;
  user_id: string;
} | null> {
  const { data, error } = await admin
    .from("meal_timeline_checks")
    .select("id,meal_id,check_type,planned_at,confirmed_at,user_id")
    .eq("user_id", userId)
    .eq("meal_id", mealId)
    .eq("check_type", "post_1")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`meal_timeline_checks read failed: ${error.message}`);
  }
  return data as typeof data & null;
}

/** Remove all test artefacts so each test starts from a clean baseline. */
async function cleanup(admin: SupabaseClient, userId: string, mealId: string, token: string) {
  // Order matters: meal_timeline_checks has FK → meals.
  await admin.from("meal_timeline_checks").delete().eq("meal_id", mealId);
  await admin.from("ai_pending_actions").delete().eq("token", token);
  await admin.from("meals").delete().eq("id", mealId);
  // Also clear any stale timeline rows for the test user that a previous
  // aborted run might have left (defensive — won't fail if table is empty).
  await admin
    .from("meal_timeline_checks")
    .delete()
    .eq("user_id", userId)
    .like("meal_id", "00000000-%"); // narrow to clearly-test-only ids
}

async function loginAsTestUser(page: Page) {
  const { email, password } = loadTestUser();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("POST /api/ai/confirm-action — kind=add_timeline_check (e2e)", () => {
  let testUser: TestUser;
  let admin: SupabaseClient;
  let mealId: string;
  // Token must be a UUID — the ai_pending_actions.token column is uuid type.
  // Generated once per describe block; each beforeEach re-inserts the row
  // with this same token after deleting any prior copy.
  const TEST_TOKEN = randomUUID();
  // planned_at ~90 min in the future — comfortably in the future so
  // the route's TTL check passes and the reminder payload carries it
  // through to the response.
  const PLANNED_AT = new Date(Date.now() + 90 * 60_000).toISOString();

  test.beforeAll(async () => {
    testUser = loadTestUser();
    admin = getAdminClient();
    // Seed the test meal once for all tests in this suite.
    mealId = await seedMeal(admin, testUser.userId);
  });

  test.beforeEach(async () => {
    // Re-seed the pending_action row before each test so each test
    // gets a fresh, unclaimed token. We delete any prior row with the
    // same token first (idempotent).
    await admin.from("ai_pending_actions").delete().eq("token", TEST_TOKEN);
    await admin.from("meal_timeline_checks").delete().eq("meal_id", mealId);
    await seedPendingAction(admin, testUser.userId, mealId, TEST_TOKEN, PLANNED_AT);
  });

  test.afterAll(async () => {
    if (admin && mealId) {
      await cleanup(admin, testUser.userId, mealId, TEST_TOKEN);
    }
  });

  // ── 1. Full happy-path ─────────────────────────────────────────────────

  test("happy path: HTTP 200, ok=true, UUID insertedId, scheduleReminder with correct mealId", async ({
    page,
  }) => {
    await loginAsTestUser(page);

    // Make the authenticated API call using the browser session's cookies.
    const res = await page.request.post("/api/ai/confirm-action", {
      data: { token: TEST_TOKEN },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      kind: string;
      insertedId?: string;
      scheduleReminder?: {
        mealId: string;
        checkType: string;
        plannedAt: string;
        title: string;
        body: string;
      };
    };

    // ── Response shape ─────────────────────────────────────────────
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("add_timeline_check");

    // insertedId must be a valid UUID
    expect(typeof body.insertedId).toBe("string");
    expect(body.insertedId).toMatch(UUID_RE);

    // scheduleReminder must match the seeded params
    expect(body.scheduleReminder).toBeDefined();
    expect(body.scheduleReminder?.mealId).toBe(mealId);
    expect(body.scheduleReminder?.checkType).toBe("post_1");
    expect(body.scheduleReminder?.plannedAt).toBe(PLANNED_AT);
    expect(body.scheduleReminder?.title).toContain("Post-Bolus-Check");
    expect(body.scheduleReminder?.body).toContain("e2e test Bolognese");
  });

  // ── 2. DB persistence ──────────────────────────────────────────────────

  test("DB persistence: meal_timeline_checks row has correct meal_id, check_type, planned_at, confirmed_at, user_id", async ({
    page,
  }) => {
    await loginAsTestUser(page);

    const before = new Date().toISOString();
    const res = await page.request.post("/api/ai/confirm-action", {
      data: { token: TEST_TOKEN },
      headers: { "Content-Type": "application/json" },
    });
    const after = new Date().toISOString();
    expect(res.status()).toBe(200);

    // Poll until the row appears — the route writes it synchronously,
    // but a brief poll avoids any clock-skew flakiness.
    const row = await (async () => {
      for (let i = 0; i < 10; i++) {
        const r = await readTimelineCheckRow(admin, testUser.userId, mealId);
        if (r) return r;
        await new Promise((ok) => setTimeout(ok, 300));
      }
      return null;
    })();

    expect(row).not.toBeNull();
    expect(row?.meal_id).toBe(mealId);
    expect(row?.check_type).toBe("post_1");
    // Supabase may return timestamps as "...+00:00" instead of "...Z";
    // normalise both sides via Date to avoid a string-format mismatch.
    expect(new Date(row?.planned_at ?? "").getTime()).toBe(
      new Date(PLANNED_AT).getTime(),
    );
    expect(row?.user_id).toBe(testUser.userId);

    // confirmed_at must be a valid ISO timestamp set during this request
    expect(row?.confirmed_at).not.toBeNull();
    const confirmedAt = row?.confirmed_at ?? "";
    expect(confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Supabase stores with timezone; convert to comparable ISO strings
    const confirmedMs = new Date(confirmedAt).getTime();
    expect(confirmedMs).toBeGreaterThanOrEqual(new Date(before).getTime() - 2000);
    expect(confirmedMs).toBeLessThanOrEqual(new Date(after).getTime() + 2000);
  });

  // ── 3. Idempotency guard (409 on re-use) ──────────────────────────────

  test("idempotency: re-sending the same token returns 409 and no duplicate row", async ({
    page,
  }) => {
    await loginAsTestUser(page);

    // First call — must succeed
    const first = await page.request.post("/api/ai/confirm-action", {
      data: { token: TEST_TOKEN },
      headers: { "Content-Type": "application/json" },
    });
    expect(first.status()).toBe(200);

    // Second call with the same token — must be rejected
    const second = await page.request.post("/api/ai/confirm-action", {
      data: { token: TEST_TOKEN },
      headers: { "Content-Type": "application/json" },
    });
    expect(second.status()).toBe(409);
    const secondBody = (await second.json()) as { ok?: boolean; error?: string };
    expect(secondBody.ok).toBe(false);
    expect(secondBody.error).toMatch(/already confirmed/i);

    // Still only one meal_timeline_checks row exists
    const { data: allRows, error: selErr } = await admin
      .from("meal_timeline_checks")
      .select("id")
      .eq("user_id", testUser.userId)
      .eq("meal_id", mealId)
      .eq("check_type", "post_1");
    if (selErr) throw new Error(selErr.message);
    expect((allRows ?? []).length).toBe(1);
  });

  // ── 4. Missing token → 400 ─────────────────────────────────────────────

  test("missing token returns 400 without creating any DB row", async ({
    page,
  }) => {
    await loginAsTestUser(page);

    const res = await page.request.post("/api/ai/confirm-action", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/token/i);

    // No timeline-check row should have been written
    const row = await readTimelineCheckRow(admin, testUser.userId, mealId);
    expect(row).toBeNull();
  });

  // ── 5. Unknown token → 404 ─────────────────────────────────────────────

  test("unknown token returns 404", async ({ page }) => {
    await loginAsTestUser(page);

    const res = await page.request.post("/api/ai/confirm-action", {
      data: { token: "does-not-exist-at-all" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/not found/i);
  });
});
