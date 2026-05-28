// Smoke test for the /settings page layout.
//
// Why this exists:
//   Task #77 fixed a picker test that silently hung for 15 seconds because
//   the page had been refactored (tabs → flat list) and the test was still
//   looking for the old structure. Every picker spec owns only its own
//   slice, so a structural regression (missing SettingsSection, renamed
//   row aria-label, gating condition that hides everything) surfaces as a
//   15-second timeout in whichever picker spec happens to run first —
//   unclear and slow to diagnose.
//
//   This single fast spec asserts the high-level shape of /settings so
//   layout regressions fail loudly here first, before any picker test runs.
//
// What this asserts:
//   1. Every always-visible SettingsSection heading is rendered as an <h2>.
//      Headings are matched against both the German default and the English
//      variant (locale-agnostic, same technique as theme/carb/language picker
//      specs) so the test is stable regardless of the active locale at
//      runtime.
//   2. One primary SettingsRow (or the Insulin expand button) per section is
//      present and visible, matched by aria-label. If a row is accidentally
//      removed, renamed, or hidden behind a broken gating condition, this is
//      the single place that fails with a clear label instead of a timeout
//      inside a deeper picker spec.
//
// Feature-gated sections (aiVoiceEnabled=Glev AI, plan==="plus"→Glev+) are
// intentionally excluded — they are not rendered for the test user by
// default, and asserting their absence would couple this test to plan/flag
// state rather than page structure.
//
// We drive the test through the real login flow so the test covers the full
// stack: login → middleware → settings page render. Same pattern as
// theme-picker.spec.ts, carb-unit-picker.spec.ts, and language-picker.spec.ts.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

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

// -------------------------------------------------------------------------
// Section heading regexes (h2 text, locale-agnostic).
// Each pattern accepts both the German default and the English variant.
// -------------------------------------------------------------------------
const HEADING_ACCOUNT      = /^(Account|Konto)$/i;
const HEADING_GLUCOSE      = /^(Glucose|Glukose)$/i;
const HEADING_INSULIN      = /^Insulin$/i;
const HEADING_APPOINTMENTS = /^(Appointments|Termine)$/i;
const HEADING_CGM          = /^CGM$/i;
const HEADING_APP          = /^App$/i;
const HEADING_APPEARANCE   = /^(Appearance|Erscheinungsbild)$/i;
const HEADING_GOALS        = /^(Goals|Ziele)$/i;
const HEADING_DATA         = /^(Data|Daten)$/i;
const HEADING_INTEGRATIONS = /^(Integrations|Integrationen)$/i;
const HEADING_SUPPORT      = /^(Help & Feedback|Hilfe & Feedback)$/i;

// -------------------------------------------------------------------------
// Primary row aria-label regexes (locale-agnostic).
//
// Row aria-labels follow one of two patterns:
//   en:  "Open {label}"       (tSettings("row_open_aria", { label }))
//   de:  "{label} öffnen"     (tSettings("row_open_aria", { label }))
//
// The Insulin section uses a plain button (not SettingsRow) with:
//   en:  "Expand insulin settings"
//   de:  "Insulin-Einstellungen aufklappen"
// -------------------------------------------------------------------------
const ROW_ACCOUNT       = /(Open Account|Konto öffnen)/i;
const ROW_TARGET_RANGE  = /(Open Target range|Zielbereich öffnen)/i;
const ROW_INSULIN       = /(Expand insulin settings|Insulin-Einstellungen aufklappen)/i;
const ROW_APPOINTMENTS  = /(Open Doctor appointments|Arzttermine öffnen)/i;
// row_libre2 is "FreeStyle Libre 2 / 3" in both locales — one regex covers both.
const ROW_CGM           = /Open FreeStyle Libre 2 \/ 3|FreeStyle Libre 2 \/ 3 öffnen/i;
const ROW_NOTIFICATIONS = /(Open Notifications|Benachrichtigungen öffnen)/i;
const ROW_APPEARANCE    = /(Open Appearance|Erscheinungsbild öffnen)/i;
const ROW_MACROS        = /(Open Daily Macro Targets|Tägliche Makro-Ziele öffnen)/i;
const ROW_IMPORT        = /(Open Import data|Daten importieren öffnen)/i;
// google_sheets_title is "Google Sheets" in both locales.
const ROW_GOOGLE_SHEETS = /Open Google Sheets|Google Sheets öffnen/i;
const ROW_SUPPORT       = /(Open Feature Requests|Feature-Wünsche öffnen)/i;

// Short visible timeout for each structural assertion. The sections are
// rendered synchronously with the initial server HTML (no async loading
// needed for structure) so 5 s is generous. Keeping it short means the
// spec fails fast when a section is missing instead of hanging.
const VISIBLE_TIMEOUT = 5_000;

test.describe("Settings page — structural smoke test", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await loginAsTestUser(page);
  });

  test("every major SettingsSection heading is visible", async ({ page }) => {
    await page.goto("/settings");

    // Assert all always-visible section headings in document order.
    // Using `heading` role maps to the <h2> elements inside SettingsSection
    // (components/SettingsRow.tsx → SettingsSection renders an <h2>).
    for (const [label, pattern] of [
      ["Account",      HEADING_ACCOUNT],
      ["Glucose",      HEADING_GLUCOSE],
      ["Insulin",      HEADING_INSULIN],
      ["Appointments", HEADING_APPOINTMENTS],
      ["CGM",          HEADING_CGM],
      ["App",          HEADING_APP],
      ["Appearance",   HEADING_APPEARANCE],
      ["Goals",        HEADING_GOALS],
      ["Data",         HEADING_DATA],
      ["Integrations", HEADING_INTEGRATIONS],
      ["Support",      HEADING_SUPPORT],
    ] as const) {
      await expect(
        page.getByRole("heading", { name: pattern }),
        `section heading "${label}" should be visible`,
      ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    }
  });

  test("every major section has its primary row visible", async ({ page }) => {
    await page.goto("/settings");

    // One primary row per section, matched by aria-label.
    // If a row is removed, renamed, or hidden by a broken gating condition,
    // this assertion fails with the row's name — no 15-second picker timeout.
    for (const [label, pattern] of [
      ["Account row",           ROW_ACCOUNT],
      ["Target range row",      ROW_TARGET_RANGE],
      ["Insulin expand button", ROW_INSULIN],
      ["Appointments row",      ROW_APPOINTMENTS],
      ["Libre 2/3 CGM row",     ROW_CGM],
      ["Notifications row",     ROW_NOTIFICATIONS],
      ["Appearance row",        ROW_APPEARANCE],
      ["Macro targets row",     ROW_MACROS],
      ["Import data row",       ROW_IMPORT],
      ["Google Sheets row",     ROW_GOOGLE_SHEETS],
      ["Feature Requests row",  ROW_SUPPORT],
    ] as const) {
      await expect(
        page.getByRole("button", { name: pattern }),
        `"${label}" should be visible`,
      ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    }
  });
});
