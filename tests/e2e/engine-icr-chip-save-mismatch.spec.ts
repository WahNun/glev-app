// Regression guard for Task #580: switching the Adaptiv/Einstellungen
// ICR chip AFTER an engine run was showing the old result dose on the
// Speichern button instead of the newly-selected chip's eager dose.
//
// Root cause (pre-fix):
//   `activeDose` always returned `result.dose` once the engine had run,
//   regardless of which chip was currently selected. After switching from
//   Adaptiv → Einstellungen, `resultICRSource` ('adaptive') no longer
//   matched `selectedICR` ('static') — the fix makes `activeDose` fall
//   back to `eagerDoses[selectedICR]` in that case so the Speichern
//   button always reflects the currently-selected ICR source.
//
// What this asserts:
//   1. After running the engine with Adaptiv selected, the Speichern
//      button shows the adaptive result dose.
//   2. After clicking the Einstellungen chip, the Speichern button dose
//      updates to the static eager dose — NOT the adaptive run result.
//
// Setup strategy:
//   • 3 final meals + 2 boluses (same fixture as icr-source-split.spec.ts)
//     give adaptive ICR ≈ 11.7 g/IE and icrSampleSize = 3.
//   • user_settings.icr_g_per_unit is set to 15 so
//     |adaptedICR − staticICR| ≈ 3.3 > 0.5, which triggers `showBoth = true`
//     and renders both the Adaptiv and Einstellungen chips.
//   • Both chips carry different doses (50 g ÷ 11.7 ≈ 4.3 IE  vs
//     50 g ÷ 15 ≈ 3.3 IE), so a stuck-at-result-dose bug is immediately
//     visible on the save button after the chip switch.
//
// Network mocks mirror engine-trend-arrow.spec.ts / icr-source-split.spec.ts:
//   /api/cgm/history → empty (no trend arrow needed)
//   /api/cgm/glucose → not connected (no autofill)
//   /api/chat-macros → deterministic 50 g carb macro

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

// ---------------------------------------------------------------------------
// Translation-key guard — fails immediately if en.json is missing any of the
// three keys the English locale variant of this test relies on.  This catches
// regressions where a key is renamed or accidentally removed before they ever
// reach the browser.
// ---------------------------------------------------------------------------
const EN_MESSAGES = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "messages/en.json"),
    "utf8",
  ),
) as Record<string, Record<string, string>>;

const REQUIRED_EN_KEYS: Array<[namespace: string, key: string]> = [
  ["engine", "icr_adaptive_label"],
  ["engine", "icr_static_label"],
  ["engine", "btn_save_with_bolus"],
];

test("messages/en.json contains all ICR-chip translation keys", () => {
  for (const [ns, key] of REQUIRED_EN_KEYS) {
    expect(
      EN_MESSAGES[ns]?.[key],
      `messages/en.json is missing "${ns}.${key}" — the English ICR-chip test would fail at runtime`,
    ).toBeTruthy();
  }
});

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
      "engine-icr-chip-save-mismatch spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Wipe meals + insulin_logs for the test user so the seeded fixture
 *  is the only data the engine sees during computation. */
async function resetEngineData(userId: string) {
  const admin = getAdminClient();
  const a = await admin.from("insulin_logs").delete().eq("user_id", userId);
  if (a.error) throw new Error(`insulin_logs reset failed: ${a.error.message}`);
  const b = await admin.from("meals").delete().eq("user_id", userId);
  if (b.error) throw new Error(`meals reset failed: ${b.error.message}`);
}

/** Seed 3 final meals + 2 paired boluses (same fixture as
 *  icr-source-split.spec.ts) to drive icrSampleSize = 3 and an
 *  adaptive ICR ≈ 11.7 g/IE.
 *
 *  Meal A → bolus 5 IE (explicit tag)    → ICR = 50/5 = 10
 *  Meal B → bolus 4 IE (time-window)     → ICR = 50/4 = 12.5
 *  Meal C → no bolus, insulin_units = 4  → ICR = 50/4 = 12.5
 *  Weighted average (all GOOD, weight 1.0) = (10+12.5+12.5)/3 ≈ 11.7
 */
