// End-to-end coverage for the "Arzttermine" feature (Task #75 → #93 → #112).
//
// Why this exists:
//   Task #75 grew two coupled UI surfaces: a date control on /settings
//   and a conditional 5th preset chip on /export. Task #93 then
//   replaced the single `user_settings.last_appointment_at` scalar
//   with a full `appointments` list, so the Settings sheet now drives
//   add/edit/delete CRUD against a separate table while the Export
//   chip continues to surface only the most-recent entry. Task #112
//   extended coverage to the doctor-friendly note that each appointment
//   row carries: persistence through reload, forwarding into the PDF
//   cover, the disabled-when-no-date guard, and the 200-char cap.
//   The two sides share one source of truth (the `appointments` table),
//   so the only way to prove the round-trip works is to drive the real
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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
 * Read the `note` column of the most-recent appointment row directly
 * via the admin client (bypasses RLS). Returns `null` when the user
 * has no appointments or when the latest row's note is NULL / empty.
 * Used by the note round-trip specs to confirm a note that was typed
 * in the UI reached the database, and that a deletion really removes it.
 */
async function readLatestAppointmentNote(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("appointments")
    .select("note")
    .eq("user_id", userId)
    .order("appointment_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`appointments note read failed: ${error.message}`);
  }
  const raw = (data as { note?: string | null } | null)?.note ?? null;
  return raw && raw.trim() !== "" ? raw : null;
}

/**
 * Seed an appointment row directly via the admin client so note-
 * focused tests can skip the add-via-UI flow and focus purely on the
 * read / export / delete side. Returns the inserted row's id so
 * callers can reference it in cleanup helpers.
 */
async function seedAppointmentWithNote(
  admin: SupabaseClient,
  userId: string,
  appointmentAt: string,
  note: string,
): Promise<string> {
  const { data, error } = await admin
    .from("appointments")
    .insert({
      user_id: userId,
      appointment_at: appointmentAt,
      note: note.trim() || null,
      tags: [],
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`appointment seed failed: ${error?.message ?? "no data"}`);
  return (data as { id: string }).id;
}

/**
 * Read the legacy `user_settings.last_appointment_note` column
 * directly via the admin client. The column still exists in the
 * schema (migration 20260501_add_user_settings_last_appointment_note.sql)
 * even though the application has migrated reads to the `appointments`
 * table. Used by the "clear-date wipes note" test to confirm that
 * the export does NOT fall back to this stale value after the
 * appointment row is deleted.
 */
async function readLegacyUserSettingsNote(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("user_settings")
    .select("last_appointment_note")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`user_settings note read failed: ${error.message}`);
  const raw = (data as { last_appointment_note?: string | null } | null)
    ?.last_appointment_note ?? null;
  return raw && raw.trim() !== "" ? raw : null;
}

/**
 * Write a stale note into `user_settings.last_appointment_note` so
 * the "clear-date" test can verify the export ignores it once the
 * corresponding `appointments` row is deleted.
 */
async function seedLegacyUserSettingsNote(userId: string, note: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, last_appointment_note: note },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`user_settings note seed failed: ${error.message}`);
}

