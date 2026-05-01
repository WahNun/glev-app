// End-to-end coverage for the empty-range guard on the bulk export
// buttons in `components/ExportPanel.tsx`.
//
// What this asserts (and why each piece matters):
//   1. When the user picks a custom date range that resolves to *zero*
//      total entries across all four kinds, both bulk-action buttons
//      (the PDF report and "All as CSV") become disabled and surface
//      the same empty-range tooltip the count line already shows.
//      Without this guard a user who ignores the small "Keine Einträge
//      im gewählten Zeitraum." line could still hand a doctor a
//      one-page PDF (or four blank CSVs) with no data — that was the
//      original "blank PDF" pain point this task addressed.
//   2. Switching back to "All time" re-enables both buttons. The empty
//      flag must be derived live from the count preview, not a sticky
//      one-shot state.
//   3. Per-kind row buttons stay enabled in the empty case — exporting
//      a single empty CSV is a niche but valid action (header-only
//      template) and the count line right above already shows zero.
//
// We pick a far-future custom range (year 2099) so the window is
// guaranteed to be empty regardless of what historical data the test
// user accumulates between runs. Using "All time" for the re-enabled
// state assertion mirrors the most common path users take ("show me
// everything") and reuses the count helpers' fast no-bounds query.

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
 * Service-role admin client used only by this spec to seed and clean up
 * a single fingerstick row for the test user. We can't go through the
 * normal `insertFingerstick` helper because it requires an authenticated
 * browser session; the admin client bypasses RLS and lets us prepare
 * the DB state before the browser even loads. Mirrors the pattern used
 * in `tests/support/testUser.ts`.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Cannot seed fingerstick row: SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set in the environment.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The /settings page exposes the export panel behind a "Daten
// exportieren" / "Export data" row, which opens a bottom-sheet hosting
// the panel. The row is a <button> with an aria-label set via
// `row_open_aria`: "Open {label}" (EN) / "{label} öffnen" (DE), so the
// accessible name reads "Open Export data" / "Daten exportieren öffnen".
// Matching both ordering cases keeps the spec locale-agnostic.
const EXPORT_ROW_NAME  = /^(Open Export data|Daten exportieren öffnen)$/i;
const ALL_BTN_NAME     = /^(All as CSV|Alles als CSV|Exporting all…|Exportiere alles…)( \(\d+\))?$/i;
const PDF_BTN_NAME     = /^(PDF Report|PDF-Report|Building PDF…|Erstelle PDF…)( \(\d+\))?$/i;
const CUSTOM_CHIP_NAME = /^(Custom range|Eigener Zeitraum)$/i;
const ALL_CHIP_NAME    = /^(All time|Alles)$/i;
// The empty-range copy is identical between the count line and the
// disabled-button tooltip — same translation key (`export.count_empty`)
// drives both surfaces.
const EMPTY_TEXT       = /No entries in the selected range\.|Keine Einträge im gewählten Zeitraum\./;

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

async function openExportSheet(page: Page) {
  await page.goto("/settings");
  // The export row opens a bottom-sheet hosting <ExportPanel/>. Click
  // by accessible name; the row is a <button> rendered via SettingsRow.
  const exportRow = page.getByRole("button", { name: EXPORT_ROW_NAME }).first();
  await expect(exportRow).toBeVisible();
  await exportRow.click();
  // The panel renders the bulk-action buttons last — wait on one of
  // them as the readiness signal before continuing.
  await expect(page.getByRole("button", { name: PDF_BTN_NAME })).toBeVisible({ timeout: 15_000 });
  // Wait for the count preview to settle so we don't catch a transient
  // "Counting..." state that would defer the disabled-flag evaluation.
  await expect(page.getByText(/Counting entries|Zähle Einträge/)).toHaveCount(0, { timeout: 15_000 });
}

