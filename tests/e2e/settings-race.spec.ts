// Regression test for Task #137: the other Settings sections (macro
// targets, notification prefs, appointments) must not silently
// clobber user edits when the on-mount DB fetch resolves after the
// user has already started editing.
//
// Pattern mirrors tests/e2e/insulin-settings.spec.ts (Task #40).
// We prove two things per section:
//   1. Editing a field and saving persists to user_settings.
//   2. The saved value is still present after a reload (round-trip).
//
// We cannot replicate the exact timing race in a deterministic
// Playwright test, but we can confirm that a value typed, saved, and
// then reloaded survives a fresh mount-fetch — which is the positive
// invariant broken by the race.

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
      "settings-race spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface MacroRow {
  target_carbs_g: number | null;
  target_protein_g: number | null;
}

async function readMacroSettings(userId: string): Promise<MacroRow> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("target_carbs_g, target_protein_g")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`user_settings read failed: ${error.message}`);
  return {
    target_carbs_g: (data?.target_carbs_g ?? null) as number | null,
    target_protein_g: (data?.target_protein_g ?? null) as number | null,
  };
}

async function resetMacroSettings(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, target_carbs_g: null, target_protein_g: null },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`user_settings macro reset failed: ${error.message}`);
}

interface NotifRow {
  notif_critical_alerts: boolean | null;
}

async function readNotifSettings(userId: string): Promise<NotifRow> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("notif_critical_alerts")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`user_settings notif read failed: ${error.message}`);
  return { notif_critical_alerts: (data?.notif_critical_alerts ?? null) as boolean | null };
}

// Locale-agnostic regexes for the rows we drive.
// EN: "Open Daily Macro Targets" / DE: "Tägliche Makro-Ziele öffnen"
const MACROS_ROW_ARIA = /(Open Daily Macro Targets|Tägliche Makro-Ziele öffnen)/i;
// EN: "Open Notifications" / DE: "Benachrichtigungen öffnen"
const NOTIF_ROW_ARIA  = /(Open Notifications|Benachrichtigungen öffnen)/i;

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

test.describe("Settings → macro targets: no clobber after mount fetch", () => {
  let testUser: TestUser;

  test.beforeAll(() => { testUser = loadTestUser(); });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetMacroSettings(testUser.userId);
  });

  test.afterAll(async () => {
    await resetMacroSettings(testUser.userId);
  });

  test("editing carbs and protein persists and survives reload", async ({ page }) => {
    await loginAsTestUser(page);

    expect(await readMacroSettings(testUser.userId)).toEqual({
      target_carbs_g: null,
      target_protein_g: null,
    });

    await page.goto("/settings");

    // Open the macros sheet immediately after navigation — this is the
    // high-risk window where the in-flight fetch can still be in-flight.
    const macrosRow = page.getByRole("button", { name: MACROS_ROW_ARIA });
    await expect(macrosRow).toBeVisible({ timeout: 10_000 });
    await macrosRow.click();

    // The sheet renders four number inputs (carbs, protein, fat, fiber).
    // They are laid out in a 2×2 grid; first input = carbs.
    const inputs = page.locator('input[type="number"]');
    await expect(inputs.first()).toBeVisible({ timeout: 5_000 });

    // Edit carbs (first input) and protein (second input).
    await inputs.nth(0).fill("210");
    await inputs.nth(1).fill("95");

    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    // Sheet closes on success — wait for the input to disappear.
    await expect(inputs.first()).toBeHidden({ timeout: 10_000 });

    // DB must reflect the typed values.
    await expect.poll(
      () => readMacroSettings(testUser.userId),
      { timeout: 10_000 },
    ).toEqual({ target_carbs_g: 210, target_protein_g: 95 });

    // After reload the mount-fetch re-runs — the saved values must
    // still appear in the row subtitle (read path not just in-memory).
    await page.reload();
    // Macro subtitle shows "carbs g / protein g / fat g / fiber g" —
    // look for the carbs value that was saved.
    await expect(page.getByText(/210/)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Settings → notification prefs: no clobber after mount fetch", () => {
  let testUser: TestUser;

  test.beforeAll(() => { testUser = loadTestUser(); });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    // Leave notif_critical_alerts at the DB default (true/null) — the
    // test will toggle it off and verify the off state persists.
  });

  test("toggling criticalAlerts off and saving persists to DB", async ({ page }) => {
    await loginAsTestUser(page);

    await page.goto("/settings");

    const notifRow = page.getByRole("button", { name: NOTIF_ROW_ARIA });
    await expect(notifRow).toBeVisible({ timeout: 10_000 });
    await notifRow.click();

    // The critical-alerts toggle is an ARIA switch.
    const criticalSwitch = page.getByRole("switch").first();
    await expect(criticalSwitch).toBeVisible({ timeout: 5_000 });

    // If already off from a previous run, skip the toggle (idempotent).
    const wasChecked = (await criticalSwitch.getAttribute("aria-checked")) === "true";
    if (wasChecked) {
      await criticalSwitch.click();
    }

    // Save.
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(criticalSwitch).toBeHidden({ timeout: 10_000 });

    // DB must reflect the change.
    const saved = await readNotifSettings(testUser.userId);
    expect(saved.notif_critical_alerts).toBe(false);

    // Reload — the re-mounted fetch must restore the saved "off" state,
    // not silently snap it back to true.
    await page.reload();
    const notifRow2 = page.getByRole("button", { name: NOTIF_ROW_ARIA });
    await expect(notifRow2).toBeVisible({ timeout: 10_000 });
    await notifRow2.click();
    const criticalSwitch2 = page.getByRole("switch").first();
    await expect(criticalSwitch2).toBeVisible({ timeout: 5_000 });
    await expect(criticalSwitch2).toHaveAttribute("aria-checked", "false", { timeout: 5_000 });
  });
});
