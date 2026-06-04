// End-to-end coverage for the alarm BottomSheets in Settings → Sensor & Alarme.
//
// Why this exists:
//   The sensor-alarme page has three alarm BottomSheets (Hypo/Low,
//   Elevated, Hyper/High), each with a toggle switch and a SnapSlider.
//   None were covered by automated tests; a regression here would
//   silently break alarm configuration for users.
//
// What is tested:
//   1. All three alarm rows are visible on /settings/sensor-alarme.
//   2. Opening each sheet renders the toggle switch and SnapSlider.
//   3. Editing the threshold via the SnapSlider tap-to-edit input and
//      saving writes the clamped value to user_settings and closes the sheet.
//   4. After saving, the subtitle row reflects the new threshold.
//   5. Toggling an alarm off saves enabled=false and the subtitle shows "Off".
//   6. Toggling an alarm on (from off state) reveals the SnapSlider.
//   7. Out-of-range values are clamped to the slider's allowed maximum.
//
// Implementation notes:
//   All three threshold sliders share the same ariaLabel key:
//     en: "Alarm threshold (mg/dL)"
//     de: "Auslöseschwelle (mg/dL)"
//   Tests only ever open one sheet at a time so there is no ambiguity.
//
// DB columns (in user_settings):
//   low_alarm_enabled, low_alarm_threshold_mgdl      (range 40–90,   default 70)
//   elevated_alarm_enabled, elevated_alarm_threshold_mgdl (range 100–180, default 140)
//   high_alarm_enabled, high_alarm_threshold_mgdl    (range 140–250, default 200)
//
// Relevant files:
//   - app/(protected)/settings/sensor-alarme/page.tsx
//   - components/log/SnapSlider.tsx
//   - lib/userSettings.ts

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "sensor-alarme spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface AlarmSettings {
  low_alarm_enabled: boolean | null;
  low_alarm_threshold_mgdl: number | null;
  elevated_alarm_enabled: boolean | null;
  elevated_alarm_threshold_mgdl: number | null;
  high_alarm_enabled: boolean | null;
  high_alarm_threshold_mgdl: number | null;
}

