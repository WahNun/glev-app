// End-to-end coverage for the per-window engine suggestion apply/keep
// buttons on the Insights page (Task #294, regression of Task #293).
//
// Background: the per-window suggestion pill ("Engine schlägt vor: 1:N
//   [Übernehmen] [Behalten]") sits inside the engine FlipCard. Before
//   Task #293 the click on Übernehmen / Behalten bubbled up to the
//   FlipCard and only flipped the card around — saveIcrSchedule was
//   never called and the dismiss state never updated. This spec locks
//   that bubble fix in place.
//
// Strategy:
//   * Seed an ICR schedule (master toggle on, single all-day slot
//     with manualIcr=10) plus 8 finalized meals + 8 explicitly-tagged
//     boluses giving a paired ratio of 60/4 = 15 g/u. That puts the
//     window at TUNED (sampleSize≥8) with learnedIcr=15, manualIcr=10
//     → drift 50% → Phase B5 suggestion pill renders.
//   * Open the windows section, locate the engine FlipCard via the
//     suggestion's Apply button, then assert aria-pressed stays "false"
//     across the click (i.e. the FlipCard did NOT flip).
//   * Apply test → asserts the manual-ICR text switches from "Du 1:10"
//     to "Du 1:15" (saveIcrSchedule round-tripped + setIcrSchedule
//     re-rendered) and the suggestion pill disappears.
//   * Keep test → asserts the suggestion pill disappears without
//     touching manualIcr (still "Du 1:10").

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "insights-window-suggestion-apply spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Hard-reset everything that could feed into computeAdaptiveICR for the
 *  test user so the seeded fixture is the only thing the engine sees. */
async function resetUserData(userId: string) {
  const admin = getAdminClient();
  const r1 = await admin.from("insulin_logs").delete().eq("user_id", userId);
  if (r1.error) throw new Error(`insulin_logs reset: ${r1.error.message}`);
  const r2 = await admin.from("meals").delete().eq("user_id", userId);
  if (r2.error) throw new Error(`meals reset: ${r2.error.message}`);
  const r3 = await admin.from("user_icr_schedule").delete().eq("user_id", userId);
  if (r3.error) throw new Error(`user_icr_schedule reset: ${r3.error.message}`);
}

/** Seed:
 *   * `user_settings.icr_schedule_enabled = true` + base ICR
 *   * one ICR schedule slot covering the full day at manualIcr=10
 *   * 8 finalized GOOD meals + 8 explicitly-tagged boluses, each
 *     ratio 60g / 4u → learnedIcr = 15
 *  Result: a TUNED window with manual=10, learned=15 → drift 50%
 *  → Phase B5 suggestion pill renders. */
