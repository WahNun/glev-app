// E2E coverage for the Übernehmen → Engine-Verlauf round-trip (Task #200).
//
// Background:
//   The unit test `tests/unit/adjustment.test.ts` covers idempotency of the
//   pure-function helpers. This spec closes the browser-facing gap:
//
//   1. Seeding ≥10 finalized overdosing meals within the 30-day window
//      surfaces the "Engine-Vorschlag" adjustment banner on /engine.
//   2. Clicking "Übernehmen" mutates `user_settings.icr_g_per_unit` /
//      `cf_mgdl_per_unit` and appends a record to `adjustment_history`.
//   3. Navigating to /settings → Engine-Verlauf shows the new entry in
//      both the row subtitle and the sheet list.
//   4. Clicking "Verwerfen" hides the banner immediately and the 14-day
//      localStorage cooldown keeps it hidden across a full page reload.
//
// Seeding strategy:
//   • 10 finalized meals: glucose_before=100, bg_2h=55 (below the 70 mg/dL
//     HYPO_THRESHOLD), bg_2h_at = meal_time + 120 min so the ±30 min
//     window check passes. All 10 → lifecycle returns state="final",
//     outcome="OVERDOSE". overdoseRate = 1.0 > 0.5 → "overdosing" pattern.
//   • 10 meals → confidence="medium" (n≥10) → banner is not suppressed by
//     the `pattern.confidence === "low"` early-return in currentAdjustment.
//   • user_settings: icr_g_per_unit=10, cf_mgdl_per_unit=50,
//     adjustment_history=[] so the row starts empty in Settings.
//
// Network mocks:
//   CGM endpoints return empty / not-connected so the engine page loads
//   without waiting for CGM data that is irrelevant to the banner path.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

// ---------------------------------------------------------------------------
// Translation-key guard — fails immediately if de.json is missing any key
// this spec relies on, before the browser is ever launched.
// ---------------------------------------------------------------------------
const DE_MESSAGES = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "messages/de.json"),
    "utf8",
  ),
) as Record<string, Record<string, string>>;

const REQUIRED_DE_KEYS: Array<[namespace: string, key: string]> = [
  ["engine",   "adjustment_banner_title"],
  ["engine",   "adjustment_apply"],
  ["engine",   "adjustment_dismiss"],
  ["engine",   "adjustment_applied_toast"],
  ["settings", "row_adjustment_history"],
  ["settings", "subtitle_adjustment_history_empty"],
  ["settings", "subtitle_adjustment_history_count"],
  ["settings", "adjustment_history_title"],
  ["settings", "insulin_settings_expand_aria"],
];

test("messages/de.json contains all adjustment round-trip translation keys", () => {
  for (const [ns, key] of REQUIRED_DE_KEYS) {
    expect(
      DE_MESSAGES[ns]?.[key],
      `messages/de.json is missing "${ns}.${key}"`,
    ).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "engine-adjustment-round-trip spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Hard-reset all data that feeds into detectPattern / adjustment history. */
async function resetUserData(userId: string) {
  const admin = getAdminClient();
  const r1 = await admin.from("insulin_logs").delete().eq("user_id", userId);
  if (r1.error) throw new Error(`insulin_logs reset: ${r1.error.message}`);
  const r2 = await admin.from("meals").delete().eq("user_id", userId);
  if (r2.error) throw new Error(`meals reset: ${r2.error.message}`);
}

/**
 * Seed 10 finalized OVERDOSE meals:
 *   glucose_before = 100, bg_2h = 55 (below HYPO_THRESHOLD 70) → OVERDOSE
 *   bg_2h_at = meal_time + 120 min (±0 min, inside the ±30 min window)
 *   Spread 5 days ago, each 1 h apart → all within the 30-day pattern window.
 *
 * 10 meals → confidence = "medium" (n≥10), overdoseRate = 1.0 > 0.5
 * → detectPattern returns "overdosing" → suggestAdjustment.hasSuggestion=true
 * → banner appears.
 */
async function seedOverdosingMeals(userId: string) {
  const admin = getAdminClient();
  const baseMs = Date.now() - 5 * 86_400_000;

  const meals = Array.from({ length: 10 }, (_, i) => {
    const mealMs = baseMs + i * 3_600_000;
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `adj-round-trip-${i}`,
      parsed_json: [],
      glucose_before: 100,
      bg_2h: 55,
      bg_2h_at: new Date(bg2hMs).toISOString(),
      glucose_after: 55,
      evaluation: "OVERDOSE",
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 50,
      insulin_units: 5,
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });

  const res = await admin.from("meals").insert(meals);
  if (res.error) throw new Error(`meals insert: ${res.error.message}`);
}

/**
 * Seed user_settings with a known ICR / CF and an empty adjustment_history
 * so the Settings row starts at "Noch keine Engine-Anpassungen gespeichert".
 */
async function resetUserSettings(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("user_settings").upsert(
    {
      user_id: userId,
      icr_g_per_unit: 10,
      cf_mgdl_per_unit: 50,
      adjustment_history: [],
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`user_settings upsert: ${error.message}`);
}

/** Pre-seed NEXT_LOCALE cookie → German for deterministic label matching. */
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

/** Mock CGM endpoints so the engine page loads without blocking on live data. */
async function installCgmMocks(page: Page) {
  await page.route("**/api/cgm/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ current: null, history: [], source: "llu" }),
    });
  });
  await page.route("**/api/cgm/glucose", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false, glucose: null }),
    });
  });
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