async function seedEngineData(userId: string) {
  const admin = getAdminClient();
  const FIVE_DAYS_AGO_MS = Date.now() - 5 * 86_400_000;

  const meals = [0, 1, 2].map((i) => {
    const mealMs = FIVE_DAYS_AGO_MS + i * 3 * 3_600_000;
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `icr-chip-mismatch-${i}`,
      parsed_json: [],
      glucose_before: 100,
      bg_2h: 110,
      bg_2h_at: new Date(bg2hMs).toISOString(),
      glucose_after: 110,
      evaluation: "GOOD",
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 50,
      insulin_units: 4,
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });
  const inserted = await admin.from("meals").insert(meals).select("id, meal_time");
  if (inserted.error || !inserted.data) {
    throw new Error(`meals insert failed: ${inserted.error?.message ?? "no data"}`);
  }
  const sorted = [...inserted.data].sort(
    (x, y) => Date.parse(x.meal_time) - Date.parse(y.meal_time),
  );
  const mealA = sorted[0].id as string;
  const mealBTimeMs = Date.parse(sorted[1].meal_time);

  const boluses = [
    {
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: "Novorapid",
      units: 5,
      created_at: new Date(Date.parse(sorted[0].meal_time) + 60_000).toISOString(),
      related_entry_id: mealA,
    },
    {
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: "Novorapid",
      units: 4,
      created_at: new Date(mealBTimeMs + 5 * 60_000).toISOString(),
      related_entry_id: null,
    },
  ];
  const ins = await admin.from("insulin_logs").insert(boluses);
  if (ins.error) throw new Error(`insulin_logs insert failed: ${ins.error.message}`);
}

/** Set user_settings.icr_g_per_unit = 15 so the static ICR is well
 *  separated from the adaptive ICR (≈11.7) by 3.3 g/IE. This triggers
 *  `showBoth = true` (requires |adaptedICR − staticICR| > 0.5) and
 *  renders both chips with visibly different dose labels. Uses upsert
 *  so it works whether or not the row already exists. */
async function setStaticICR(userId: string, icr: number) {
  const admin = getAdminClient();
  const { error } = await admin.from("user_settings").upsert(
    { user_id: userId, icr_g_per_unit: icr },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`user_settings upsert failed: ${error.message}`);
}

/** Pre-seed NEXT_LOCALE cookie so the first SSR response already
 *  speaks the requested language. */
async function setLocaleCookie(context: BrowserContext, locale: "de" | "en") {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: locale,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
}

/** Install cheap network mocks for the endpoints the engine page hits on
 *  mount. We don't care about CGM values; the fixed 50 g macro payload
 *  lets the wizard advance to Step 2 predictably. */
async function installEngineNetworkMocks(page: Page) {
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
  await page.route("**/api/chat-macros", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Got it — 50 g carbs.",
        nutritionSource: "estimated",
        macros: { carbs: 50, protein: 10, fat: 5, fiber: 3, calories: 0 },
        description: "icr-chip-mismatch test meal",
        items: [],
      }),
    });
  });
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

/** Drive the chat panel from Step 1 → Step 2 and then trigger the engine
 *  run by clicking the "Bolus berechnen" toggle.
 *
 *  Flow:
 *    1. Type a placeholder message → hits mocked /api/chat-macros.
 *    2. Click the "Continue to step 2" CTA → lands on macros review.
 *    3. Click the "Bolus berechnen" toggle (aria-checked switch) →
 *       bolusEnabled = true → useEffect fires handleRun(true) → engine
 *       result + ICR chips appear inline in Step 2. */