async function seedTunedWindow(userId: string) {
  const admin = getAdminClient();

  // Master toggle + base ICR. The base ICR row has to exist (NOT NULL
  // CHECKs) for fetchIcrSchedule to flip the master toggle on.
  const us = await admin.from("user_settings").upsert(
    { user_id: userId, icr_g_per_unit: 10, icr_schedule_enabled: true },
    { onConflict: "user_id" },
  );
  if (us.error) throw new Error(`user_settings upsert: ${us.error.message}`);

  // Single all-day slot (start_minute === end_minute → covers full day,
  // see slotContainsMinute). manualIcr = 10.
  const sched = await admin.from("user_icr_schedule").upsert(
    [{
      user_id: userId,
      slot_index: 1,
      label: "Allzeit",
      start_minute: 0,
      end_minute: 0,
      icr_g_per_unit: 10,
      enabled: true,
    }],
    { onConflict: "user_id,slot_index" },
  );
  if (sched.error) throw new Error(`user_icr_schedule upsert: ${sched.error.message}`);

  // 8 finalized meals spread across 5 days back so they all clear the
  // 90-day engine cutoff and the lifecycle "final" gate. Each meal:
  // carbs 60g, glucose_before=100, bg_2h=110 (GOOD), paired bolus 4u
  // (ratio 15 g/u). meal.insulin_units left at 0 so the paired-bolus
  // sum is the source of truth.
  const baseMs = Date.now() - 5 * 86_400_000;
  const meals = Array.from({ length: 8 }, (_, i) => {
    const mealMs = baseMs + i * 3_600_000; // spread 1h apart
    return {
      user_id: userId,
      input_text: `tuned-window-${i}`,
      parsed_json: [],
      glucose_before: 100,
      bg_2h: 110,
      bg_2h_at: new Date(mealMs + 120 * 60_000).toISOString(),
      glucose_after: 110,
      evaluation: "GOOD",
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 60,
      insulin_units: 0,
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });
  const ins = await admin.from("meals").insert(meals).select("id, meal_time");
  if (ins.error || !ins.data) {
    throw new Error(`meals insert: ${ins.error?.message ?? "no data"}`);
  }
  const sorted = [...ins.data].sort((a, b) =>
    Date.parse(a.meal_time) - Date.parse(b.meal_time),
  );

  // 8 explicitly-tagged boluses, 4u each → ratio 15 g/u per pairing.
  const boluses = sorted.map((m) => ({
    user_id: userId,
    insulin_type: "bolus",
    insulin_name: "Novorapid",
    units: 4,
    created_at: new Date(Date.parse(m.meal_time) + 60_000).toISOString(),
    related_entry_id: m.id,
  }));
  const bins = await admin.from("insulin_logs").insert(boluses);
  if (bins.error) throw new Error(`insulin_logs insert: ${bins.error.message}`);
}

/** Pre-seed the NEXT_LOCALE cookie so the very first SSR HTML is German
 *  (default), keeping the visible label/button copy deterministic. */
async function setLocaleCookieDe(context: BrowserContext) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "de",
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
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

/** The engine FlipCard on /insights wraps the windows section. We
 *  locate it via the stable "Adaptive Engine" card label (the suggestion
 *  pill's Apply button would also work, but it disappears after Apply
 *  is clicked, so the locator wouldn't survive the post-apply assertions
 *  that check the card hasn't flipped). */
function engineFlipCardLocator(page: Page) {
  return page.locator(".glev-flip-card", {
    hasText: "Adaptive Engine",
  }).first();
}

test.describe("Insights — per-window suggestion apply/keep does not flip the engine card", () => {
  test.beforeEach(async ({ context }) => {
    const { userId } = loadTestUserByIndex(test.info().workerIndex);
    await resetUserData(userId);
    await seedTunedWindow(userId);
    await setLocaleCookieDe(context);
  });

  test("Übernehmen speichert (saveIcrSchedule) und dreht die FlipCard NICHT", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/insights");

    // Open the windows section. The "Alle Fenster ansehen ↓" toggle
    // already calls e.stopPropagation() so opening it doesn't flip the
    // engine card — but if it ever did, we'd see aria-pressed flip
    // here, which the assertions below would catch.
    const openWindowsBtn = page.getByRole("button", {
      name: "Alle Fenster ansehen ↓",
      exact: true,
    });
    await expect(openWindowsBtn).toBeVisible({ timeout: 30_000 });
    await openWindowsBtn.scrollIntoViewIfNeeded();
    await openWindowsBtn.click();

    // Suggestion pill should be visible — confirms the seeded data
    // produced a TUNED window with > 10% drift from manualIcr. The
    // FlipCard renders an invisible ghost copy of its active face for
    // height tracking, so two text nodes match — assert against the
    // first (real, visible) one.
    const suggestionText = page.getByText(/Engine schlägt vor: 1:15/).filter({ visible: true }).first();
    await expect(suggestionText).toBeVisible({ timeout: 15_000 });

    // Manual ICR for the slot reads "Du 1:10" before applying.
    const manualBefore = page.getByText(/Du 1:10/).filter({ visible: true }).first();
    await expect(manualBefore).toBeVisible();

    // Sanity check: engine FlipCard is NOT flipped before we click.
    const engineCard = engineFlipCardLocator(page);
    await expect(engineCard).toHaveAttribute("aria-pressed", "false");

    // Click "Übernehmen". e.stopPropagation on the wrapper should
    // prevent the click from bubbling up to the FlipCard. Use `.first()`
    // because the FlipCard ghost mirror duplicates the button DOM (the
    // ghost copy has pointer-events:none + visibility:hidden so it
    // isn't clickable, but it still counts toward strict-mode locator
    // matches).
    await page.getByRole("button", { name: /^Übernehmen$/ }).first().click();

    // After saveIcrSchedule resolves and setIcrSchedule re-renders, the
    // manual ICR for the slot should now read "Du 1:15" (the learned
    // value was applied) and the suggestion pill should disappear
    // (manualIcr === learnedRounded → showSuggestion=false).
    await expect(page.getByText(/Du 1:15/).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(suggestionText).toBeHidden();

    // The engine FlipCard must still be on the front face.
    await expect(engineCard).toHaveAttribute("aria-pressed", "false");
  });

  test("Behalten versteckt die Pille und dreht die FlipCard NICHT", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/insights");

    const openWindowsBtn = page.getByRole("button", {
      name: "Alle Fenster ansehen ↓",
      exact: true,
    });
    await expect(openWindowsBtn).toBeVisible({ timeout: 30_000 });
    await openWindowsBtn.scrollIntoViewIfNeeded();
    await openWindowsBtn.click();

    const suggestionText = page.getByText(/Engine schlägt vor: 1:15/).filter({ visible: true }).first();
    await expect(suggestionText).toBeVisible({ timeout: 15_000 });

    const engineCard = engineFlipCardLocator(page);
    await expect(engineCard).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: /^Behalten$/ }).first().click();

    // Suggestion pill is dismissed for this exact (slotIndex, learned)
    // pair via dismissedSuggestions. Manual ICR stays unchanged.
    await expect(suggestionText).toBeHidden();
    await expect(page.getByText(/Du 1:10/).filter({ visible: true }).first()).toBeVisible();

    // FlipCard still on the front face.
    await expect(engineCard).toHaveAttribute("aria-pressed", "false");
  });
});