/**
 * Reset the test user back to "no appointments" so each test starts
 * from a pristine baseline regardless of how a previous run left the
 * row.
 *
 * Note: Task #113 dropped `user_settings.last_appointment_at` and
 * `last_appointment_note`. The legacy upsert that used to null those
 * columns is removed — the `appointments` table is the sole source of
 * truth now.
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

  // -----------------------------------------------------------------------
  // Picker test — two appointments
  // -----------------------------------------------------------------------
  // Why a separate test:
  //   The "..." trigger only renders when the user has 2+ appointments.
  //   The test above deliberately keeps only one appointment so its chip-
  //   count assertions (4 → 5 → 4) stay clean and unambiguous.  This test
  //   focuses entirely on the picker surface: does it appear, can the user
  //   switch to an older entry, and does deleting the pinned entry fall back
  //   gracefully to the newest remaining one?
  //
  // Flow:
  //   add 2026-03-10 (newer) + 2026-01-15 (older)
  //   → Export chip shows newest; "..." trigger is visible
  //   → click "..." → select older date → chip label updates
  //   → delete older appointment in Settings
  //   → Export chip falls back to newest (wipe-on-delete)
  test("two appointments: picker appears, pinning older entry updates chip label, deleting pinned entry falls back to latest", async ({ page }) => {
    await loginAsTestUser(page);

    // ---- ADD TWO APPOINTMENTS IN SETTINGS ----------------------------
    await page.goto("/settings");
    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // The add-form's date input is always the first visible date input
    // in the sheet (existing rows render plain text, not inputs, unless
    // they are being edited — which they are not here).
    const addDateInput = page.locator('input[type="date"]').first();
    await expect(addDateInput).toBeVisible();

    // Add the newer appointment first so the list order is predictable.
    await addDateInput.fill("2026-03-10");
    await page.getByRole("button", { name: /^(Add|Hinzufügen)$/ }).click();

    // Poll until the DB row exists before inserting the second entry so
    // the descending sort order is stable.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBe("2026-03-10");

    // The add-form input resets after a successful add.
    await addDateInput.fill("2026-01-15");
    await page.getByRole("button", { name: /^(Add|Hinzufügen)$/ }).click();

    // After adding the older entry the most-recent appointment is still
    // 2026-03-10 (the sort order is descending by date).
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBe("2026-03-10");

    // ---- EXPORT PANEL: newest chip + "..." trigger visible -----------
    await page.keyboard.press("Escape");
    const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA });
    await exportRow.click();

    // Wait for the "All time" chip so we know the panel's fetch settled.
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();

    // Chip label should show 2026-03-10 (the most-recent entry).
    // Same dual-locale strategy as the rest of the file.
    const NEWER_CHIP_DATE_DE = /(Seit letztem Arzttermin|Since last appointment).*10[./]03[./]2026/;
    const NEWER_CHIP_DATE_US = /(Seit letztem Arzttermin|Since last appointment).*03\/10\/2026/;
    const newerChip = page
      .getByRole("button", { name: NEWER_CHIP_DATE_DE })
      .or(page.getByRole("button", { name: NEWER_CHIP_DATE_US }));
    await expect(newerChip).toBeVisible({ timeout: 10_000 });

    // Chip row: 4 standard + 1 lastAppointment = 5.
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(5);

    // The "..." trigger must be visible because there are 2 appointments.
    // Its aria-label is the i18n key `appointments_picker_label`:
    //   EN: "Pick an older appointment"
    //   DE: "Älteren Termin wählen"
    const PICKER_ARIA = /(Pick an older appointment|Älteren Termin wählen)/;
    const pickerTrigger = page.getByRole("button", { name: PICKER_ARIA });
    await expect(pickerTrigger).toBeVisible();

    // ---- OPEN PICKER, SELECT OLDER APPOINTMENT ----------------------
    await pickerTrigger.click();

    // The dropdown has role="listbox" and the same aria-label.
    const listbox = page.getByRole("listbox", { name: PICKER_ARIA });
    await expect(listbox).toBeVisible();

    // Each list item has role="option" and its text is the formatted date
    // (no prefix — just "15.01.2026" or "01/15/2026" depending on locale).
    const OLDER_OPTION_DE = /15[./]01[./]2026/;
    const OLDER_OPTION_US = /01\/15\/2026/;
    const olderOption = listbox
      .getByRole("option", { name: OLDER_OPTION_DE })
      .or(listbox.getByRole("option", { name: OLDER_OPTION_US }));
    await expect(olderOption).toBeVisible();
    await olderOption.click();

    // The picker closes immediately on selection.
    await expect(listbox).not.toBeVisible();

    // Chip label must now show 2026-01-15 (the pinned older entry).
    // LAST_APPT_CHIP_DATE_DE / _US are already defined at module level
    // and cover both "15.01.2026" and "01/15/2026" for that date.
    const olderChip = page
      .getByRole("button", { name: LAST_APPT_CHIP_DATE_DE })
      .or(page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }));
    await expect(olderChip).toBeVisible({ timeout: 5_000 });

    // Chip count is unchanged — selecting an older entry doesn't add or
    // remove chips, it only changes the date embedded in the label.
    await expect(page.getByRole("button", { name: ANY_CHIP_LABEL })).toHaveCount(5);

    // ---- DELETE THE OLDER (PINNED) APPOINTMENT IN SETTINGS ----------
    await page.keyboard.press("Escape");
    await apptsRow.click();

    // The appointments list is sorted descending, so the second delete
    // button (index 1 in the 0-based Playwright nth()) belongs to the
    // older row (2026-01-15).  We use nth(1) rather than filtering by
    // date text to stay locale-independent.
    page.once("dialog", (d) => { void d.accept(); });
    await page.getByRole("button", { name: /^(Delete|Löschen)$/ }).nth(1).click();

    // The older row is gone; the newer one (2026-03-10) is still there.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBe("2026-03-10");

    // ---- EXPORT PANEL: falls back to newest entry -------------------
    // Re-opening the bottom sheet re-mounts ExportPanel.  pickedAppointmentId
    // resets to null on mount, so activeAppointment defaults to
    // appointments[0] — the still-present 2026-03-10 entry.  This is the
    // observable consequence of the wipe-on-delete contract: the chip never
    // shows a stale deleted date.
    await page.keyboard.press("Escape");
    await exportRow.click();
    await expect(page.getByRole("button", { name: /^(All time|Alles)$/ })).toBeVisible();

    const newerChipFinal = page
      .getByRole("button", { name: NEWER_CHIP_DATE_DE })
      .or(page.getByRole("button", { name: NEWER_CHIP_DATE_US }));
    await expect(newerChipFinal).toBeVisible({ timeout: 10_000 });

    // Only one appointment remains — the "..." trigger must be gone.
    await expect(pickerTrigger).toHaveCount(0);

    // The 2026-01-15 chip label must not appear anywhere.
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_DE }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }),
    ).toHaveCount(0);
  });
});

// -----------------------------------------------------------------------
// Note round-trip tests (Task #112)
// -----------------------------------------------------------------------
// Why a separate describe block:
//   The tests above deliberately keep their scope narrow (chip count,
//   date persistence, picker UX). The note feature adds four orthogonal
//   behaviours that would bloat those tests without adding clarity:
//
//   1. Note persists through reload — typing a note in the add-form and
//      saving it must produce a non-null `note` column in `appointments`
//      AND the value must still be visible in the existing-row list after
//      a page reload (regression guard: note not forwarded in insert or
//      not rendered in the list).
//
//   2. PDF cover carries the note — when the "Seit letztem Arzttermin"
//      chip is the active preset the ExportPanel must thread the active
//      appointment's note into the `appointmentNote` prop handed to
//      <GlevReport>. We assert via the same `__GLEV_CAPTURE_PDF_PROPS__`
//      probe used in `export-panel-wiring.spec.ts` — no PDF bytes to
//      parse, no heavy renderer to boot. A regression that wires `null`
//      instead of the note (or wires the note regardless of the preset)
//      shows up as a clear prop-value mismatch.
//
//   3. Deleting the appointment wipes the note from the DB — the note
//      lives on the appointment row, so a hard delete must remove it.
//      This guards the future scenario where a note might be lifted into
//      a separate column on `user_settings` (like `last_appointment_note`
//      was before Task #93), which could survive row deletion.
//
//   4. Note input disabled when no date is set — the add-form's note
//      field must be disabled when the date input is cleared so users
//      can't type a note that can never be saved (the Add button already
//      guards this, but disabling the field makes the contract visible).
//      We verify the HTML `disabled` attribute directly rather than
//      asserting on a visual style so the check is robust across themes.
//
//   5. 200-character cap enforced — the note input carries
//      `maxLength={200}` so the browser truncates longer input before
//      it can reach the Supabase `check` constraint. Asserting the DOM
//      attribute here is cheaper than typing 201 chars and checking
//      the trimmed value.
//
// Isolation strategy:
//   Every test starts from `resetAppointments` (no rows) and seeds via
//   the admin client where possible, so the note assertions are always
//   targeted at a known, freshly written row — not at whatever prior
//   spec runs may have left behind.

// The PDF probe pattern mirrors export-panel-wiring.spec.ts §PDF:
//   addInitScript sets __GLEV_CAPTURE_PDF_PROPS__ BEFORE any navigation,
//   exposeFunction bridges the in-page call into the Node test process,
//   and the export action fires the probe synchronously once all fetches
//   resolve.
const PDF_BTN_NAME = /^(PDF Report|PDF-Report|Building PDF…|Erstelle PDF…)( \(\d+\))?$/i;
const COUNT_LOADING = /Counting entries|Zähle Einträge/;

test.describe("Settings → Arzttermine note round-trip", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetAppointments(testUser.userId);
  });

  test.afterAll(async () => {
    await resetAppointments(testUser.userId);
  });

  // --- 1. Note persists through reload -----------------------------------
  test("note typed in the add-form is persisted to the DB and visible after reload", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // Fill the date first — the note input is disabled until a date is present.
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-02-10");

    // Now the note input should be enabled.
    const NOTE_LABEL = /^(Note|Notiz)$/;
    const noteInput = page.getByRole("textbox", { name: NOTE_LABEL });
    await expect(noteInput).toBeEnabled();
    await noteInput.fill("Endo Q1 checkup");

    // Commit.
    await page.getByRole("button", { name: /^(Add|Hinzufügen)$/ }).click();

    // DB write must include the note.
    await expect.poll(
      () => readLatestAppointmentNote(testUser.userId),
      { timeout: 10_000 },
    ).toBe("Endo Q1 checkup");

    // Reload and re-open the sheet — the existing-row list should show the note.
    await page.reload();
    await page.goto("/settings");
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // The note value appears in the row's read-only display OR in the edit
    // input that's rendered for existing rows. Either way the text must be
    // present somewhere in the sheet body — we locate it by its visible value.
    await expect(page.getByText("Endo Q1 checkup")).toBeVisible({ timeout: 10_000 });
  });

  // --- 2. PDF probe: note reaches appointmentNote prop ------------------
  test("note is forwarded into appointmentNote when the lastAppointment chip is active", async ({ page }) => {
    // Install the probe BEFORE any navigation so it is in place when
    // ExportPanel mounts. The bridge mirrors export-panel-wiring.spec.ts.
    let capturedProps: Record<string, unknown> | null = null;
    await page.exposeFunction(
      "__captureGlevPdfProps",
      (props: Record<string, unknown>) => { capturedProps = props; },
    );
    await page.addInitScript(() => {
      (globalThis as unknown as {
        __GLEV_CAPTURE_PDF_PROPS__: (p: unknown) => void;
      }).__GLEV_CAPTURE_PDF_PROPS__ = (props: unknown) => {
        (window as unknown as {
          __captureGlevPdfProps: (p: unknown) => void;
        }).__captureGlevPdfProps(JSON.parse(JSON.stringify(props)));
      };
    });

    // Seed an appointment with a note via the admin client so we don't
    // depend on the add-form flow being correct here (that's test #1's job).
    const admin = getAdminClient();
    await seedAppointmentWithNote(admin, testUser.userId, "2026-02-10", "Dr. Muster A1c 7.1");

    await loginAsTestUser(page);
    await page.goto("/settings");

    // Open the export sheet.
    const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA });
    await expect(exportRow).toBeVisible();
    await exportRow.click();

    // Wait for the panel to fully mount (PDF button visible + count settled).
    await expect(page.getByRole("button", { name: PDF_BTN_NAME })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(COUNT_LOADING)).toHaveCount(0, { timeout: 15_000 });

    // The appointment chip must be present — click it to make it the active preset.
    const apptChip = page
      .getByRole("button", { name: LAST_APPT_CHIP_DATE_DE })
      .or(page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }));
    await expect(apptChip).toBeVisible({ timeout: 10_000 });
    await apptChip.click();

    // Trigger the PDF (probe intercepts before the heavy renderer runs).
    const pdfBtn = page.getByRole("button", { name: PDF_BTN_NAME });
    await expect(pdfBtn).toBeEnabled();
    await pdfBtn.click();

    // Wait for the probe to fire.
    await expect.poll(() => capturedProps, { timeout: 15_000 }).not.toBeNull();
    const props = capturedProps!;

    // The note must be forwarded as appointmentNote (not undefined / null).
    expect(props.appointmentNote).toBe("Dr. Muster A1c 7.1");
  });

  // --- 3. Deleting the appointment wipes the note from the DB -----------
  test("deleting an appointment with a note removes the note from the database", async ({ page }) => {
    // Seed via admin — bypasses the add-form so this test is isolated from
    // the UI layer and purely verifies the delete path.
    const admin = getAdminClient();
    await seedAppointmentWithNote(admin, testUser.userId, "2026-02-10", "Delete-me note");

    // Confirm it's in the DB before we touch the UI.
    expect(await readLatestAppointmentNote(testUser.userId)).toBe("Delete-me note");

    await loginAsTestUser(page);
    await page.goto("/settings");

    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // Delete the only appointment in the list. The confirm() dialog is
    // auto-accepted the same way the date round-trip tests handle it.
    page.once("dialog", (d) => { void d.accept(); });
    await page.getByRole("button", { name: /^(Delete|Löschen)$/ }).click();

    // DB must have no appointments (and therefore no note) for this user.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBeNull();

    // A separate readLatestAppointmentNote confirms the note column is gone
    // (not just the date). Primarily guards against a future refactor that
    // lifts the note into a separate column on user_settings where it
    // might survive the appointments row deletion.
    await expect.poll(
      () => readLatestAppointmentNote(testUser.userId),
      { timeout: 10_000 },
    ).toBeNull();
  });

  // --- 4. Note input disabled when date is cleared ----------------------
  test("note input is disabled when the date field is cleared", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();

    const NOTE_LABEL = /^(Note|Notiz)$/;
    const noteInput = page.getByRole("textbox", { name: NOTE_LABEL });

    // By default the date input is pre-filled with today, so the note
    // input should start out enabled.
    await expect(noteInput).toBeEnabled();

    // Clear the date — the note must become disabled immediately.
    await dateInput.fill("");
    await expect(noteInput).toBeDisabled();

    // Re-filling the date must re-enable the note.
    await dateInput.fill("2026-02-10");
    await expect(noteInput).toBeEnabled();
  });

  // --- 5. 200-character cap enforced via maxLength attribute -------------
  //
  // (Tests are numbered 1-7 in this block; test #6 and #7 appear further
  // below after the cap check.)
  test("note input carries maxLength=200 so the browser enforces the cap", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/settings");

    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();
    // Ensure the note input is enabled before we inspect it.
    await dateInput.fill("2026-02-10");

    const NOTE_LABEL = /^(Note|Notiz)$/;
    const noteInput = page.getByRole("textbox", { name: NOTE_LABEL });
    await expect(noteInput).toBeEnabled();

    // Assert the HTML maxlength attribute is exactly 200 — this is the
    // browser-level enforcement for the 200-char cap before the value
    // can reach Supabase. We check the attribute rather than trying to
    // type 201 characters (which Playwright would silently truncate
    // anyway because the browser refuses input beyond maxLength).
    await expect(noteInput).toHaveAttribute("maxlength", "200");
  });

  // --- 6. Edit-flow: changing the note on an existing row persists -------
  // Why this is distinct from the other note tests:
  //   Tests 1–5 only cover the *add* path (note typed in the add-form)
  //   and the *delete* path.  The *edit* path — opening an existing row
  //   in the inline-edit form, changing its note, and saving — is a
  //   separate code branch (updateAppointmentAction / updateAppointment).
  //   A regression there (e.g. `updateAppointment` dropping the note
  //   field entirely, or the edit-form pre-populating it incorrectly)
  //   would go undetected by every other test in this describe block.
  //
  // Flow:
  //   seed row with "Original note"
  //   → open Settings sheet → click Edit → change note → click Save
  //   → assert DB has "Updated note from edit flow"
  //   → reload, re-open sheet → assert updated note visible in list
  //   → assert old note is no longer visible
  test("editing an existing appointment's note persists to the DB and is visible after reload", async ({ page }) => {
    // Seed via admin so we have a known row to edit.
    const admin = getAdminClient();
    await seedAppointmentWithNote(admin, testUser.userId, "2026-03-20", "Original note");

    // Sanity-check: the seeded note is in the DB before we touch the UI.
    expect(await readLatestAppointmentNote(testUser.userId)).toBe("Original note");

    await loginAsTestUser(page);
    await page.goto("/settings");

    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    // Read-only row must display the existing note before we edit.
    await expect(page.getByText("Original note")).toBeVisible({ timeout: 10_000 });

    // Click the Edit button to activate the inline-edit form for this row.
    // The aria-label / button text is "Edit" (EN) or "Bearbeiten" (DE).
    await page.getByRole("button", { name: /^(Edit|Bearbeiten)$/ }).click();

    // The edit form renders a note textbox with the same aria-label as
    // the add-form's note input (appointments_note_label → "Note" / "Notiz").
    // The add-form's textbox is index 0; the edit-form's is index 1.
    const NOTE_LABEL = /^(Note|Notiz)$/;
    const editNoteInput = page.getByRole("textbox", { name: NOTE_LABEL }).nth(1);
    await expect(editNoteInput).toBeVisible();
    // Must be pre-filled with the existing note value.
    await expect(editNoteInput).toHaveValue("Original note");

    // Type the new note.
    await editNoteInput.fill("Updated note from edit flow");

    // Click Save. The save button text is "Save" (EN) or "Speichern" (DE).
    // Only one Save button is visible (inside the active edit row).
    await page.getByRole("button", { name: /^(Save|Speichern)$/ }).first().click();

    // DB assertion: poll until the note column reflects the new value.
    await expect.poll(
      () => readLatestAppointmentNote(testUser.userId),
      { timeout: 10_000 },
    ).toBe("Updated note from edit flow");

    // UI assertion: reload and re-open the sheet — the updated note must
    // appear in the row's read-only display and the old note must be gone.
    await page.reload();
    await page.goto("/settings");
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    await expect(
      page.getByText("Updated note from edit flow"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Original note")).toHaveCount(0);
  });

  // --- 7. Clearing the date (deleting the appointment) wipes the note ----
  // Why this is a distinct test from #3 (deletion):
  //   The schema retains a legacy `user_settings.last_appointment_note`
  //   column from before Task #93 moved appointments into a dedicated
  //   table. If `readLastAppointment()` (or any future refactor) were
  //   to fall back to that column when `appointments` is empty, a note
  //   written before deletion would silently survive the "clear date"
  //   gesture and reappear on the PDF cover.
  //
  //   We guard this by:
  //   (a) seeding a stale note in `user_settings.last_appointment_note`
  //   (b) seeding a real appointment row with the SAME note
  //   (c) deleting the appointment via UI (= canonical "clear date")
  //   (d) asserting via the PDF probe that `appointmentNote` is now
  //       `undefined` — even though `user_settings.last_appointment_note`
  //       still holds the old value.
  //
  //   This test would catch a regression like:
  //     `readLastAppointment()` → checks `appointments` → empty →
  //     falls back to `user_settings.last_appointment_note` → returns
  //     stale note → PDF cover shows it.
  test("clearing the date (deleting the appointment) wipes the note from the export — legacy column does not leak", async ({ page }) => {
    const STALE_NOTE = "Stale legacy note — must not appear in export";

    // (a) Write the stale note into the legacy user_settings column so a
    //     fallback path could accidentally pick it up.
    await seedLegacyUserSettingsNote(testUser.userId, STALE_NOTE);

    // Confirm the legacy column has the value before we proceed.
    expect(await readLegacyUserSettingsNote(testUser.userId)).toBe(STALE_NOTE);

    // (b) Seed a real appointment row with the same note so the export
    //     panel actually has a chip + note to show before deletion.
    const admin = getAdminClient();
    await seedAppointmentWithNote(admin, testUser.userId, "2026-02-10", STALE_NOTE);
    expect(await readLatestAppointmentNote(testUser.userId)).toBe(STALE_NOTE);

    // Install the PDF probe before navigating so it's in place when
    // ExportPanel mounts. Same bridge pattern as test #2.
    let capturedProps: Record<string, unknown> | null = null;
    await page.exposeFunction(
      "__captureGlevPdfProps",
      (props: Record<string, unknown>) => { capturedProps = props; },
    );
    await page.addInitScript(() => {
      (globalThis as unknown as {
        __GLEV_CAPTURE_PDF_PROPS__: (p: unknown) => void;
      }).__GLEV_CAPTURE_PDF_PROPS__ = (props: unknown) => {
        (window as unknown as {
          __captureGlevPdfProps: (p: unknown) => void;
        }).__captureGlevPdfProps(JSON.parse(JSON.stringify(props)));
      };
    });

    await loginAsTestUser(page);
    await page.goto("/settings");

    // (c) Delete the appointment via the Settings sheet — this is the
    //     canonical "clear date" gesture in the current multi-appointment
    //     UI (there is no separate "clear" button; deletion is the only
    //     way to remove an appointment date anchor).
    const apptsRow = page.getByRole("button", { name: APPTS_ROW_ARIA });
    await expect(apptsRow).toBeVisible();
    await apptsRow.click();

    page.once("dialog", (d) => { void d.accept(); });
    await page.getByRole("button", { name: /^(Delete|Löschen)$/ }).click();

    // appointments table must now be empty.
    await expect.poll(
      () => readLatestAppointment(testUser.userId),
      { timeout: 10_000 },
    ).toBeNull();

    // (d) Open the Export panel and fire the PDF probe. The chip must be
    //     absent (no appointment chip rendered when the list is empty) and
    //     the captured appointmentNote must be undefined — the stale
    //     user_settings.last_appointment_note value must NOT leak through.
    const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA });
    await expect(exportRow).toBeVisible();
    await exportRow.click();
    await expect(page.getByRole("button", { name: PDF_BTN_NAME })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(COUNT_LOADING)).toHaveCount(0, { timeout: 15_000 });

    // Confirm the appointment chip is gone (export panel sees no appointments).
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_DE }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: LAST_APPT_CHIP_DATE_US }),
    ).toHaveCount(0);

    // Trigger the PDF probe — no chip is selected, so rangePreset should
    // NOT be "lastAppointment" and appointmentNote must be undefined.
    capturedProps = null;
    const pdfBtn = page.getByRole("button", { name: PDF_BTN_NAME });
    await expect(pdfBtn).toBeEnabled();
    await pdfBtn.click();

    await expect.poll(() => capturedProps, { timeout: 15_000 }).not.toBeNull();

    // The critical assertion: the stale legacy note must not appear.
    // `undefined` is what the export produces when no appointment chip
    // is active — JSON.stringify drops undefined fields, so the key
    // will simply be absent from the captured props object.
    expect(capturedProps!.appointmentNote).toBeUndefined();
  });
});
