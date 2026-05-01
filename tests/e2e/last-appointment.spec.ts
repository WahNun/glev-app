// End-to-end coverage for the "Arzttermine" feature (Task #75 → #93).
//
// Why this exists:
//   Task #75 grew two coupled UI surfaces: a date control on /settings
//   and a conditional 5th preset chip on /export. Task #93 then
//   replaced the single `user_settings.last_appointment_at` scalar
//   with a full `appointments` list, so the Settings sheet now drives
//   add/edit/delete CRUD against a separate table while the Export
//   chip continues to surface only the most-recent entry. The two
//   sides share one source of truth (the `appointments` table), so
//   the only way to prove the round-trip works is to drive the real
//   flow end-to-end:
//     1. Add an appointment in Settings → row inserted into `appointments`.
//     2. Visit /export → the new chip appears with the saved date.
//     3. Delete the appointment in Settings → row gone again.
//     4. Visit /export → the chip is gone again.
//   A unit test on `addAppointment` would catch (1) only, and would
//   silently miss the conditional-render contract on the chip row
//   that's actually the user-facing payoff of the feature.
//
// What this asserts (and why each piece matters):
//   * Default state: a fresh user has no appointments, and the Export
//     chip row therefore renders exactly the original four chips —
//     Alles / 30d / 90d / Custom — with no fifth chip leaking into
//     the row before the user opts in.
//   * Adding an appointment persists into `appointments` (verified
//     via the service-role admin client — same channel as the
//     carb-unit-picker spec).
//   * The Export chip row gains a new chip whose label embeds the
//     saved date in the user's locale. We do NOT assert the exact
//     translation string — only that the chip exists and contains
//     the formatted date — so the spec is stable across English /
//     German runs of Playwright (Accept-Language varies by env).
//   * Deleting the appointment in Settings removes the row from the
//     table AND removes the chip from the Export panel. This is the
//     strongest check — a regression that left a stale chip visible
//     after a delete would silently re-prefill exports with the
//     wrong window.
//
// We deliberately drive the picker through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → settings page → add/delete handler →
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
 * Read the most-recent persisted appointment date directly from
 * PostgREST. We return a `string` because `appointment_at` is a
 * Postgres `date`, which PostgREST serializes as `YYYY-MM-DD`, and a
 * `null` because the "no appointments yet" baseline is the most
 * important thing this spec asserts.
 */
async function readLatestAppointment(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("appointments")
    .select("appointment_at")
    .eq("user_id", userId)
    .order("appointment_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`appointments read failed: ${error.message}`);
  }
  return (data?.appointment_at ?? null) as string | null;
}

/**
 * Reset the test user back to "no appointments" so each test starts
 * from a pristine baseline regardless of how a previous run left the
 * row. Also clears `user_settings.last_appointment_at` so the
 * idempotent migration backfill can't silently reintroduce a stale
 * appointment if the test re-runs against the same user.
 */
async function resetAppointments(userId: string) {
  const admin = getAdminClient();
  const { error: delErr } = await admin
    .from("appointments")
    .delete()
    .eq("user_id", userId);
  if (delErr) {
    throw new Error(`appointments clear failed: ${delErr.message}`);
  }
  // Also wipe the legacy scalar so the migration's backfill (which is
  // idempotent on the SQL level — `INSERT … ON CONFLICT DO NOTHING`
  // — and the still-readable column on `user_settings`) can't sneak
  // a row back in if someone re-runs the migration mid-suite.
  const { error: upErr } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, last_appointment_at: null },
      { onConflict: "user_id" },
    );
  if (upErr) {
    throw new Error(`user_settings reset failed: ${upErr.message}`);
  }
}

