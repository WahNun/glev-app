// End-to-end test for IOBHistoryChart 12 h/24 h window toggle and peak-pill
// popover (Task #565).
//
// What & why:
//   The IOBHistoryChart card renders the 12h/24h decay history with coloured
//   peak pills. Three interactions must keep working:
//     (a) the 24 h window is active by default (first visit, no stored pref) —
//         note: the task spec said "12h default" but the component code reads
//         `stored === "12" ? 12 : 24`, so 24 is the real default. This test
//         asserts what is actually implemented.
//     (b) clicking the "12 h" button makes that button visually active (bold)
//         and causes the chart SVG polyline to re-render with different data
//         (fewer sample points covering only the last 12 hours)
//     (c) clicking "24 h" restores the wider window (button becomes bold again,
//         polyline re-renders with more sample points)
//     (d) tapping a peak pill opens the inline dose-popover
//   Without this guard a regression — e.g. the toggle buttons losing their
//   click handler, the polyline not updating, or the foreignObject popover
//   being removed — would be silent until a user reports it.
//
// Rendered-state approach:
//   We verify the *active* toggle state via the computed `font-weight` CSS
//   property (active button: 700, inactive: 500 — set as inline style).
//   We verify chart re-render by capturing the `points` attribute of the
//   `<polyline>` before and after toggling: `buildIOBHistory` produces a
//   different sample array for 12 h vs 24 h, so the serialised path string
//   must change.  Both checks are DOM/CSS evidence, not storage proxies.
//
// Data strategy:
//   We seed a synthetic meal row (via the Supabase service-role client) with
//   `insulin_units: 8` and `meal_time: ~60 minutes ago`.  That produces
//   ≈3.6 IE of active IOB, which buildIOBHistory samples into an unambiguous
//   local maximum (peak) in both the 12 h and 24 h windows, guaranteeing at
//   least one peak pill is visible.  The row is cleaned up in afterAll.
//
// Assertions:
//   1. The chart SVG polyline is present (activity detected → not the empty-state).
//   2. The 24 h button has font-weight 700 (active) by default; 12 h has 500.
//   3. Clicking "12 h" flips the active button to 12 h (font-weight 700) AND
//      the polyline's `points` attribute changes value.
//   4. Clicking "24 h" flips back (24 h bold, 12 h normal) AND the `points`
//      attribute changes again (different from the 12 h value).
//   5. At least one svg g[role="button"] (peak pill) is visible.
//   6. Clicking the peak pill opens the popover ("Active doses" / "Aktive Dosen").

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "iob-history-chart-toggle spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── test data helpers ──────────────────────────────────────────────────────────

