// End-to-end coverage for the DIA (Duration of Insulin Action) slider
// in Settings → Insulin section.
//
// Why this exists:
//   The DIA slider (SnapSlider, min=60, max=360, step=30) is the primary
//   input for a clinically relevant parameter that feeds IOB calculations.
//   Task #613 added this spec to catch regressions before they reach users:
//     open DIA sheet → adjust slider → save → subtitle row shows the new
//     value.
//
//   The SnapSlider uses a custom pointer-event drag path to work around
//   WKWebView's broken native <input type="range">.  The tap-to-edit
//   read-out is the most reliable automation path in Playwright (no pointer
//   coordinate math needed), so we drive it through the tap-to-edit
//   number input rather than a drag gesture.
//
// What is tested:
//   1. DIA row exists and opens a sheet with a SnapSlider.
//   2. Editing the value via the tap-to-edit input and saving writes
//      `dia_minutes` to `user_settings` (DB persistence round-trip).
//   3. Reloading the page re-fetches from the DB and shows the new value
//      in the subtitle ("{minutes} min"), proving the read path is closed.
//   4. Input clamping: typing a value above the maximum (360) stores 360
//      and reflects that in the subtitle.
//   5. Keyboard navigation: ArrowRight on the focused slider div increments
//      by one step (30 min); two presses from default (180) → 240 min.
//      This guards the handleKeyDown path in SnapSlider.tsx which keyboard
//      and assistive-technology users depend on.
//
// Relevant files:
//   - app/(protected)/settings/page.tsx  — DIA sheet + SnapSlider wiring
//   - components/log/SnapSlider.tsx       — slider component with tap-to-edit
//   - lib/userSettings.ts                — saveInsulinSettings / dia_minutes column

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
      "settings-dia-slider spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readDiaMinutes(userId: string): Promise<number | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("dia_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings read failed: ${error.message}`);
  }
  return (data?.dia_minutes ?? null) as number | null;
}

/**
 * Reset dia_minutes back to NULL so each test starts from the same
 * "fresh user, no saved DIA" baseline. Nullifying the column (rather
 * than deleting the row) keeps other settings intact for unrelated specs.
 */
async function resetDiaMinutes(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, dia_minutes: null },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`dia_minutes reset failed: ${error.message}`);
  }
}

// Locale-agnostic regexes — the app locale can be "de" or "en" depending
// on Playwright's Accept-Language header in CI.
//
// DIA row button: aria-label = "Open Insulin Duration" (en)
//                              "Insulinwirkdauer öffnen" (de)
const DIA_ROW_ARIA = /(Open Insulin Duration|Insulinwirkdauer öffnen)/i;

// SnapSlider tap-to-edit readout button: aria-label = "Duration (minutes)" (en)
//                                                      "Wirkdauer \(Minuten\)" (de)
const DIA_SLIDER_ARIA = /(Duration \(minutes\)|Wirkdauer \(Minuten\))/i;

const SAVE_BUTTON = /^(Save|Speichern|Saving…|Speichere…|✓ Saved!|✓ Gespeichert!)$/;

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

/**
 * Open the DIA sheet, set a value via the tap-to-edit input, and save.
 *
 * The SnapSlider shows a readout button (aria-label = DIA_SLIDER_ARIA).
 * Clicking it switches to an <input type="number"> edit mode. We fill
 * the desired value, confirm with Enter, then click the Save button.
 * The sheet closes on success; we wait for the readout button to
 * disappear (i.e. sheet unmounted) as the completion signal.
 */
async function editDiaViaSlider(page: Page, minutes: number) {
  const diaRow = page.getByRole("button", { name: DIA_ROW_ARIA });
  await expect(diaRow).toBeVisible({ timeout: 15_000 });
  await diaRow.click();

  // Tap-to-edit: click the readout button to enter editing mode.
  const readout = page.getByRole("button", { name: DIA_SLIDER_ARIA });
  await expect(readout).toBeVisible({ timeout: 10_000 });
  await readout.click();

  // The readout is replaced by an <input type="number"> (autoFocus).
  const input = page.locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(minutes));
  await input.press("Enter");

  // Save and wait for the sheet to close.
  await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
  // Sheet closing is signalled by the readout button disappearing.
  await expect(readout).toBeHidden({ timeout: 10_000 });
}

// ── Keyboard navigation ────────────────────────────────────────────────────
// The SnapSlider drag-div has role="slider" and handles ArrowRight/ArrowLeft
// via onKeyDown (handleKeyDown in SnapSlider.tsx).  This describe block
// exercises that path so a regression in handleKeyDown is caught before
// users who rely on keyboard / AT navigation are affected.
//
// Aria-label for the slider div mirrors the tap-to-edit readout (same
// ariaLabel prop is forwarded to both), so we reuse DIA_SLIDER_ARIA but
// select by role="slider" instead of role="button".

test.describe("Settings → DIA slider keyboard navigation", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetDiaMinutes(testUser.userId);
  });

  test.afterAll(async () => {
    await resetDiaMinutes(testUser.userId);
  });

  test("ArrowRight twice from default (180) produces 240 min and persists", async ({ page }) => {
    await loginAsTestUser(page);

    // Baseline: no saved DIA (NULL → component default 180 min).
    expect(await readDiaMinutes(testUser.userId)).toBeNull();

    await page.goto("/settings");

    // Open the DIA sheet.
    const diaRow = page.getByRole("button", { name: DIA_ROW_ARIA });
    await expect(diaRow).toBeVisible({ timeout: 15_000 });
    await diaRow.click();

    // The SnapSlider drag-div has role="slider" and the same aria-label as
    // the tap-to-edit readout button — distinguish it by role.
    const sliderDiv = page.getByRole("slider", { name: DIA_SLIDER_ARIA });
    await expect(sliderDiv).toBeVisible({ timeout: 10_000 });

    // Focus the slider div and press ArrowRight twice.
    // Each press increments by one step (30 min): 180 → 210 → 240.
    await sliderDiv.focus();
    await sliderDiv.press("ArrowRight");
    await sliderDiv.press("ArrowRight");

    // Save and wait for the sheet to close (tap-to-edit readout disappears).
    const readout = page.getByRole("button", { name: DIA_SLIDER_ARIA });
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(readout).toBeHidden({ timeout: 10_000 });

    // DB must reflect 240.
    await expect.poll(
      () => readDiaMinutes(testUser.userId),
      { timeout: 10_000 },
    ).toBe(240);

    // Reload proves the full read-path is closed.
    await page.reload();
    await expect(page.getByText("240 min")).toBeVisible({ timeout: 10_000 });
  });

  test("ArrowLeft from default (180) produces 150 min and persists", async ({ page }) => {
    await loginAsTestUser(page);

    expect(await readDiaMinutes(testUser.userId)).toBeNull();

    await page.goto("/settings");

    const diaRow = page.getByRole("button", { name: DIA_ROW_ARIA });
    await expect(diaRow).toBeVisible({ timeout: 15_000 });
    await diaRow.click();

    const sliderDiv = page.getByRole("slider", { name: DIA_SLIDER_ARIA });
    await expect(sliderDiv).toBeVisible({ timeout: 10_000 });

    // One ArrowLeft press: 180 − 30 = 150.
    await sliderDiv.focus();
    await sliderDiv.press("ArrowLeft");

    const readout = page.getByRole("button", { name: DIA_SLIDER_ARIA });
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(readout).toBeHidden({ timeout: 10_000 });

    await expect.poll(
      () => readDiaMinutes(testUser.userId),
      { timeout: 10_000 },
    ).toBe(150);

    await page.reload();
    await expect(page.getByText("150 min")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Settings → DIA slider round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetDiaMinutes(testUser.userId);
  });

  test.afterAll(async () => {
    // Leave the test user with no saved DIA so other specs that
    // check the "unset" subtitle aren't surprised by a stale value.
    await resetDiaMinutes(testUser.userId);
  });

  test("editing DIA via slider persists to user_settings and reflects in subtitle", async ({ page }) => {
    await loginAsTestUser(page);

    // INITIAL STATE: dia_minutes should be NULL (just reset).
    expect(await readDiaMinutes(testUser.userId)).toBeNull();

    await page.goto("/settings");

    // The DIA row must be visible in the Insulin section.
    await expect(page.getByRole("button", { name: DIA_ROW_ARIA })).toBeVisible();

    // ---- EDIT -------------------------------------------------------
    // Change DIA from the default (180) to 240 min.
    await editDiaViaSlider(page, 240);

    // ---- DB PERSISTENCE ---------------------------------------------
    await expect.poll(
      () => readDiaMinutes(testUser.userId),
      { timeout: 10_000 },
    ).toBe(240);

    // ---- READ PATH: subtitle reflects saved value after page reload --
    // Reload so the mount effect re-fetches from the DB rather than
    // reading the in-memory state — proves the full round-trip is closed.
    await page.reload();
    // Subtitle format: "{minutes} min" e.g. "240 min"
    await expect(page.getByText("240 min")).toBeVisible({ timeout: 10_000 });
  });

  test("out-of-range DIA input is clamped to the allowed maximum (360 min)", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    // Typing 999 should be clamped to 360 (max).
    await editDiaViaSlider(page, 999);

    await expect.poll(
      () => readDiaMinutes(testUser.userId),
      { timeout: 10_000 },
    ).toBe(360);

    // Reload and verify the subtitle shows "360 min", not "999 min".
    await page.reload();
    await expect(page.getByText("360 min")).toBeVisible({ timeout: 10_000 });
  });

  test("out-of-range DIA input is clamped to the allowed minimum (60 min)", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    // Typing 10 should be clamped to 60 (min).
    await editDiaViaSlider(page, 10);

    await expect.poll(
      () => readDiaMinutes(testUser.userId),
      { timeout: 10_000 },
    ).toBe(60);

    await page.reload();
    await expect(page.getByText("60 min")).toBeVisible({ timeout: 10_000 });
  });
});
