// End-to-end coverage for the CF (Correction Factor) and Target BG
// SnapSliders in Settings → Insulin section.
//
// Why this exists:
//   Task #634 — CF, Target BG, and DIA now use SnapSlider components.
//   The existing insulin-settings.spec.ts drives those sheets through a
//   plain `input[type="number"]` locator that would still pass even if
//   the SnapSlider was removed and replaced with a bare text field.
//   This spec specifically verifies:
//     1. The SnapSlider readout button renders with the expected aria-label.
//     2. The tap-to-edit flow (click readout → number input → Enter)
//        commits the correct value.
//     3. Saving writes the clamped value to user_settings and the subtitle
//        reflects it after a full page reload (closed read-path loop).
//   For Target BG, two distinct tick positions are exercised (80 and 140).
//
// Implementation notes:
//   The SnapSlider tap-to-edit readout button has aria-label equal to the
//   ariaLabel prop passed to the component:
//     CF        → tSettings("correction_factor") = "Correction Factor" (en)
//                                                  "Korrekturfaktor"   (de)
//     Target BG → tSettings("row_target_bg")     = "Target BG" (en)
//                                                  "Ziel-BG"   (de)
//   We avoid pointer-coordinate drag gestures (brittle in headless Chromium)
//   and drive values through the tap-to-edit number input instead — the
//   same technique used in settings-dia-slider.spec.ts.
//
// Relevant files:
//   - app/(protected)/settings/page.tsx  — CF + Target BG sheets, SnapSlider wiring
//   - components/log/SnapSlider.tsx       — tap-to-edit readout + role="slider"
//   - lib/userSettings.ts                — saveInsulinSettings, cf_mgdl_per_unit, target_bg_mgdl

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "settings-sliders spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SliderRow {
  cf_mgdl_per_unit: number | null;
  target_bg_mgdl: number | null;
}

