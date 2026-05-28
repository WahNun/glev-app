// End-to-end guard for the "insulin cluster always above recents" fix (Task #618).
//
// Why this exists:
//   When a user's saved `dashboard_card_order` in `user_preferences` was
//   written before the "insulin" cluster existed, it will not contain
//   "insulin". The `newClusters` loop in `app/(protected)/dashboard/page.tsx`
//   (lines ~894-907) handles exactly this case: instead of appending the
//   "insulin" cluster at the very end (which would put the IOB card _below_
//   Recent Entries), it inserts "insulin" immediately before "recents".
//
//   Without this test, a refactor of the `newClusters` loop could silently
//   undo the fix and users would again see the IOB / Active Insulin section
//   beneath Recent Entries.
//
// What this asserts:
//   1. The test seeds `dashboard_card_order` with the pre-fix legacy list
//      (["glucose", "metabolic", "control", "recents"] — no "insulin").
//   2. The dashboard is loaded in that state.
//   3. The "Insulin & IOB" section's top y-coordinate is strictly less than
//      the "Recents / Zuletzt" section's top y-coordinate — i.e. it renders
//      above it in the viewport.
//
// We use the Supabase service-role client to write directly to
// `user_preferences`, matching the pattern used in
// `dashboard-cluster-reorder.spec.ts`.

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "dashboard-insulin-cluster-position spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Write a `dashboard_card_order` that pre-dates the "insulin" cluster — this
 * simulates an existing user whose preference was saved before the IOB section
 * was introduced. The "insulin" cluster will be treated as a "new" cluster by
 * the `newClusters` loop and must be inserted before "recents".
 */
async function seedLegacyOrder(userId: string) {
  const admin = getAdminClient();
  const legacyOrder = ["glucose", "metabolic", "control", "recents"];
  const { error } = await admin
    .from("user_preferences")
    .upsert(
      { user_id: userId, dashboard_card_order: legacyOrder },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`Failed to seed legacy dashboard_card_order: ${error.message}`);
  }
}

/**
 * Remove the user's `user_preferences` row so other specs that rely on default
 * order are not surprised by the legacy order left behind by this test.
 */
async function cleanupPreferences(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_preferences")
    .delete()
    .eq("user_id", userId);
  if (error && !/does not exist|could not find the table/i.test(error.message)) {
    throw new Error(`user_preferences cleanup failed: ${error.message}`);
  }
}

async function loginAsTestUser(page: Page, workerIndex: number) {
  const { email, password } = loadTestUserByIndex(workerIndex);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/**
 * Return the top y-coordinate of the section whose `<h2>` heading matches
 * `nameRe`. Waits for the section to be visible before measuring.
 */
async function getSectionTop(page: Page, nameRe: RegExp): Promise<number> {
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: nameRe }),
  });
  await expect(section).toBeVisible({ timeout: 30_000 });
  const box = await section.boundingBox();
  if (!box) throw new Error(`Section matching ${nameRe} has no bounding box`);
  return box.y;
}

// Both "Insulin & IOB" translations are identical (de and en share the same
// string), but we use a regex for consistency with the locale-agnostic pattern
// used across the other dashboard specs.
const INSULIN_CLUSTER_RE = /^Insulin & IOB$/;
// "Recents" in English, "Zuletzt" in German — match both.
const RECENTS_CLUSTER_RE = /^(Recents|Zuletzt)$/;

test.describe("Dashboard insulin cluster position", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await seedLegacyOrder(testUser.userId);
  });

  test.afterAll(async () => {
    await cleanupPreferences(testUser.userId);
  });

  test("'Insulin & IOB' cluster appears above 'Recents' when missing from saved order", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Wait until the dashboard has hydrated enough that both clusters are
    // visible. We poll the positions because `useCardOrder`'s GET resolves
    // asynchronously after the first paint (the default order is applied on
    // the client once the /api/preferences response arrives).
    const insulinTop = await getSectionTop(page, INSULIN_CLUSTER_RE);
    const recentsTop = await getSectionTop(page, RECENTS_CLUSTER_RE);

    expect(
      insulinTop,
      `"Insulin & IOB" cluster (y=${insulinTop}) must appear above "Recents" (y=${recentsTop})`,
    ).toBeLessThan(recentsTop);
  });
});
