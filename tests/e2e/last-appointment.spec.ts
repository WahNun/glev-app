// End-to-end coverage for the "Letzter Arzttermin" feature (Task #75).
//
// Why this exists:
//   Task #75 grew two coupled UI surfaces: a date picker on /settings
//   and a conditional 5th preset chip on /export. The two pieces share
//   one source of truth (`user_settings.last_appointment_at`), so the
//   only way to prove the round-trip works is to drive the real flow
//   end-to-end:
//     1. Set a date in Settings → DB row updates.
//     2. Visit /export → the new chip appears with the saved date.
//     3. Clear the date in Settings → DB row goes back to NULL.
//     4. Visit /export → the chip is gone again.
//   A unit test on `saveLastAppointment` would catch (1) only, and
//   would silently miss the conditional-render contract on the chip
//   row that's actually the user-facing payoff of the task.
//
// What this asserts (and why each piece matters):
//   * Default state: a fresh user has no `last_appointment_at`, and
//     the Export chip row therefore renders exactly the original four
//     chips — Alles / 30d / 90d / Custom — with no fifth chip leaking
//     into the row before the user opts in.
//   * Setting a date persists to `user_settings.last_appointment_at`
//     (verified via the service-role admin client — the same channel
//     the carb-unit-picker spec uses).
//   * The Export chip row gains a new chip whose label embeds the
//     saved date in the user's locale. We do NOT assert the exact
//     translation string — only that the chip exists and contains
//     the formatted date — so the spec is stable across English /
//     German runs of Playwright (Accept-Language varies by env).
//   * Clearing the date in Settings writes NULL back to the row AND
//     removes the chip from the Export panel. This is the strongest
//     check — a regression that left a stale chip visible after a
//     clear would silently re-prefill exports with the wrong window.
//
// We deliberately drive the picker through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → settings page → date input → upsert →
// PostgREST → Export panel fetch effect.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

/**
 * Same admin client shape `tests/support/testUser.ts` uses. We can't
 * import the helper itself (it doesn't expose the client), but the
 * env vars are already required for the suite to run, so re-creating
 * the client here is a one-liner with no extra setup risk.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "last-appointment spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Read the persisted date directly from PostgREST. We return a `string`
 * because the column is a Postgres `date`, which PostgREST serializes
 * as `YYYY-MM-DD` — and a `null` because the column is nullable and
 * the "cleared" state is the most important thing this spec asserts.
 */
async function readPersistedAppointment(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("last_appointment_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`user_settings.last_appointment_at read failed: ${error.message}`);
  }
  return (data?.last_appointment_at ?? null) as string | null;
}

/**
 * Reset the persisted date back to NULL so each test starts from a
 * pristine baseline regardless of how a previous run left the row.
 * Uses upsert so a brand-new user (no row yet) is handled the same
 * way as an existing user (row present, value non-null).
 */
async function clearAppointment(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, last_appointment_at: null },
      { onConflict: "user_id" },
    );
  if (error) {
    throw new Error(`user_settings.last_appointment_at clear failed: ${error.message}`);
  }
}

// Locale-agnostic regexes for the labels we drive. The default app
// locale is "de" (see `lib/locale.ts`), but Playwright's Chromium
// reports an English Accept-Language header by default, so the active
// locale at runtime can flip either way depending on the environment.
//
// SettingsRow ariaLabel = "Open <label>" / "<label> öffnen". The
// localized label is "Letzter Arzttermin" / "Last appointment".
const LAST_APPT_ROW_ARIA = /(Open Last appointment|Last appointment öffnen|Open Letzter Arzttermin|Letzter Arzttermin öffnen)/i;
// ExportPanel is rendered inside the "Daten exportieren" / "Export data"
// row's bottom sheet, NOT as its own /export route. We open it the
// same way a user would: navigate to /settings and tap that row.
const EXPORT_ROW_ARIA = /(Open Export data|Export data öffnen|Open Daten exportieren|Daten exportieren öffnen)/i;
// The chip label embeds the formatted date inside parentheses:
//   DE: "Seit letztem Arzttermin (15.01.2026)"
//   EN: "Since last appointment (15.01.2026)"
// The date itself is rendered with `{ year: "numeric", month: "2-digit",
// day: "2-digit" }`, which produces "15.01.2026" in both de-DE and en-GB
// but "01/15/2026" in en-US. We assert via a date-substring match so
// the spec stays stable across both axes (locale + region).
const LAST_APPT_CHIP_DATE_DE = /(Seit letztem Arzttermin|Since last appointment).*15[./]01[./]2026/;
const LAST_APPT_CHIP_DATE_US = /(Seit letztem Arzttermin|Since last appointment).*01\/15\/2026/;
// "All" / "Alles" / "30d" / "90d" / "Custom" / "Eigener Zeitraum"
// chips are always present — we assert their count to prove the
// chip row count goes from 4 → 5 → 4 across the flow.
//
// We can't pin the chip row by an aria-label (it has none), so we
// match chips by their rendered text via a single union regex and
// count the visible buttons that satisfy it.
const ANY_CHIP_LABEL = /^(All time|Alles|Last 30 days|Letzte 30 Tage|Last 90 days|Letzte 90 Tage|Custom range|Eigener Zeitraum|Since last appointment.*|Seit letztem Arzttermin.*)$/;

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