async function readSliderSettings(userId: string): Promise<SliderRow> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("cf_mgdl_per_unit, target_bg_mgdl")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings read failed: ${error.message}`);
  }
  return {
    cf_mgdl_per_unit: (data?.cf_mgdl_per_unit ?? null) as number | null,
    target_bg_mgdl: (data?.target_bg_mgdl ?? null) as number | null,
  };
}

/**
 * Reset CF and Target BG back to NULL so each test starts from the same
 * "fresh user, no saved values" baseline. Nullifying the columns keeps
 * every other setting intact for unrelated specs.
 */
async function resetSliderSettings(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, cf_mgdl_per_unit: null, target_bg_mgdl: null },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`slider settings reset failed: ${error.message}`);
  }
}

// ── Locale-agnostic aria-label regexes ───────────────────────────────────
//
// SettingsRow (opens the sheet):
//   aria-label = "Open <label>" / "<label> öffnen"
const CF_ROW_ARIA =
  /(Open Correction Factor|Correction Factor öffnen|Open Korrekturfaktor|Korrekturfaktor öffnen)/i;
const TARGET_BG_ROW_ARIA =
  /(Open Target BG|Target BG öffnen|Open Ziel-BG|Ziel-BG öffnen)/i;

// SnapSlider readout button (inside the sheet):
//   aria-label = tSettings("correction_factor") / tSettings("row_target_bg")
const CF_SLIDER_READOUT = /(^Correction Factor$|^Korrekturfaktor$)/i;
const TARGET_BG_SLIDER_READOUT = /(^Target BG$|^Ziel-BG$)/i;

const SAVE_BUTTON = /^(Save|Speichern|Saving…|Speichere…|✓ Saved!|✓ Gespeichert!)$/;

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
 * Open a Settings sheet via its row button, confirm the SnapSlider readout
 * button is rendered (proving the slider mounted correctly), then edit the
 * value via the tap-to-edit number input and save.
 *
 * Returns once the sheet has closed (readout button hidden).
 */
async function editViaSnapSlider(
  page: Page,
  rowAria: RegExp,
  sliderReadoutAria: RegExp,
  value: number,
) {
  // Open the sheet.
  const row = page.getByRole("button", { name: rowAria });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  // The SnapSlider readout button must be visible — this is the regression
  // guard: if the slider was replaced by a plain text field the button
  // with the slider's aria-label would be absent and the test would fail here.
  const readout = page.getByRole("button", { name: sliderReadoutAria });
  await expect(readout).toBeVisible({ timeout: 10_000 });

  // Also confirm the drag surface (role="slider") is present in the sheet.
  const sliderTrack = page.getByRole("slider", { name: sliderReadoutAria });
  await expect(sliderTrack).toBeVisible();

  // Tap the readout to enter editing mode.
  await readout.click();

  // The readout is replaced by an autoFocused <input type="number">.
  const input = page.locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press("Enter");

  // Click Save and wait for the sheet to close.
  await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
  // Sheet closed = readout button disappears (component unmounted).
  await expect(readout).toBeHidden({ timeout: 10_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Settings → CF slider round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => { testUser = loadTestUserByIndex(test.info().workerIndex); });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetSliderSettings(testUser.userId);
  });

  test.afterAll(async () => {
    await resetSliderSettings(testUser.userId);
  });

  test("CF SnapSlider renders, edits persist to user_settings, subtitle reflects saved value", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Confirm starting state: no value saved yet.
    expect((await readSliderSettings(testUser.userId)).cf_mgdl_per_unit).toBeNull();

    await page.goto("/settings");

    // ---- EDIT: set CF to 40 ------------------------------------------
    await editViaSnapSlider(page, CF_ROW_ARIA, CF_SLIDER_READOUT, 40);

    // ---- DB PERSISTENCE ---------------------------------------------
    await expect.poll(
      async () => (await readSliderSettings(testUser.userId)).cf_mgdl_per_unit,
      { timeout: 10_000 },
    ).toBe(40);

    // ---- READ PATH: subtitle shows the saved value after page reload --
    await page.reload();
    // subtitle_cf = "1:{value} mg/dL"
    await expect(page.getByText("1:40 mg/dL")).toBeVisible({ timeout: 10_000 });
  });

  test("CF value above slider maximum is clamped to 100 before saving", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/settings");

    // The CF slider max is 100. The tap-to-edit input clamps to the
    // slider's own min/max, so typing 200 lands at 100.
    await editViaSnapSlider(page, CF_ROW_ARIA, CF_SLIDER_READOUT, 200);

    await expect.poll(
      async () => (await readSliderSettings(testUser.userId)).cf_mgdl_per_unit,
      { timeout: 10_000 },
    ).toBe(100);

    await page.reload();
    await expect(page.getByText("1:100 mg/dL")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Settings → Target BG slider round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => { testUser = loadTestUserByIndex(test.info().workerIndex); });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetSliderSettings(testUser.userId);
  });

  test.afterAll(async () => {
    await resetSliderSettings(testUser.userId);
  });

  test("Target BG SnapSlider renders and persists 80 mg/dL (first tick position)", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    expect((await readSliderSettings(testUser.userId)).target_bg_mgdl).toBeNull();

    await page.goto("/settings");

    // ---- EDIT: set Target BG to 80 (first labelled tick) -----------
    await editViaSnapSlider(page, TARGET_BG_ROW_ARIA, TARGET_BG_SLIDER_READOUT, 80);

    await expect.poll(
      async () => (await readSliderSettings(testUser.userId)).target_bg_mgdl,
      { timeout: 10_000 },
    ).toBe(80);

    await page.reload();
    // subtitle_target_bg = "{value} mg/dL"
    await expect(page.getByText("80 mg/dL")).toBeVisible({ timeout: 10_000 });
  });

  test("Target BG SnapSlider persists 140 mg/dL (second tick position)", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/settings");

    // ---- EDIT: set Target BG to 140 (mid-range labelled tick) ------
    await editViaSnapSlider(page, TARGET_BG_ROW_ARIA, TARGET_BG_SLIDER_READOUT, 140);

    await expect.poll(
      async () => (await readSliderSettings(testUser.userId)).target_bg_mgdl,
      { timeout: 10_000 },
    ).toBe(140);

    await page.reload();
    await expect(page.getByText("140 mg/dL")).toBeVisible({ timeout: 10_000 });
  });

  test("Target BG value below slider minimum is clamped to 60 before saving", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/settings");

    // The Target BG slider min is 60. Typing 30 is clamped by the
    // tap-to-edit input to 60.
    await editViaSnapSlider(page, TARGET_BG_ROW_ARIA, TARGET_BG_SLIDER_READOUT, 30);

    await expect.poll(
      async () => (await readSliderSettings(testUser.userId)).target_bg_mgdl,
      { timeout: 10_000 },
    ).toBe(60);

    await page.reload();
    await expect(page.getByText("60 mg/dL")).toBeVisible({ timeout: 10_000 });
  });
});
