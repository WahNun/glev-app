// End-to-end coverage for editing the user's personal insulin
// parameters (ICR / CF / target BG) from the Settings page.
//
// Why this exists:
//   Task #15 added the DB columns (`user_settings.icr_g_per_unit`,
//   `cf_mgdl_per_unit`, `target_bg_mgdl`) and wired the read path so
//   the unified evaluator / dose recommender consume them, but until
//   Task #40 there was no UI to actually set them — so every user
//   silently fell back to the hardcoded defaults (15 / 50 / 110).
//   Task #40 added three editable rows on /settings; this spec proves
//   the round-trip:
//     1. The new "Target BG" row exists in the Insulin section.
//     2. Editing ICR / CF / Target BG and saving writes the clamped
//        values into the `user_settings` row.
//     3. Reloading the page re-fetches from the DB and surfaces the
//        saved values in the row subtitles (proves the read path,
//        not just an in-memory state update).
//
// We deliberately drive the picker through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → settings page → save handler →
// PostgREST → row subtitle re-render.

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
      "insulin-settings spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface InsulinRow {
  icr_g_per_unit: number | null;
  cf_mgdl_per_unit: number | null;
  target_bg_mgdl: number | null;
}

async function readInsulinSettings(userId: string): Promise<InsulinRow> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("icr_g_per_unit, cf_mgdl_per_unit, target_bg_mgdl")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings read failed: ${error.message}`);
  }
  return {
    icr_g_per_unit: (data?.icr_g_per_unit ?? null) as number | null,
    cf_mgdl_per_unit: (data?.cf_mgdl_per_unit ?? null) as number | null,
    target_bg_mgdl: (data?.target_bg_mgdl ?? null) as number | null,
  };
}

/**
 * Reset the three insulin columns back to NULL so each test starts
 * from the same "fresh user, no saved values" baseline. We use an
 * upsert because the row may not exist yet; nullifying the columns
 * (rather than deleting the row) keeps the user's macro targets and
 * notification prefs intact for any unrelated specs.
 */
async function resetInsulinSettings(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        icr_g_per_unit: null,
        cf_mgdl_per_unit: null,
        target_bg_mgdl: null,
      },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`user_settings reset failed: ${error.message}`);
  }
}

// Locale-agnostic regexes for the rows we drive. The default app
// locale is "de" but Playwright's Chromium reports an English
// Accept-Language header by default, so the runtime locale can flip
// either way depending on the environment.
//
// SettingsRow ariaLabel = "Open <label>" / "<label> öffnen".
const ICR_ROW_ARIA = /(Open Insulin-to-Carb Ratio|Insulin-to-Carb Ratio öffnen|Open Insulin-Carb-Verhältnis|Insulin-Carb-Verhältnis öffnen)/i;
const CF_ROW_ARIA = /(Open Correction Factor|Correction Factor öffnen|Open Korrekturfaktor|Korrekturfaktor öffnen)/i;
const TARGET_BG_ROW_ARIA = /(Open Target BG|Target BG öffnen|Open Ziel-BG|Ziel-BG öffnen)/i;

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
 * Open a settings row by its aria regex, type the given value into
 * the first numeric input in the bottom sheet, click Save, and wait
 * for the sheet to close. The sheet dismisses on a successful save
 * (the SaveFooter calls setOpenSheet(null) when onSave returns true),
 * so we wait for the row button to be visible again as the signal
 * the sheet has closed.
 */
async function editNumericRow(page: Page, rowAria: RegExp, value: number) {
  const row = page.getByRole("button", { name: rowAria });
  await expect(row).toBeVisible();
  await row.click();
  // The sheet body's only number input is the one we're editing.
  const input = page.locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
  // The sheet closes on success — wait for the input to disappear so
  // the next row open doesn't race with the previous sheet's
  // unmount animation.
  await expect(input).toBeHidden({ timeout: 10_000 });
}

test.describe("Settings → Insulin parameters round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetInsulinSettings(testUser.userId);
  });

  test.afterAll(async () => {
    // Defensive: leave the test user with no saved insulin params so
    // any subsequent spec asserting on the default fallback isn't
    // surprised by a stale value.
    await resetInsulinSettings(testUser.userId);
  });

  test("editing ICR / CF / Target BG persists to user_settings", async ({ page }) => {
    await loginAsTestUser(page);

    // ---- INITIAL STATE: no values saved -----------------------------
    expect(await readInsulinSettings(testUser.userId)).toEqual({
      icr_g_per_unit: null,
      cf_mgdl_per_unit: null,
      target_bg_mgdl: null,
    });

    await page.goto("/settings");

    // The three rows should exist in the Insulin section.
    await expect(page.getByRole("button", { name: ICR_ROW_ARIA })).toBeVisible();
    await expect(page.getByRole("button", { name: CF_ROW_ARIA })).toBeVisible();
    await expect(page.getByRole("button", { name: TARGET_BG_ROW_ARIA })).toBeVisible();

    // ---- EDIT EACH ROW ----------------------------------------------
    await editNumericRow(page, ICR_ROW_ARIA, 12);
    await editNumericRow(page, CF_ROW_ARIA, 60);
    await editNumericRow(page, TARGET_BG_ROW_ARIA, 105);

    // ---- DB PERSISTENCE ---------------------------------------------
    // Poll defensively in case the optimistic UI update runs ahead of
    // the Supabase round-trip.
    await expect.poll(
      () => readInsulinSettings(testUser.userId),
      { timeout: 10_000 },
    ).toEqual({
      icr_g_per_unit: 12,
      cf_mgdl_per_unit: 60,
      target_bg_mgdl: 105,
    });

    // ---- READ PATH: subtitles reflect saved values after reload -----
    // Reload the page so the mount effect re-fetches from the DB
    // (rather than reading stale localStorage) — proves the round
    // trip is closed, not just that the in-memory save handler
    // updated state.
    await page.reload();
    // Subtitles render inside the row's right-hand label area. The
    // ICR / CF rows use "1:{value} g/U" / "1:{value} mg/dL"; the
    // Target BG row uses "{value} mg/dL".
    await expect(page.getByText("1:12 g/U")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1:60 mg/dL")).toBeVisible();
    await expect(page.getByText("105 mg/dL")).toBeVisible();
  });

  test("out-of-range inputs are clamped before being persisted", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    // ICR clamp: max 100 (migration CHECK 1..100). Typing 999 should
    // store 100 and surface "1:100 g/U" in the subtitle after save.
    await editNumericRow(page, ICR_ROW_ARIA, 999);
    // Target BG clamp: min 60 (migration CHECK 60..200). Typing 30
    // should store 60.
    await editNumericRow(page, TARGET_BG_ROW_ARIA, 30);

    await expect.poll(
      () => readInsulinSettings(testUser.userId),
      { timeout: 10_000 },
    ).toMatchObject({
      icr_g_per_unit: 100,
      target_bg_mgdl: 60,
    });
  });
});