test.describe("Settings → Letzter Arzttermin → Export chip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    // Pristine baseline: clear cookies + reset the row so the initial-
    // state assertion ("no chip") doesn't depend on how a previous
    // spec left the user.
    await context.clearCookies();
    await clearAppointment(testUser.userId);
  });

  test.afterAll(async () => {
    // Defensive: leave the test user with no appointment date, so
    // any subsequent spec that asserts on the chip row's default
    // shape isn't surprised by a stale value.
    await clearAppointment(testUser.userId);
  });

  test("setting a date renders the chip; clearing the date hides it", async ({ page }) => {
    await loginAsTestUser(page);

    // ---- INITIAL STATE: no chip in the Export sheet ------------------
    // The chip is conditionally rendered only when the saved date is
    // non-null, so a fresh user must see exactly the original four
    // chips (Alles / 30d / 90d / Custom). We assert the chip count
    // rather than the absence of a specific label so that a regression
    // adding a *different* fifth chip (e.g. flipped condition) would
    // also fail this guard.
    expect(await readPersistedAppointment(testUser.userId)).toBeNull();

    await page.goto("/settings");
    const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA });
    await expect(exportRow).toBeVisible();
    await exportRow.click();

    // Wait for the panel's lastAppointment fetch effect to settle —
    // otherwise the chip count could race with the initial render
    // and produce a flaky 4 vs 5 read. The simplest deterministic
    // signal is the "All time" / "Alles" chip, which is always in
    // the row regardless of the appointment value.
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(4);

    // Close the export sheet so we can open the lastAppointment one
    // (BottomSheet renders one sheet at a time — opening a second
    // would replace the first, but Escape is the cleaner contract).
    await page.keyboard.press("Escape");

    // ---- SET DATE IN SETTINGS ---------------------------------------
    const lastApptRow = page.getByRole("button", { name: LAST_APPT_ROW_ARIA });
    await expect(lastApptRow).toBeVisible();
    await lastApptRow.click();

    // Drive the native date input directly. `<input type="date">`
    // accepts a YYYY-MM-DD string via .fill() in Chromium without
    // needing the picker UI.
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-01-15");

    // Click "Save" in the sheet footer. There may be other "Save"
    // buttons elsewhere on /settings, but only the open sheet's
    // footer button is visible at this moment, so .first() is safe.
    await page.getByRole("button", { name: /^(Save|Speichern)$/ }).first().click();

    // ---- DB PERSISTENCE ---------------------------------------------
    // saveLastAppointment() is awaited synchronously inside the save
    // handler (it returns a Promise<boolean>), so by the time the
    // sheet closes the row should already reflect the new value.
    // Poll defensively in case the sheet-close animation runs ahead
    // of the Supabase round-trip.
    await expect.poll(
      () => readPersistedAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBe("2026-01-15");

    // ---- EXPORT PANEL: chip appears ---------------------------------
    // Re-open the export sheet. The ExportPanel mounts fresh each
    // open (since BottomSheet conditionally renders body), so its
    // fetchLastAppointment effect will pick up the new value.
    await page.keyboard.press("Escape");
    await exportRow.click();
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();
    // Match either de-DE / en-GB (15.01.2026) or en-US (01/15/2026)
    // formatting so the spec is stable across Playwright host
    // locales — the date itself is the same instant either way.
    const apptChip = page
      .getByRole("button", { name: LAST_APPT_CHIP_DATE_DE })
      .or(page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }));
    await expect(apptChip).toBeVisible({ timeout: 10_000 });
    // Chip row count: exactly 5 (the original 4 + the new lastAppointment chip).
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(5);

    // ---- CLEAR DATE IN SETTINGS -------------------------------------
    await page.keyboard.press("Escape");
    await lastApptRow.click();
    // The sheet's "Clear date" button wipes the input value back to "".
    // Localized label: "Clear date" / "Datum löschen".
    await page.getByRole("button", { name: /^(Clear date|Datum löschen)$/ }).click();
    await expect(dateInput).toHaveValue("");
    await page.getByRole("button", { name: /^(Save|Speichern)$/ }).first().click();

    // DB now back to NULL — the upsert path passes `null` through
    // when the input value is the empty string (see saveLastAppointmentAction).
    await expect.poll(
      () => readPersistedAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBeNull();

    // ---- EXPORT PANEL: chip disappears ------------------------------
    await page.keyboard.press("Escape");
    await exportRow.click();
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(4);
    // And specifically the lastAppointment chip is gone.
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_DE }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }),
    ).toHaveCount(0);
  });
});