async function runEngineWithBolusToggle(page: Page) {
  const chatInput = page.locator('input[placeholder]').first();
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await chatInput.fill("icr-chip-mismatch test meal");
  await page.getByRole("button", { name: /^(Send|Senden)$/i }).click();

  const advanceBtn = page.getByRole("button", { name: /(Continue to step 2|Weiter zu Schritt 2)/i });
  await expect(advanceBtn).toBeVisible({ timeout: 15_000 });
  await advanceBtn.click();

  // The bolus toggle is a button with aria-checked — clicking it sets
  // bolusEnabled=true, which auto-triggers the engine run via useEffect.
  // The locator intentionally matches "Bolus berechnen" (DE) / "Calculate
  // bolus" (EN) so this helper is locale-agnostic.
  const bolusToggle = page.getByRole("button", { name: /(Bolus berechnen|Calculate bolus)/i }).first();
  await expect(bolusToggle).toBeVisible({ timeout: 15_000 });
  await bolusToggle.click();
}

test.describe("ICR-chip / Speichern-button consistency (Task #580 regression guard)", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetEngineData(testUser.userId);
    await seedEngineData(testUser.userId);
    // Static ICR = 15 — separated from adaptive (≈11.7) by 3.3 g/IE,
    // which satisfies the showBoth condition (|diff| > 0.5) and ensures
    // the two chip dose labels are numerically distinct.
    await setStaticICR(testUser.userId, 15);
  });

  test.afterAll(async () => {
    await resetEngineData(testUser.userId);
  });

  test("switching from Adaptiv to Einstellungen chip updates the Speichern-button dose", async ({ page, context }) => {
    await setLocaleCookie(context, "de");
    await installEngineNetworkMocks(page);
    await loginAsTestUser(page);
    await page.goto("/engine");

    await runEngineWithBolusToggle(page);

    // Wait for the Adaptiv chip to appear — it is the initially-selected
    // chip (selectedICR = 'adaptive' by default) and contains the engine
    // result dose. The Einstellungen chip appears alongside it once
    // showBoth = true (icrSampleSize ≥ 3 AND |adaptedICR − staticICR| > 0.5).
    //
    // Note: the page also contains a navigation button labelled "Adaptiv"
    // in the sidebar. We scope to the result area by looking for a button
    // that contains BOTH "Adaptiv" and an "IE" unit suffix — the chips
    // render as buttons with label + ICR ratio + dose ("X IE") inline.
    // Playwright's `hasText` matches substring anywhere in the element,
    // so filtering by /Adaptiv/ then by /IE/ narrows it to the chip.
    const adaptivChip = page.locator("button").filter({ hasText: /Adaptiv/ }).filter({ hasText: /IE/ }).first();
    await expect(adaptivChip).toBeVisible({ timeout: 20_000 });

    const einstellungenChip = page.locator("button").filter({ hasText: /Einstellungen/ }).filter({ hasText: /IE/ }).first();
    await expect(einstellungenChip).toBeVisible({ timeout: 10_000 });

    // The save button shows "✓ Speichern — X IE" when bolusEnabled=true.
    // Read the dose label BEFORE switching the chip (adaptive run result).
    const saveBtn = page.locator("button").filter({ hasText: /Speichern/ }).filter({ hasText: /IE/ }).first();
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    const doseBefore = await saveBtn.textContent();
    expect(doseBefore, "save button must show a dose before chip switch").toMatch(/IE/);

    // Switch to the Einstellungen chip. This changes selectedICR to
    // 'static'. Because resultICRSource is still 'adaptive' (set when the
    // engine ran), activeDose must fall back to eagerDoses.static — NOT
    // stay stuck on result.dose (the pre-fix bug).
    await einstellungenChip.click();

    // The dose on the save button must change immediately (synchronous
    // React state update). Using toHaveText with a not-equal check:
    // wait until the text no longer matches the original dose label.
    await expect(saveBtn).not.toHaveText(doseBefore ?? "", { timeout: 5_000 });

    const doseAfter = await saveBtn.textContent();
    expect(doseAfter, "save button must still carry a dose after chip switch").toMatch(/IE/);

    // Belt-and-suspenders: the two doses must be numerically distinct,
    // confirming that the button actually reflects the static ICR (15)
    // rather than being stuck on the adaptive result (ICR ≈ 11.7).
    expect(doseBefore).not.toBe(doseAfter);
  });

  test("switching BACK to Adaptiv chip after Einstellungen restores the eager adaptive dose", async ({ page, context }) => {
    // Guard against a half-fix where only the first switch is correct
    // but toggling back re-applies the stale result.dose.
    await setLocaleCookie(context, "de");
    await installEngineNetworkMocks(page);
    await loginAsTestUser(page);
    await page.goto("/engine");

    await runEngineWithBolusToggle(page);

    const adaptivChip = page.locator("button").filter({ hasText: /Adaptiv/ }).filter({ hasText: /IE/ }).first();
    await expect(adaptivChip).toBeVisible({ timeout: 20_000 });
    const einstellungenChip = page.locator("button").filter({ hasText: /Einstellungen/ }).filter({ hasText: /IE/ }).first();
    await expect(einstellungenChip).toBeVisible({ timeout: 10_000 });

    const saveBtn = page.locator("button").filter({ hasText: /Speichern/ }).filter({ hasText: /IE/ }).first();
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });

    // Step 1: switch to Einstellungen
    await einstellungenChip.click();
    const doseOnEinstellungen = await saveBtn.textContent();

    // Step 2: switch BACK to Adaptiv — the eager adaptive dose should be
    // shown again (re-running the engine is not required for the button
    // to be correct; eagerDoses[selectedICR] is always up to date).
    await adaptivChip.click();
    const doseBackOnAdaptiv = await saveBtn.textContent();

    expect(doseOnEinstellungen).not.toBe(doseBackOnAdaptiv);
    expect(doseBackOnAdaptiv, "save button must show a dose after switching back").toMatch(/IE/);
  });

  // -------------------------------------------------------------------------
  // English locale variant (Task #585)
  // Repeats the primary chip-switch assertion with NEXT_LOCALE=en so that a
  // missing or misspelled translation key for "Adaptive", "Settings", or the
  // save-button pattern is caught before it reaches users.
  //
  // Chip labels in EN:  "Adaptive" / "Settings"  (icr_adaptive_label / icr_static_label)
  // Save-button in EN:  "✓ Save — X.X u"          (btn_save_with_bolus, units="u")
  // -------------------------------------------------------------------------
  test("EN locale: switching from Adaptive to Settings chip updates the Save-button dose", async ({ page, context }) => {
    await setLocaleCookie(context, "en");
    await installEngineNetworkMocks(page);
    await loginAsTestUser(page);
    await page.goto("/engine");

    await runEngineWithBolusToggle(page);

    // The Adaptive chip is the default selection. It renders a button that
    // contains both the label "Adaptive" and a numeric dose ("u" unit suffix).
    // Scoping to buttons with a digit prevents matching the sidebar nav link
    // that also reads "Adaptive" in some layouts.
    const adaptiveChip = page
      .locator("button")
      .filter({ hasText: /Adaptive/ })
      .filter({ hasText: /\d/ })
      .first();
    await expect(adaptiveChip).toBeVisible({ timeout: 20_000 });

    // Settings chip — appears alongside Adaptive once showBoth = true.
    // Filtered by /\d/ to exclude any Settings nav button (no dose label there).
    const settingsChip = page
      .locator("button")
      .filter({ hasText: /Settings/ })
      .filter({ hasText: /\d/ })
      .first();
    await expect(settingsChip).toBeVisible({ timeout: 10_000 });

    // Save button in EN: "✓ Save — 4.3 u". Matching "✓ Save" is unique enough
    // because the unit suffix ("u") differs from any plain "Save" navigation
    // control that does not carry a dose label.
    const saveBtn = page
      .locator("button")
      .filter({ hasText: /✓ Save/ })
      .first();
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    const doseBefore = await saveBtn.textContent();
    expect(doseBefore, "EN save button must show a dose before chip switch").toMatch(/\d/);

    // Switch to Settings chip — activeDose must update to eagerDoses.static,
    // NOT stay stuck on result.dose (the pre-fix regression).
    await settingsChip.click();

    await expect(saveBtn).not.toHaveText(doseBefore ?? "", { timeout: 5_000 });

    const doseAfter = await saveBtn.textContent();
    expect(doseAfter, "EN save button must still carry a dose after chip switch").toMatch(/\d/);
    expect(doseBefore).not.toBe(doseAfter);
  });
});