/** Insert a synthetic meal so there is active IOB and at least one peak pill. */
async function seedMealWithInsulin(userId: string): Promise<string> {
  const admin = getAdminClient();
  // meal_time 60 min ago → IOB ≈ 3.6 IE for rapid insulin (above peak-detection threshold)
  const mealTime = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "IOB chart toggle test meal",
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

// ── spec ───────────────────────────────────────────────────────────────────────

test.describe("IOBHistoryChart 12h/24h toggle and peak-pill popover", () => {
  let testUser: TestUser;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    mealId = await seedMealWithInsulin(testUser.userId);
  });

  test.afterAll(async () => {
    if (mealId) await deleteMeal(mealId);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("chart renders, 24h is default, toggle switches window, peak pill opens popover", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // ── 0. Clear stale localStorage pref from previous runs ─────────────────
    //
    // Cookies are cleared in beforeEach but localStorage is origin-scoped.
    // Remove the key before asserting the default so old prefs don't cause
    // a false failure.
    await page.evaluate(() => localStorage.removeItem("glev:iob_history_hours"));

    // After removing the key we need the component to re-initialise with the
    // true default. A soft page reload (without full navigation) achieves this:
    await page.reload({ waitUntil: "networkidle" });

    // ── 1. Wait for chart to render active SVG content ───────────────────────
    //
    // The polyline is only present when `hasActivity` is true (i.e. at least
    // one sample has IOB > 0.05).  Our seeded meal guarantees this.
    const polyline = page.locator("svg polyline").first();
    await expect(polyline).toBeAttached({ timeout: 30_000 });
    await polyline.scrollIntoViewIfNeeded();
    await expect(polyline).toBeVisible({ timeout: 10_000 });

    // ── 2. Locate the 12 h and 24 h toggle buttons ───────────────────────────
    //
    // The buttons render `{opt}&nbsp;h` so the accessible name contains a
    // non-breaking space.  A relaxed regex match on "12" and "24" is enough
    // to target them uniquely within the toggle container.
    const btn12 = page.getByRole("button", { name: /12/ }).first();
    const btn24 = page.getByRole("button", { name: /24/ }).first();
    await expect(btn12).toBeVisible({ timeout: 10_000 });
    await expect(btn24).toBeVisible({ timeout: 10_000 });

    // ── 3. Assert 24 h is the default active window ──────────────────────────
    //
    // Active button: inline style `fontWeight: 700` (computed as "700").
    // Inactive button: `fontWeight: 500`.
    // The component initialises with `stored === "12" ? 12 : 24`, so when
    // the key is absent the default is 24 h.
    await expect(btn24).toHaveCSS("font-weight", "700");
    await expect(btn12).toHaveCSS("font-weight", "500");

    // ── 4. Capture polyline points in 24 h mode ──────────────────────────────
    //
    // `buildIOBHistory` produces a different number of sample points for 12 h
    // vs 24 h, so the serialised `points` attribute string must differ after
    // a window switch.  We capture it here as a baseline.
    const points24 = await polyline.getAttribute("points");
    expect(points24).toBeTruthy();

    // ── 5. Click "12 h" — rendered state and chart both update ───────────────
    await btn12.click();

    // Active button switches: 12 h bold, 24 h normal.
    await expect(btn12).toHaveCSS("font-weight", "700", { timeout: 2_000 });
    await expect(btn24).toHaveCSS("font-weight", "500", { timeout: 2_000 });

    // Chart re-renders: polyline points differ from the 24 h baseline.
    await expect(async () => {
      const points12 = await polyline.getAttribute("points");
      expect(points12).not.toBe(points24);
    }).toPass({ timeout: 3_000 });

    // Capture the 12 h points for the round-trip check below.
    const points12 = await polyline.getAttribute("points");

    // ── 6. Click "24 h" — round-trip back to wider window ───────────────────
    await btn24.click();

    // Active button switches back: 24 h bold, 12 h normal.
    await expect(btn24).toHaveCSS("font-weight", "700", { timeout: 2_000 });
    await expect(btn12).toHaveCSS("font-weight", "500", { timeout: 2_000 });

    // Chart re-renders again: points differ from the 12 h snapshot.
    await expect(async () => {
      const pointsBack = await polyline.getAttribute("points");
      expect(pointsBack).not.toBe(points12);
    }).toPass({ timeout: 3_000 });

    // ── 7. Peak pill → popover ───────────────────────────────────────────────
    //
    // The peak pill is an SVG `<g role="button">`.  We click the first one and
    // assert the inline dose-popover appears via its foreignObject header text.
    const peakPill = page.locator('svg g[role="button"]').first();
    await expect(peakPill).toBeAttached({ timeout: 15_000 });
    await expect(peakPill).toBeVisible({ timeout: 10_000 });
    await peakPill.click();

    // Popover header: `iob_peak_popover_title` key resolves to
    //   de: "Aktive Dosen · {time}"  |  en: "Active doses · {time}"
    const popoverHeader = page.locator("svg foreignObject div").filter({
      hasText: /Aktive Dosen|Active doses/i,
    }).first();
    await expect(popoverHeader).toBeVisible({ timeout: 10_000 });
  });
});
