// End-to-end coverage for the ICR (Insulin-to-Carb Ratio) slider
// in Settings → Insulin section.
//
// Why this exists:
//   The ICR SnapSlider (min=5, max=30, step=1) controls a clinically
//   relevant parameter that drives every bolus recommendation in the
//   Glev Engine. Task #647 adds this spec to catch regressions where
//   the slider fires the wrong value or the Save button does not write
//   to the DB:
//     open ICR sheet → adjust slider → save → subtitle row shows the new
//     value ("1:{value} g/U").
//
//   The SnapSlider uses a custom pointer-event drag path to work around
//   WKWebView's broken native <input type="range">.  The tap-to-edit
//   read-out is the most reliable automation path in Playwright (no
//   pointer coordinate math needed), so most tests drive through
//   tap-to-edit.  One test exercises the keyboard ArrowRight/ArrowLeft
//   path in handleKeyDown.
//
// What is tested:
//   1. ICR row exists and opens a sheet with a SnapSlider.
//   2. Editing the value via tap-to-edit and saving writes
//      `icr_g_per_unit` to `user_settings` (DB persistence round-trip).
//   3. Reloading the page re-fetches from the DB and shows the new value
//      in the subtitle ("1:{value} g/U"), proving the read path is closed.
//   4. Reopening the sheet without a page reload shows the saved value.
//   5. Input clamping: typing above the maximum (30) stores 30 and
//      reflects that in the subtitle.
//   6. Input clamping: typing below the minimum (5) stores 5.
//   7. Keyboard navigation: ArrowRight increments by one step (1 g/IE),
//      ArrowLeft decrements by one step — guards the handleKeyDown path.
//
// Relevant files:
//   - app/(protected)/settings/page.tsx  — ICR sheet + SnapSlider wiring
//   - components/log/SnapSlider.tsx       — slider with tap-to-edit readout
//   - lib/userSettings.ts                — saveInsulinSettings / icr_g_per_unit column

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "settings-icr-slider spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readIcrValue(userId: string): Promise<number | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("icr_g_per_unit")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings read failed: ${error.message}`);
  }
  return (data?.icr_g_per_unit ?? null) as number | null;
}

/**
 * Reset icr_g_per_unit back to NULL so each test starts from the same
 * "fresh user, no saved ICR" baseline. Nullifying the column (rather than
 * deleting the row) keeps other settings intact for unrelated specs.
 */
async function resetIcrValue(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, icr_g_per_unit: null },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`icr_g_per_unit reset failed: ${error.message}`);
  }
}

// Locale-agnostic regexes — the app locale can be "de" or "en" depending
// on Playwright's Accept-Language header.
//
// Insulin section expand button (collapsed by default):
//   aria-label = "Expand insulin settings" (en) / "Insulin-Einstellungen aufklappen" (de)
const INSULIN_EXPAND_ARIA = /(Expand insulin settings|Insulin-Einstellungen aufklappen)/i;

// ICR row button: aria-label = "Open Insulin-to-Carb Ratio" (en)
//                              "Insulin-Carb-Verhältnis öffnen" (de)
const ICR_ROW_ARIA = /(Open Insulin-to-Carb Ratio|Insulin-Carb-Verhältnis öffnen)/i;

// SnapSlider tap-to-edit readout button: aria-label = "Insulin-to-Carb Ratio" (en)
//                                                      "Insulin-Carb-Verhältnis" (de)
const ICR_SLIDER_ARIA = /(Insulin-to-Carb Ratio|Insulin-Carb-Verhältnis)/i;

const SAVE_BUTTON = /^(Save|Speichern|Saving…|Speichere…|✓ Saved!|✓ Gespeichert!)$/;

/**
 * Navigate to /settings and expand the Insulin section.
 *
 * The Insulin section is collapsed by default (insulinExpanded = false).
 * The ICR row is only rendered once the section is open, so every test
 * must call this helper before trying to interact with the ICR row.
 */