/** Locates the adjustment banner by its stable aria-label (translation-driven). */
function bannerLocator(page: Page) {
  return page.getByRole("region", {
    name: DE_MESSAGES["engine"]["adjustment_banner_title"],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Engine adjustment banner round-trip (Task #200)", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await resetUserData(testUser.userId);
    await seedOverdosingMeals(testUser.userId);
    await resetUserSettings(testUser.userId);
    await setLocaleCookieDe(context);
  });

  test.afterAll(async () => {
    await resetUserData(testUser.userId);
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — Übernehmen mutates DB and shows entry in Settings
  // -------------------------------------------------------------------------
  test("Übernehmen: updates user_settings and shows new entry in Engine-Verlauf", async ({ page }) => {
    await installCgmMocks(page);
    await loginAsTestUser(page, test.info().workerIndex);

    // Clear any stale dismiss cooldown so the banner is guaranteed to appear.
    await page.goto("/engine");
    await page.evaluate(() => {
      window.localStorage.removeItem("glev_engine_adj_dismissed");
    });
    await page.reload();

    // ── 1. Banner appears ─────────────────────────────────────────────────
    const banner = bannerLocator(page);
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // Confirm both action buttons are inside the banner.
    // Locators are translation-driven so a copy change is caught by the key
    // guard at the top of this file and fixes itself automatically here.
    const applyText = DE_MESSAGES["engine"]["adjustment_apply"];
    const dismissText = DE_MESSAGES["engine"]["adjustment_dismiss"];
    const applyBtn = banner.getByRole("button", { name: new RegExp(`^${applyText}$`) });
    const dismissBtn = banner.getByRole("button", { name: new RegExp(`^${dismissText}$`) });
    await expect(applyBtn).toBeVisible();
    await expect(dismissBtn).toBeVisible();

    // ── 2. Click Übernehmen ───────────────────────────────────────────────
    await applyBtn.click();

    // Success toast appears ("Engine-Anpassung gespeichert.") and the banner
    // disappears because the ICR was just updated — re-running suggestAdjustment
    // on the same meals would still show the suggestion, but the page hides the
    // banner after a successful apply (adjustmentTick increment + re-computation
    // against the newly saved ICR values).
    const toastText = DE_MESSAGES["engine"]["adjustment_applied_toast"];
    await expect(page.getByText(toastText)).toBeVisible({ timeout: 15_000 });
    await expect(banner).toBeHidden({ timeout: 10_000 });

    // ── 3. Settings → Engine-Verlauf shows the new adjustment entry ───────
    await page.goto("/settings");

    // The Engine-Verlauf row lives inside the "Insulin-Einstellungen" collapsible
    // section (insulinExpanded defaults to false). Click the expand toggle first
    // so the row enters the DOM before we query it.
    const expandAriaLabel = DE_MESSAGES["settings"]["insulin_settings_expand_aria"];
    const expandToggle = page.getByRole("button", { name: expandAriaLabel });
    await expect(expandToggle).toBeVisible({ timeout: 20_000 });
    await expandToggle.click();

    // After expanding, the Engine-Verlauf row must be present.
    // The row label and subtitle are translation-driven.
    const rowLabel = DE_MESSAGES["settings"]["row_adjustment_history"];
    const historyRow = page.getByRole("button", {
      name: new RegExp(rowLabel),
    }).first();
    await expect(historyRow).toBeVisible({ timeout: 10_000 });
    // The "overdosing" pattern proposes field="both", so applyAdjustmentToSettings
    // appends TWO records (ICR + CF). Subtitle: "2 gespeicherte Anpassungen".
    // Match any non-zero digit to stay independent of pluralisation copy changes
    // while still confirming the row is not showing the empty-state subtitle.
    await expect(historyRow).toContainText(/[1-9]/, { timeout: 10_000 });

    // Open the bottom sheet.
    await historyRow.click();

    // Sheet title is "Engine-Anpassungen".
    const sheetTitle = DE_MESSAGES["settings"]["adjustment_history_title"];
    await expect(page.getByText(sheetTitle)).toBeVisible({ timeout: 10_000 });

    // At least one history row must be visible (field: "icr" or "correctionFactor",
    // both are shown when pattern = "overdosing" with field = "both").
    // The row format is "{date} · {field}: {from} → {to}". We look for the
    // KH-Faktor label (icr) as the primary confirmation.
    const icrFieldLabel = DE_MESSAGES["settings"]["adjustment_field_icr"];
    await expect(
      page.getByText(new RegExp(icrFieldLabel)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── 4. DB verification: user_settings row was mutated ─────────────────
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("user_settings")
      .select("icr_g_per_unit, cf_mgdl_per_unit, adjustment_history")
      .eq("user_id", testUser.userId)
      .single();
    expect(error, "DB read for user_settings should not fail").toBeNull();
    expect(data).toBeTruthy();

    // Both ICR and CF must have changed (pattern = "overdosing" → field = "both").
    // ICR: 10 → 10.5 (+5%), CF: 50 → 52.5 (+5%).
    expect(data!.icr_g_per_unit).not.toBe(10);
    expect(data!.cf_mgdl_per_unit).not.toBe(50);

    // adjustment_history must contain at least two records (one per field).
    expect(Array.isArray(data!.adjustment_history)).toBe(true);
    expect((data!.adjustment_history as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // 2. Verwerfen sets a 14-day localStorage cooldown that survives reload
  // -------------------------------------------------------------------------
  test("Verwerfen: hides banner immediately and cooldown persists across page reload", async ({ page }) => {
    await installCgmMocks(page);
    await loginAsTestUser(page, test.info().workerIndex);

    // Ensure no stale cooldown from a previous test run.
    await page.goto("/engine");
    await page.evaluate(() => {
      window.localStorage.removeItem("glev_engine_adj_dismissed");
    });
    await page.reload();

    const banner = bannerLocator(page);
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // ── 1. Click Verwerfen ────────────────────────────────────────────────
    const dismissText = DE_MESSAGES["engine"]["adjustment_dismiss"];
    const dismissBtn = banner.getByRole("button", { name: new RegExp(`^${dismissText}$`) });
    await dismissBtn.click();

    // Banner disappears immediately (synchronous state update via
    // handleDismissAdjustment → rememberDismissal → adjustmentVisible = false).
    await expect(banner).toBeHidden({ timeout: 5_000 });

    // ── 2. Verify localStorage cooldown was written ───────────────────────
    const dismissStore = await page.evaluate(() =>
      window.localStorage.getItem("glev_engine_adj_dismissed"),
    );
    expect(dismissStore, "Verwerfen must write a cooldown to localStorage").toBeTruthy();

    const parsed = JSON.parse(dismissStore!) as Record<string, number>;
    // The "overdosing" signature is used as the key.
    expect(parsed["overdosing"]).toBeGreaterThan(0);

    // ── 3. Reload and confirm banner stays hidden ─────────────────────────
    await page.reload();

    // After reload the hydration effect reads the localStorage cooldown.
    // Since Date.now() − dismissedAt << 14 days, adjustmentVisible stays false.
    // Give the page enough time to fetch meals and recompute currentAdjustment
    // before asserting hidden — if the cooldown is missing the banner WOULD
    // appear, which would make this assertion fail and catch the regression.
    await page.waitForLoadState("networkidle");
    await expect(banner).toBeHidden({ timeout: 15_000 });

    // ── 4. DB must not have been mutated (Verwerfen is client-only) ───────
    const admin = getAdminClient();
    const { data } = await admin
      .from("user_settings")
      .select("icr_g_per_unit, adjustment_history")
      .eq("user_id", testUser.userId)
      .single();

    expect(data?.icr_g_per_unit, "ICR must be unchanged after Verwerfen").toBe(10);
    const history = (data?.adjustment_history ?? []) as unknown[];
    expect(history.length, "adjustment_history must remain empty after Verwerfen").toBe(0);
  });
});
