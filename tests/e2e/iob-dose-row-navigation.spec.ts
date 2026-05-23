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

  test("tapping a meal dose row opens the correct entry on the Entries page (24h window)", async ({ page }) => {
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

  test("tapping a meal dose row in the 12h window navigates to the correct Entries entry", async ({ page }) => {
    // ── Purpose ──────────────────────────────────────────────────────────────
    //
    // A regression where the dose-row click handler breaks *only* when the 12h
    // window is active (e.g. an event-propagation bug introduced by the window-
    // switch re-render) would be invisible to the 24h test above.  This test
    // guards the full navigation path after the user switches to the 12h view.
    //
    // Steps:
    //   1. Log in and clear the stale localStorage window preference.
    //   2. Switch to the 12h window via the toggle button.
    //   3. Open the peak pill popover.
    //   4. Click the meal dose row.
    //   5. Assert URL → /entries#<mealId> and that the entry is expanded.

    await loginAsTestUser(page);

    // ── 1. Clear any stored window preference so state is deterministic ──────
    //
    // localStorage is origin-scoped and not cleared by context.clearCookies().
    // Remove the key so the component starts at its real default (24h), giving
    // us a clean baseline before we click "12h".
    await page.evaluate(() => localStorage.removeItem("glev:iob_history_hours"));
    await page.reload({ waitUntil: "networkidle" });

    // ── 2. Wait for the SVG chart to show active content ─────────────────────
    //
    // The polyline is only rendered when `hasActivity` is true.  Our seeded
    // meal (8 IE, 60 min ago) guarantees at least one non-zero IOB sample.
    const polyline = page.locator("svg polyline").first();
    await expect(polyline).toBeAttached({ timeout: 30_000 });
    await polyline.scrollIntoViewIfNeeded();
    await expect(polyline).toBeVisible({ timeout: 10_000 });

    // ── 3. Switch to the 12h window ──────────────────────────────────────────
    //
    // The toggle button renders "{opt}\u00A0h" (non-breaking space), so a
    // relaxed /12/ regex is the safest match.
    const btn12 = page.getByRole("button", { name: /12/ }).first();
    await expect(btn12).toBeVisible({ timeout: 10_000 });
    await btn12.click();

    // Confirm the button is now active (font-weight 700) before proceeding.
    await expect(btn12).toHaveCSS("font-weight", "700", { timeout: 3_000 });

    // ── 4. Locate the peak pill and open the popover ──────────────────────────
    //
    // Peak pills are SVG <g role="button"> elements — unambiguously distinct
    // from the HTML <button> toggle elements.  The 12h window still includes
    // our seeded meal (60 min ago), so at least one pill must be visible.
    const peakPill = page.locator('svg g[role="button"]').first();
    await expect(peakPill).toBeAttached({ timeout: 15_000 });
    await expect(peakPill).toBeVisible({ timeout: 10_000 });
    await peakPill.click();

    // ── 5. Find the meal dose row in the popover ──────────────────────────────
    //
    // Meal-sourced rows receive role="link" (see IOBHistoryChart.tsx ~L430).
    // Manual bolus rows are inert.  At least one link row must appear because
    // the only active dose comes from our seeded meal.
    const doseRow = page.getByRole("link").first();
    await expect(doseRow).toBeVisible({ timeout: 10_000 });

    // ── 6. Click the dose row — assert navigation to /entries#<mealId> ────────
    //
    // router.push(`/entries#${d.mealId}`) is called onClick inside the
    // foreignObject click handler.  We wait for the URL to match both path
    // and hash simultaneously.
    await Promise.all([
      page.waitForURL(url => url.pathname === "/entries" && url.hash === `#${mealId}`, {
        timeout: 20_000,
      }),
      doseRow.click(),
    ]);

    // ── 7. Entries page: the target entry is expanded and visible ─────────────
    //
    // The hash deep-link useEffect sets the entry expanded and scrolls to
    // `#entry-<id>`.  We assert the element is visible and shows our seeded
    // meal's input_text as the title.
    const entryEl = page.locator(`#entry-${mealId}`);
    await expect(entryEl).toBeVisible({ timeout: 20_000 });
    await expect(entryEl).toContainText("IOB nav test meal", { timeout: 10_000 });
  });
});