test.describe("ExportPanel — bulk export buttons honour the empty-range guard", () => {
  // ID of the fingerstick row we seed in `beforeAll` so the test user
  // is guaranteed to have at least one entry — without it the "All
  // time" baseline would also resolve to zero and we couldn't tell the
  // empty-range guard apart from the "user really has no data" case.
  let seededFingerstickId: string | null = null;

  test.beforeAll(async () => {
    const { userId } = loadTestUser();
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("fingerstick_readings")
      .insert({
        user_id: userId,
        // Pick a value comfortably inside the picker's 20–600 mg/dL
        // bounds. The exact number doesn't matter — we only care that
        // the row exists and the count helpers can find it.
        value_mg_dl: 110,
        // "Now" so it lands in every plausible time window the test
        // exercises (in particular the default "All time" preset).
        measured_at: new Date().toISOString(),
        notes: "playwright-export-empty-range-seed",
      })
      .select("id")
      .single();
    if (error) throw error;
    seededFingerstickId = (data as { id: string }).id;
  });

  test.afterAll(async () => {
    // Clean up the seeded row so we don't leak state into other specs
    // (e.g. theme-picker.spec.ts) or developer's manual tests with the
    // same Supabase test user. Delete-by-id is idempotent so a partial
    // failure in beforeAll won't block teardown.
    if (!seededFingerstickId) return;
    const admin = getAdminClient();
    await admin
      .from("fingerstick_readings")
      .delete()
      .eq("id", seededFingerstickId);
  });

  test("disables PDF + All-as-CSV when the chosen range has 0 entries, re-enables on All time", async ({ page }) => {
    await loginAsTestUser(page);
    await openExportSheet(page);

    const allBtn = page.getByRole("button", { name: ALL_BTN_NAME });
    const pdfBtn = page.getByRole("button", { name: PDF_BTN_NAME });
    await expect(allBtn).toBeVisible();
    await expect(pdfBtn).toBeVisible();

    // Baseline: with the seeded fingerstick row the "All time" preset
    // resolves to a non-empty window and the bulk buttons should be
    // enabled. This proves the guard is *not* over-firing when there
    // is data to export.
    await expect(allBtn).toBeEnabled();
    await expect(pdfBtn).toBeEnabled();

    // Switch to a far-future custom window guaranteed to be empty.
    await page.getByRole("button", { name: CUSTOM_CHIP_NAME }).click();

    // Native <input type="date"> takes ISO `YYYY-MM-DD` strings via
    // .fill(). Year 2099 is comfortably beyond any plausible user
    // history without colliding with the input's max attribute.
    const fromInput = page.locator('input[type="date"]').first();
    const toInput   = page.locator('input[type="date"]').nth(1);
    await fromInput.fill("2099-01-01");
    await toInput.fill("2099-12-31");

    // The count preview should re-render to the empty hint within a
    // couple of network round-trips. Bound generously to absorb cold
    // Next.js compiles in dev mode.
    await expect(page.getByText(EMPTY_TEXT).first()).toBeVisible({ timeout: 15_000 });

    // Both bulk-action buttons must now be disabled AND carry the
    // same empty-range tooltip the count line shows. Per-kind rows
    // stay enabled (they're not asserted here so a future change to
    // their styling can't break this spec).
    await expect(allBtn).toBeDisabled();
    await expect(pdfBtn).toBeDisabled();
    const allTooltip = await allBtn.getAttribute("title");
    const pdfTooltip = await pdfBtn.getAttribute("title");
    expect(allTooltip).toMatch(EMPTY_TEXT);
    expect(pdfTooltip).toMatch(EMPTY_TEXT);

    // Flip back to "All time" and verify the guard releases. We don't
    // re-assert the tooltip is missing — the title attribute is
    // simply unset when isEmptyRange is false, which `toBeEnabled`
    // already implies for the user-visible behaviour.
    await page.getByRole("button", { name: ALL_CHIP_NAME }).click();
    // Wait for the count preview to refresh away from the empty hint.
    await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0, { timeout: 15_000 });
    await expect(allBtn).toBeEnabled();
    await expect(pdfBtn).toBeEnabled();
  });
});
