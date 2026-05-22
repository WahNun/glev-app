// End-to-end test for IOB peak popover → dose row → Entries deep-link (Task #500).
//
// What & why:
//   Task #499 added a chevron to meal-sourced dose rows in the IOB peak
//   popover. Tapping a meal row navigates to `/entries#<mealId>`, which
//   triggers the hash deep-link handler on the Entries page to auto-expand
//   and scroll to that entry. This spec is the first automated gate
//   verifying the full user-visible path:
//
//     Dashboard → IOB peak pill → dose row tap → Entries expanded entry
//
// Test data strategy:
//   We seed a synthetic meal row (via the admin/service-role Supabase
//   client) with `insulin_units: 8` and `meal_time: ~60 minutes ago`.
//   That produces ~3.6 IE of active IOB, which buildIOBHistory samples
//   into an unambiguous local maximum (peak) in the 24-hour window.
//   The peak pill appears in the IOBHistoryChart, and the dose row in
//   the popover carries `mealId` equal to our seeded meal's UUID.
//
//   We clean up the seeded row in afterAll so subsequent runs start clean.
//
// Assertions:
//   1. The peak pill button is visible in the IOB history chart.
//   2. Clicking it opens the popover with a dose row that has role="link".
//   3. Clicking the dose row navigates to `/entries#<mealId>`.
//   4. The Entries page renders the expanded entry element for that meal.
//
// What this does NOT test (and why):
//   • The exact IOB value in the pill — that's covered by iobHistory unit tests.
//   • The navigation logic for manual-bolus rows (they have no mealId and
//     therefore no role="link" — confirmed by unit tests in iobPeaks.test.ts).

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "iob-dose-row-navigation spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── test data helpers ──────────────────────────────────────────────────────────

/** Insert a synthetic meal that has insulin_units set so it produces active IOB. */
async function seedMealWithInsulin(userId: string): Promise<string> {
  const admin = getAdminClient();
  // meal_time 60 min ago → IOB ≈ 3.6 IE for rapid insulin (well above detection threshold)
  const mealTime = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "IOB nav test meal",
      parsed_json: [],
      insulin_units: 8,
      carbs_grams: 60,
      meal_type: "BALANCED",
      meal_time: mealTime,
      created_at: mealTime,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to seed meal: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/** Delete the seeded test meal. Soft-fails so cleanup never breaks the run. */
async function deleteMeal(mealId: string) {
  try {
    const admin = getAdminClient();
    await admin.from("meals").delete().eq("id", mealId);
  } catch {
    /* cleanup failure is non-fatal */
  }
}

// ── login helper ───────────────────────────────────────────────────────────────

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

// ── spec ───────────────────────────────────────────────────────────────────────

test.describe("IOB peak popover → dose row → Entries deep-link", () => {
  let testUser: TestUser;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUser();
    mealId = await seedMealWithInsulin(testUser.userId);
  });

  test.afterAll(async () => {
    if (mealId) await deleteMeal(mealId);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("tapping a meal dose row opens the correct entry on the Entries page", async ({ page }) => {
    await loginAsTestUser(page);

    // ── 1. Locate the IOB history chart peak pill ──────────────────────────
    //
    // The peak pill is rendered as an SVG <g role="button"> (not an HTML
    // <button>) with an aria-label set by the iob_peak_label i18n key.
    // We target it via a CSS attribute selector on the SVG group element
    // instead of getByRole() + name-regex, because:
    //   (a) the aria-label embeds a locale-sensitive time string (may be
    //       "1:30 AM" in en-US vs "13:30" in de-DE) — making a reliable
    //       regex brittle, and
    //   (b) the 12h/24h window buttons are HTML <button> elements, so
    //       `svg g[role="button"]` unambiguously targets only peak pills.
    //
    // We wait for the chart to render active content first by polling for
    // the peak group to appear (the chart shows an empty-state placeholder
    // instead of the SVG when hasActivity is false).

    const peakPill = page.locator('svg g[role="button"]').first();

    await expect(peakPill).toBeAttached({ timeout: 30_000 });
    await peakPill.scrollIntoViewIfNeeded();
    await expect(peakPill).toBeVisible({ timeout: 10_000 });
    await peakPill.click();

    // ── 2. Popover opens: find the meal dose row ───────────────────────────
    //
    // Meal-sourced dose rows get role="link" (see IOBHistoryChart.tsx ~L397).
    // Manual bolus rows stay inert (no role attribute). We wait for at least
    // one such row to appear before clicking, which also implicitly verifies
    // criterion (a) — the chevron only exists on meal rows.

    const doseRow = page.getByRole("link").first();
    await expect(doseRow).toBeVisible({ timeout: 10_000 });

    // ── 3. Click the dose row — expect navigation to /entries#<mealId> ─────
    //
    // router.push(`/entries#${d.mealId}`) is called onClick. Next.js client
    // navigation updates the URL without a full reload, so we wait for the
    // URL to include both the path and the hash.

    await Promise.all([
      page.waitForURL(url => url.pathname === "/entries" && url.hash === `#${mealId}`, {
        timeout: 20_000,
      }),
      doseRow.click(),
    ]);

    // ── 4. Entries page: the target entry is expanded and visible ──────────
    //
    // The hash deep-link useEffect (entries/page.tsx ~L596) calls
    // setExpanded(id) and scrolls to `document.getElementById("entry-${id}")`.
    // We assert that element exists in the DOM and is visible.

    const entryEl = page.locator(`#entry-${mealId}`);
    await expect(entryEl).toBeVisible({ timeout: 20_000 });

    // Confirm the page actually loaded meals before asserting expanded state.
    // "IOB nav test meal" is the input_text we seeded, which the expanded view
    // renders as the entry title — matching it proves we see *our* entry, not
    // a stale hash artifact.
    await expect(entryEl).toContainText("IOB nav test meal", { timeout: 10_000 });
  });
});
