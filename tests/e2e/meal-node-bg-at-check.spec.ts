// End-to-end smoke test: glucose badge and sensor dot on meal-node-cluster
// knobs (Task #734).
//
// Why this exists:
//   Task #702 added the `bg_at_check` value badge (rect + text overlay) and
//   sensor indicator dot to each knob in `MealNodeCluster`. There was no
//   automated check that the badge actually appears when `bg_at_check` is set
//   and stays absent when it is null. A regression in the `hasBg` guard, the
//   SVG conditional render, or the `data-bg-at-check` attribute write would
//   be invisible until a user opened the dashboard with a filled checkpoint.
//
// What this asserts:
//   1. Seeds a meal (within the last 2h, with insulin so it qualifies as a
//      bolus meal on the 12h chart) and a `meal_timeline_checks` row with
//      `bg_at_check = 112` for check_type "post_1".
//   2. Leaves the "pre" arm unseeded so its `bgAtCheck` stays null.
//   3. After login + dashboard load, finds the cluster by testid and:
//      a. Asserts the post_1 knob has `data-bg-at-check="112"`.
//      b. Asserts the SVG text "112" (the badge label) is visible.
//      c. Asserts the pre knob does NOT have a `data-bg-at-check` attribute
//         (null → badge absent).
//
// Seeding uses the Supabase service-role admin client (same pattern as
// `confirm-action-timeline-check.spec.ts`) and is cleaned up in afterAll.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
      "meal-node-bg-at-check spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Insert a minimal meal row that qualifies as a "bolus meal" on the 12h chart:
 * - `meal_time` is 1 hour ago (inside the 12h window)
 * - `insulin_units = 4` (non-null, > 0 → bolusMeals filter includes it)
 */
async function seedMeal(admin: SupabaseClient, userId: string): Promise<string> {
  const mealTime = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "e2e bg_at_check test meal",
      parsed_json: [],
      meal_time: mealTime,
      glucose_before: null,
      glucose_after: null,
      carbs_grams: 50,
      protein_grams: null,
      fat_grams: null,
      insulin_units: 4,
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
 * Insert a `meal_timeline_checks` row for the given meal with
 * `bg_at_check = 112` and `check_type = "post_1"`.
 * Returns the inserted row id.
 */
async function seedCheckWithBg(
  admin: SupabaseClient,
  userId: string,
  mealId: string,
): Promise<string> {
  const plannedAt = new Date(Date.now() + 30 * 60_000).toISOString(); // 30 min in the future
  const { data, error } = await admin
    .from("meal_timeline_checks")
    .insert({
      user_id: userId,
      meal_id: mealId,
      check_type: "post_1",
      planned_at: plannedAt,
      confirmed_at: null,
      bg_at_check: 112,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`meal_timeline_checks seed failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

async function cleanup(
  admin: SupabaseClient,
  mealId: string,
) {
  // meal_timeline_checks has FK → meals (ON DELETE CASCADE), so deleting
  // the meal also removes its timeline rows. We still delete explicitly
  // first in case a future migration drops the CASCADE.
  await admin.from("meal_timeline_checks").delete().eq("meal_id", mealId);
  await admin.from("meals").delete().eq("id", mealId);
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

test.describe("MealNodeCluster — bg_at_check badge and sensor dot (e2e)", () => {
  let testUser: TestUser;
  let admin: SupabaseClient;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUser();
    admin = getAdminClient();
    mealId = await seedMeal(admin, testUser.userId);
    await seedCheckWithBg(admin, testUser.userId, mealId);
  });

  test.afterAll(async () => {
    if (admin && mealId) {
      await cleanup(admin, mealId);
    }
  });

  test("post_1 knob carries data-bg-at-check and badge text; pre knob has neither", async ({
    page,
  }) => {
    await loginAsTestUser(page);

    // Wait for the cluster to appear. The cluster renders inside the SVG
    // overlay on the 12h glucose chart only after the chart has measured
    // its dimensions and `listChecksForMeals` has resolved. We poll with
    // a generous timeout to survive Next.js dev-mode cold compile.
    const clusterGroup = page.locator(
      `[data-testid="meal-node-cluster-${mealId}"]`,
    );
    await expect(clusterGroup).toBeVisible({ timeout: 60_000 });

    // ── post_1 arm: data-bg-at-check attribute ──────────────────────────
    // The knob circle carries `data-bg-at-check={a.bgAtCheck ?? undefined}`.
    // When bg_at_check = 112, this attribute must be present with value "112".
    const post1Knob = page.locator(
      `[data-testid="meal-node-arm-${mealId}-post_1"]`,
    );
    await expect(post1Knob).toBeVisible({ timeout: 30_000 });
    await expect(post1Knob).toHaveAttribute("data-bg-at-check", "112");

    // ── post_1 arm: badge text "112" visible in the SVG ────────────────
    // The badge renders as <rect> + <text>112</text> inside the cluster's
    // <g>. We locate the SVG <text> element with the value inside the
    // cluster group (not the invisible <title> but the visible text node).
    const badgeText = clusterGroup.locator("text").filter({ hasText: /^112$/ });
    await expect(badgeText).toBeVisible();

    // ── pre arm: no data-bg-at-check attribute ──────────────────────────
    // We seeded only a post_1 row. The pre arm defaults to bgAtCheck: null,
    // so data-bg-at-check must NOT be present on the pre knob.
    const preKnob = page.locator(
      `[data-testid="meal-node-arm-${mealId}-pre"]`,
    );
    await expect(preKnob).toBeVisible({ timeout: 30_000 });
    // Playwright's `not.toHaveAttribute` fails if the attribute exists with
    // any value — exactly what we want here.
    await expect(preKnob).not.toHaveAttribute("data-bg-at-check", /.*/);
  });
});