// Locale-agnostic regexes for the labels we drive. The default app
// locale is "de" (see `lib/locale.ts`), but Playwright's Chromium
// reports an English Accept-Language header by default, so the active
// locale at runtime can flip either way depending on the environment.
//
// SettingsRow ariaLabel = "Open <label>" / "<label> öffnen". The
// localized label is "Doctor appointments" / "Arzttermine" (the row
// title key changed from `last_appointment_title` to
// `appointments_title` in Task #93).
const APPTS_ROW_ARIA = /(Open Doctor appointments|Doctor appointments öffnen|Open Arzttermine|Arzttermine öffnen)/i;
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

test.describe("Settings → Arzttermine → Export chip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    // Pristine baseline: clear cookies + reset rows so the initial-
    // state assertion ("no chip") doesn't depend on how a previous
    // spec left the user.
    await context.clearCookies();
    await resetAppointments(testUser.userId);
  });

  test.afterAll(async () => {
    // Defensive: leave the test user with no appointments, so any
    // subsequent spec that asserts on the chip row's default shape
    // isn't surprised by a stale value.
    await resetAppointments(testUser.userId);
  });

  test("adding an appointment renders the chip; deleting it hides it", async ({ page }) => {
    await loginAsTestUser(page);

    // ---- INITIAL STATE: no chip in the Export sheet ------------------
    // The chip is conditionally rendered only when the saved list is
    // non-empty, so a fresh user must see exactly the original four
    // chips (Alles / 30d / 90d / Custom). We assert the chip count
    // rather than the absence of a specific label so that a regression
    // adding a *different* fifth chip (e.g. flipped condition) would
    // also fail this guard.
    expect(await readLatestAppointment(testUser.userId)).toBeNull();

    await page.goto("/settings");
    const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA });
    await expect(exportRow).toBeVisible();
    await exportRow.click();

    // Wait for the panel's appointments fetch effect to settle —
    // otherwise the chip count could race with the initial render
    // and produce a flaky 4 vs 5 read. The simplest deterministic
    // signal is the "All time" / "Alles" chip, which is always in
    // the row regardless of the appointment value.
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(4);

    // Close the export sheet so we can open the appointments one
    // (BottomSheet renders one sheet at a time — opening a second
    // would replace the first, but Escape is the cleaner contract).
    await page.keyboard.press("Escape");

    // ---- ADD APPOINTMENT IN SETTINGS --------------------------------
    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // Drive the native date input directly. The add form lives at the
    // top of the sheet body, so the first visible `input[type="date"]`
    // is its date field. `<input type="date">` accepts a YYYY-MM-DD
    // string via .fill() in Chromium without needing the picker UI.
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-01-15");

    // Click the "Add" / "Hinzufügen" button to commit the new
    // appointment. The handler awaits `addAppointment()` and then
    // re-fetches the list, so by the time the button's busy state
    // clears the row should already be in the DB.
    await page.getByRole("button", { name: /^(Add|Hinzufügen)$/ }).click();

    // ---- DB PERSISTENCE ---------------------------------------------
    // Poll defensively in case the optimistic UI update runs ahead of
    // the Supabase round-trip.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBe("2026-01-15");

    // ---- EXPORT PANEL: chip appears ---------------------------------
    // Re-open the export sheet. The ExportPanel mounts fresh each
    // open (since BottomSheet conditionally renders body), so its
    // fetchAppointments effect will pick up the new value.
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
    // Note: with only one appointment saved, the "..." picker trigger
    // is suppressed (it only renders for 2+ appointments), so the chip
    // count remains a clean 5 here.
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(5);

    // ---- DELETE APPOINTMENT IN SETTINGS -----------------------------
    await page.keyboard.press("Escape");
    await apptsRow.click();
    // The list renders one "Delete" / "Löschen" button per row. With
    // exactly one appointment saved there is exactly one such button.
    // The handler shows a confirm() dialog before deleting; auto-accept
    // it so the test doesn't hang on the native modal.
    page.once("dialog", (d) => { void d.accept(); });
    await page.getByRole("button", { name: /^(Delete|Löschen)$/ }).click();

    // DB now back to "no appointments" — the row was hard-deleted, so
    // the latest-row helper returns null again.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
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