async function readAlarmSettings(userId: string): Promise<AlarmSettings> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select(
      "low_alarm_enabled, low_alarm_threshold_mgdl, elevated_alarm_enabled, elevated_alarm_threshold_mgdl, high_alarm_enabled, high_alarm_threshold_mgdl",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings read failed: ${error.message}`);
  }
  return {
    low_alarm_enabled: (data?.low_alarm_enabled ?? null) as boolean | null,
    low_alarm_threshold_mgdl: (data?.low_alarm_threshold_mgdl ?? null) as number | null,
    elevated_alarm_enabled: (data?.elevated_alarm_enabled ?? null) as boolean | null,
    elevated_alarm_threshold_mgdl: (data?.elevated_alarm_threshold_mgdl ?? null) as number | null,
    high_alarm_enabled: (data?.high_alarm_enabled ?? null) as boolean | null,
    high_alarm_threshold_mgdl: (data?.high_alarm_threshold_mgdl ?? null) as number | null,
  };
}

/**
 * Reset all six alarm columns back to NULL so each test starts from
 * the "fresh user, no saved values" baseline. Nullifying rather than
 * deleting the row keeps other settings intact for unrelated specs.
 */
async function resetAlarmSettings(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        low_alarm_enabled: null,
        low_alarm_threshold_mgdl: null,
        elevated_alarm_enabled: null,
        elevated_alarm_threshold_mgdl: null,
        high_alarm_enabled: null,
        high_alarm_threshold_mgdl: null,
      },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`alarm settings reset failed: ${error.message}`);
  }
}

/**
 * Seed specific alarm values directly into the DB so the page loads
 * into a known state before the test interacts with it.
 */
async function seedAlarmSettings(
  userId: string,
  patch: Partial<AlarmSettings>,
) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) {
    throw new Error(`alarm settings seed failed: ${error.message}`);
  }
}

// ── Locale-agnostic aria-label regexes ────────────────────────────────────
//
// SettingsRow buttons:  ariaLabel = t("row_open_aria", { label: t("row_xxx_alarm") })
//   en: "Open Low-glucose alarm" / "Open Elevated alarm" / "Open High-glucose alarm"
//   de: "Hypo-Alarm öffnen"      / "Erhöht-Alarm öffnen" / "Hyper-Alarm öffnen"
const LOW_ROW_ARIA = /(Open Low-glucose alarm|Hypo-Alarm öffnen)/i;
const ELEVATED_ROW_ARIA = /(Open Elevated alarm|Erhöht-Alarm öffnen)/i;
const HIGH_ROW_ARIA = /(Open High-glucose alarm|Hyper-Alarm öffnen)/i;

// Conflict warning banner text (alarm_conflict_warning i18n key).
//   en: "…the alarms overlap."
//   de: "…die Alarme überschneiden sich."
const CONFLICT_WARNING = /(the alarms overlap|die Alarme überschneiden sich)/i;

// SnapSlider tap-to-edit readout button: ariaLabel = threshold label.
// All three sheets use the same translation key (they display identically).
//   en: "Alarm threshold (mg/dL)"
//   de: "Auslöseschwelle (mg/dL)"
const THRESHOLD_SLIDER_ARIA = /(Alarm threshold \(mg\/dL\)|Auslöseschwelle \(mg\/dL\))/i;

const SAVE_BUTTON = /^(Save|Speichern|Saving…|Speichere…|✓ Saved!|✓ Gespeichert!)$/;

// Success toast text (role=status):
//   en: "Alarm setting saved"   de: "Alarm-Einstellung gespeichert"
const SUCCESS_TOAST = /(Alarm setting saved|Alarm-Einstellung gespeichert)/i;

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
 * Open an alarm sheet via its row button, optionally toggle the alarm on
 * if it is currently off, set the threshold via the SnapSlider tap-to-edit
 * number input, and save. Waits until the sheet is fully closed before
 * returning (readout button hidden = sheet unmounted).
 */
async function openSheetAndSetThreshold(
  page: Page,
  rowAria: RegExp,
  threshold: number,
  { ensureEnabled = false }: { ensureEnabled?: boolean } = {},
) {
  const row = page.getByRole("button", { name: rowAria });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  if (ensureEnabled) {
    // If the toggle is currently off, click it to reveal the slider.
    const toggle = page.getByRole("switch");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    const checked = await toggle.getAttribute("aria-checked");
    if (checked !== "true") {
      await toggle.click();
    }
  }

  // The SnapSlider readout button is only rendered when the alarm is enabled.
  const readout = page.getByRole("button", { name: THRESHOLD_SLIDER_ARIA });
  await expect(readout).toBeVisible({ timeout: 10_000 });

  // Tap the readout to enter edit mode, fill the desired value, confirm.
  await readout.click();
  const input = page.locator('input[type="number"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(threshold));
  await input.press("Enter");

  // Save — sheet closes on success.
  await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
  // readout button disappears when the sheet unmounts.
  await expect(readout).toBeHidden({ timeout: 10_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("Sensor & Alarme → alarm rows and sheets", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetAlarmSettings(testUser.userId);
  });

  test.afterAll(async () => {
    await resetAlarmSettings(testUser.userId);
  });

  test("all three alarm rows are visible on /settings/sensor-alarme", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/settings/sensor-alarme");

    await expect(page.getByRole("button", { name: LOW_ROW_ARIA })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: ELEVATED_ROW_ARIA })).toBeVisible();
    await expect(page.getByRole("button", { name: HIGH_ROW_ARIA })).toBeVisible();
  });

  test("Hypo sheet: slider visible when enabled, saving threshold persists to DB and updates subtitle", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: low alarm enabled so the slider is visible without toggling.
    await seedAlarmSettings(testUser.userId, {
      low_alarm_enabled: true,
      low_alarm_threshold_mgdl: 70,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, LOW_ROW_ARIA, 60);

    // DB must reflect the saved threshold (60 is within the valid range 40–90).
    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return s.low_alarm_threshold_mgdl;
      },
      { timeout: 10_000 },
    ).toBe(60);

    // Reload and verify the subtitle reflects the saved value.
    // en: "On · below 60 mg/dL"  /  de: "An · unter 60 mg/dL"
    await page.reload();
    await expect(
      page.getByText(/On · below 60 mg\/dL|An · unter 60 mg\/dL/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Elevated sheet: toggling on reveals slider, saving threshold persists and updates subtitle", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: elevated alarm off (DB default). ensureEnabled will toggle it on.
    await seedAlarmSettings(testUser.userId, {
      elevated_alarm_enabled: false,
      elevated_alarm_threshold_mgdl: 140,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, ELEVATED_ROW_ARIA, 150, { ensureEnabled: true });

    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return { enabled: s.elevated_alarm_enabled, threshold: s.elevated_alarm_threshold_mgdl };
      },
      { timeout: 10_000 },
    ).toEqual({ enabled: true, threshold: 150 });

    // Reload and verify the subtitle.
    // en: "On · above 150 mg/dL"  /  de: "An · über 150 mg/dL"
    await page.reload();
    await expect(
      page.getByText(/On · above 150 mg\/dL|An · über 150 mg\/dL/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("High sheet: toggling on reveals slider, saving threshold persists and updates subtitle", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: high alarm off (DB default). ensureEnabled will toggle it on.
    await seedAlarmSettings(testUser.userId, {
      high_alarm_enabled: false,
      high_alarm_threshold_mgdl: 200,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, HIGH_ROW_ARIA, 180, { ensureEnabled: true });

    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return { enabled: s.high_alarm_enabled, threshold: s.high_alarm_threshold_mgdl };
      },
      { timeout: 10_000 },
    ).toEqual({ enabled: true, threshold: 180 });

    // Reload and verify the subtitle.
    // en: "On · above 180 mg/dL"  /  de: "An · über 180 mg/dL"
    await page.reload();
    await expect(
      page.getByText(/On · above 180 mg\/dL|An · über 180 mg\/dL/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("toggling Hypo alarm off saves enabled=false and subtitle shows Off", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: low alarm on so we can toggle it off.
    await seedAlarmSettings(testUser.userId, {
      low_alarm_enabled: true,
      low_alarm_threshold_mgdl: 70,
    });

    await page.goto("/settings/sensor-alarme");

    // Open the low alarm sheet.
    const row = page.getByRole("button", { name: LOW_ROW_ARIA });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Toggle switch must be on initially.
    const toggle = page.getByRole("switch");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // The slider is visible when enabled.
    await expect(page.getByRole("button", { name: THRESHOLD_SLIDER_ARIA })).toBeVisible();

    // Toggle off — slider should disappear immediately.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: THRESHOLD_SLIDER_ARIA })).toBeHidden();

    // Save and wait for the sheet to close (switch disappears = sheet unmounted).
    await page.getByRole("button", { name: SAVE_BUTTON }).first().click();
    await expect(toggle).toBeHidden({ timeout: 10_000 });

    // DB should store enabled=false.
    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return s.low_alarm_enabled;
      },
      { timeout: 10_000 },
    ).toBe(false);

    // Subtitle on the settings row shows "Off" / "Aus".
    // Use .first() because "Off"/"Aus" could appear for multiple disabled rows.
    await expect(
      page.getByText(/^(Off|Aus)$/).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Hypo threshold above max 90 is clamped to 90 before saving", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: low alarm enabled.
    await seedAlarmSettings(testUser.userId, {
      low_alarm_enabled: true,
      low_alarm_threshold_mgdl: 70,
    });

    await page.goto("/settings/sensor-alarme");

    // Type 999 — the SnapSlider's own min/max clamp lands at 90.
    await openSheetAndSetThreshold(page, LOW_ROW_ARIA, 999);

    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return s.low_alarm_threshold_mgdl;
      },
      { timeout: 10_000 },
    ).toBe(90);

    await page.reload();
    await expect(
      page.getByText(/On · below 90 mg\/dL|An · unter 90 mg\/dL/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Elevated threshold below min 100 is clamped to 100 before saving", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: elevated alarm enabled.
    await seedAlarmSettings(testUser.userId, {
      elevated_alarm_enabled: true,
      elevated_alarm_threshold_mgdl: 140,
    });

    await page.goto("/settings/sensor-alarme");

    // Type 50 — the SnapSlider's min clamp lands at 100.
    await openSheetAndSetThreshold(page, ELEVATED_ROW_ARIA, 50);

    await expect.poll(
      async () => {
        const s = await readAlarmSettings(testUser.userId);
        return s.elevated_alarm_threshold_mgdl;
      },
      { timeout: 10_000 },
    ).toBe(100);

    await page.reload();
    await expect(
      page.getByText(/On · above 100 mg\/dL|An · über 100 mg\/dL/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Elevated sheet: conflict warning appears when elevated threshold ≥ high threshold", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: elevated=180, high=170 → 180 ≥ 170 → conflict must be shown.
    await seedAlarmSettings(testUser.userId, {
      elevated_alarm_enabled: true,
      elevated_alarm_threshold_mgdl: 180,
      high_alarm_enabled: true,
      high_alarm_threshold_mgdl: 170,
    });

    await page.goto("/settings/sensor-alarme");

    // Open the Elevated alarm sheet by clicking its settings row.
    const row = page.getByRole("button", { name: ELEVATED_ROW_ARIA });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Wait for the sheet to be open (toggle switch rendered).
    await expect(page.getByRole("switch")).toBeVisible({ timeout: 10_000 });

    // The yellow conflict warning banner must be visible.
    await expect(page.getByText(CONFLICT_WARNING)).toBeVisible({ timeout: 5_000 });
  });

  test("Elevated sheet: conflict warning absent when elevated threshold < high threshold", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: elevated=150, high=200 → 150 < 200 → no conflict.
    await seedAlarmSettings(testUser.userId, {
      elevated_alarm_enabled: true,
      elevated_alarm_threshold_mgdl: 150,
      high_alarm_enabled: true,
      high_alarm_threshold_mgdl: 200,
    });

    await page.goto("/settings/sensor-alarme");

    // Open the Elevated alarm sheet.
    const row = page.getByRole("button", { name: ELEVATED_ROW_ARIA });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Wait for the sheet to be open (toggle switch rendered).
    await expect(page.getByRole("switch")).toBeVisible({ timeout: 10_000 });

    // No conflict warning banner should be present.
    await expect(page.getByText(CONFLICT_WARNING)).toBeHidden();
  });

  // ── Confirmation UX tests ──────────────────────────────────────────────

  test("subtitle updates immediately after save (no reload required)", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // Seed: low alarm enabled with 70 mg/dL so we can verify the subtitle changes.
    await seedAlarmSettings(testUser.userId, {
      low_alarm_enabled: true,
      low_alarm_threshold_mgdl: 70,
    });

    await page.goto("/settings/sensor-alarme");

    // Save a new threshold (65 mg/dL).
    await openSheetAndSetThreshold(page, LOW_ROW_ARIA, 65);

    // The sheet has now closed. Without any reload, the subtitle on the alarm
    // row must already reflect the new value.
    // en: "On · below 65 mg/dL"  /  de: "An · unter 65 mg/dL"
    await expect(
      page.getByText(/On · below 65 mg\/dL|An · unter 65 mg\/dL/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("success toast appears after saving Hypo alarm threshold", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    await seedAlarmSettings(testUser.userId, {
      low_alarm_enabled: true,
      low_alarm_threshold_mgdl: 70,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, LOW_ROW_ARIA, 68);

    // A success toast (role=status) must become visible after the sheet closes.
    // en: "Alarm setting saved"  /  de: "Alarm-Einstellung gespeichert"
    await expect(
      page.getByRole("status").filter({ hasText: SUCCESS_TOAST }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("success toast appears after saving Elevated alarm threshold", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    await seedAlarmSettings(testUser.userId, {
      elevated_alarm_enabled: true,
      elevated_alarm_threshold_mgdl: 140,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, ELEVATED_ROW_ARIA, 155);

    await expect(
      page.getByRole("status").filter({ hasText: SUCCESS_TOAST }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("success toast appears after saving High alarm threshold", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    await seedAlarmSettings(testUser.userId, {
      high_alarm_enabled: true,
      high_alarm_threshold_mgdl: 200,
    });

    await page.goto("/settings/sensor-alarme");

    await openSheetAndSetThreshold(page, HIGH_ROW_ARIA, 190);

    await expect(
      page.getByRole("status").filter({ hasText: SUCCESS_TOAST }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