async function goToSettingsAndExpandInsulin(page: Page) {
  await page.goto("/settings");
  const expandBtn = page.getByRole("button", { name: INSULIN_EXPAND_ARIA });
  await expect(expandBtn).toBeVisible({ timeout: 15_000 });
  await expandBtn.click();
  // Wait until the section is expanded (aria-expanded=true) before proceeding.
  await expect(expandBtn).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
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
 * Open the ICR sheet, set a value via the tap-to-edit input, and save.
 *
 * The SnapSlider shows a readout button (aria-label matching ICR_SLIDER_ARIA).
 * Clicking it switches to an <input type="number"> edit mode. We fill the
 * desired value, confirm with Enter, then click the Save button.
 * The sheet closes on success; we wait for the readout button to disappear
 * (i.e. sheet unmounted) as the completion signal.
 */
async function editIcrViaSlider(page: Page, value: number) {
  const icrRow = page.getByRole("button", { name: ICR_ROW_ARIA });
  await expect(icrRow).toBeVisible({ timeout: 15_000 });
  await icrRow.click();

  // Tap-to-edit: click the readout button to enter editing mode.
  const readout = page.getByRole("button", { name: ICR_SLIDER_ARIA });
  await expect(readout).toBeVisible({ timeout: 10_000 });
  await readout.click();

  // The readout is replaced by an <input type="number"> (autoFocus).
  const input = page.locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press("Enter");

  // Save and wait for the sheet to close.
  await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
  // Sheet closing is signalled by the readout button disappearing.
  await expect(readout).toBeHidden({ timeout: 10_000 });
}

// ── Keyboard navigation ───────────────────────────────────────────────────
// The SnapSlider drag-div has role="slider" and handles ArrowRight/ArrowLeft
// via onKeyDown (handleKeyDown in SnapSlider.tsx).  This describe block
// exercises that path so a regression in handleKeyDown is caught before
// users who rely on keyboard / AT navigation are affected.

test.describe("Settings → ICR slider keyboard navigation", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetIcrValue(testUser.userId);
  });

  test.afterAll(async () => {
    await resetIcrValue(testUser.userId);
  });

  test("ArrowRight twice from default (10) produces 12 g/IE and persists", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Baseline: no saved ICR (NULL → component default 10).
    expect(await readIcrValue(testUser.userId)).toBeNull();

    await goToSettingsAndExpandInsulin(page);

    // Open the ICR sheet.
    const icrRow = page.getByRole("button", { name: ICR_ROW_ARIA });
    await expect(icrRow).toBeVisible({ timeout: 10_000 });
    await icrRow.click();

    // The SnapSlider drag-div has role="slider" and the same aria-label as
    // the tap-to-edit readout button — distinguish it by role.
    const sliderDiv = page.getByRole("slider", { name: ICR_SLIDER_ARIA });
    await expect(sliderDiv).toBeVisible({ timeout: 10_000 });

    // Focus the slider div and press ArrowRight twice.
    // Each press increments by one step (1 g/IE): 10 → 11 → 12.
    await sliderDiv.focus();
    await sliderDiv.press("ArrowRight");
    await sliderDiv.press("ArrowRight");

    // Verify aria-valuenow updated to 12 before saving.
    await expect(sliderDiv).toHaveAttribute("aria-valuenow", "12", { timeout: 3_000 });

    // Save and wait for the sheet to close (tap-to-edit readout disappears).
    const readout = page.getByRole("button", { name: ICR_SLIDER_ARIA });
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(readout).toBeHidden({ timeout: 10_000 });

    // DB must reflect 12.
    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(12);

    // Reload proves the full read-path is closed.
    await page.reload();
    await expect(page.getByText("1:12 g/U")).toBeVisible({ timeout: 10_000 });
  });

  test("ArrowLeft from default (10) produces 9 g/IE and persists", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    expect(await readIcrValue(testUser.userId)).toBeNull();

    await goToSettingsAndExpandInsulin(page);

    const icrRow = page.getByRole("button", { name: ICR_ROW_ARIA });
    await expect(icrRow).toBeVisible({ timeout: 10_000 });
    await icrRow.click();

    const sliderDiv = page.getByRole("slider", { name: ICR_SLIDER_ARIA });
    await expect(sliderDiv).toBeVisible({ timeout: 10_000 });

    // One ArrowLeft press: 10 − 1 = 9.
    await sliderDiv.focus();
    await sliderDiv.press("ArrowLeft");

    await expect(sliderDiv).toHaveAttribute("aria-valuenow", "9", { timeout: 3_000 });

    const readout = page.getByRole("button", { name: ICR_SLIDER_ARIA });
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(readout).toBeHidden({ timeout: 10_000 });

    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(9);

    await page.reload();
    await expect(page.getByText("1:9 g/U")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Settings → ICR slider round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetIcrValue(testUser.userId);
  });

  test.afterAll(async () => {
    // Leave the test user with no saved ICR so other specs that
    // check the "unset" state aren't surprised by a stale value.
    await resetIcrValue(testUser.userId);
  });

  test("editing ICR via slider persists to user_settings and reflects in subtitle", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // INITIAL STATE: icr_g_per_unit should be NULL (just reset).
    expect(await readIcrValue(testUser.userId)).toBeNull();

    await goToSettingsAndExpandInsulin(page);

    // The ICR row must be visible once the section is expanded.
    await expect(page.getByRole("button", { name: ICR_ROW_ARIA })).toBeVisible({ timeout: 5_000 });

    // ---- EDIT -------------------------------------------------------
    // Change ICR from the default (10) to 15 g/IE.
    await editIcrViaSlider(page, 15);

    // ---- DB PERSISTENCE ---------------------------------------------
    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(15);

    // ---- READ PATH: subtitle reflects saved value after page reload --
    // Reload so the mount effect re-fetches from the DB rather than
    // reading the in-memory state — proves the full round-trip is closed.
    await page.reload();
    // Subtitle format: "1:{value} g/U" e.g. "1:15 g/U"
    await expect(page.getByText("1:15 g/U")).toBeVisible({ timeout: 10_000 });
  });

  test("reopening ICR sheet shows the previously saved value", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    await goToSettingsAndExpandInsulin(page);

    // Save ICR = 20.
    await editIcrViaSlider(page, 20);

    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(20);

    // Reopen the sheet (no page reload) — slider must open at 20.
    const icrRow = page.getByRole("button", { name: ICR_ROW_ARIA });
    await expect(icrRow).toBeVisible({ timeout: 10_000 });
    await icrRow.click();

    const sliderDiv = page.getByRole("slider", { name: ICR_SLIDER_ARIA });
    await expect(sliderDiv).toBeVisible({ timeout: 10_000 });
    await expect(sliderDiv).toHaveAttribute("aria-valuenow", "20", { timeout: 5_000 });
  });

  test("out-of-range ICR input is clamped to the allowed maximum (30)", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToSettingsAndExpandInsulin(page);

    // Typing 99 should be clamped to 30 (max).
    await editIcrViaSlider(page, 99);

    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(30);

    // Reload and verify the subtitle shows "1:30 g/U", not "1:99 g/U".
    await page.reload();
    await expect(page.getByText("1:30 g/U")).toBeVisible({ timeout: 10_000 });
  });

  test("out-of-range ICR input is clamped to the allowed minimum (5)", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToSettingsAndExpandInsulin(page);

    // Typing 1 should be clamped to 5 (min).
    await editIcrViaSlider(page, 1);

    await expect.poll(
      () => readIcrValue(testUser.userId),
      { timeout: 10_000 },
    ).toBe(5);

    await page.reload();
    await expect(page.getByText("1:5 g/U")).toBeVisible({ timeout: 10_000 });
  });
});
