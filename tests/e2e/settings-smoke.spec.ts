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
//   1. Every SettingsSection heading is visible after navigating to its tab.
//      The Settings page uses cluster meta tabs (Konto/Glukose/Insulin/CGM/
//      App/Mehr) so headings are checked per-tab. Headings are matched
//      against both the German and English variant (locale-agnostic).
//   2. One primary SettingsRow (or the Insulin expand button) per section
//      is present and visible after navigating to its tab.
//
// Note: Appearance and Goals are no longer separate SettingsSection headings
//   — they are SettingsRows inside the App section since the settings tabs
//   refactor. Their rows (ROW_APPEARANCE, ROW_MACROS) are still checked.
//
// Feature-gated sections (aiVoiceEnabled=Glev AI, plan==="plus"→Glev+) are
// intentionally excluded — they are not rendered for the test user by
// default, and asserting their absence would couple this test to plan/flag
// state rather than page structure.

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
// Tab button text regexes (locale-agnostic).
// Tab labels: Konto/Account, Glukose/Glucose, Insulin, CGM, App, Mehr (hardcoded).
// -------------------------------------------------------------------------
const TAB_KONTO   = /^(Konto|Account)$/i;
const TAB_GLUKOSE = /^(Glukose|Glucose)$/i;
const TAB_INSULIN = /^Insulin$/i;
const TAB_CGM     = /^CGM$/i;
const TAB_APP     = /^App$/i;
const TAB_MEHR    = /^Mehr$/i; // hardcoded in both locales

// -------------------------------------------------------------------------
// Section heading regexes (h2 text, locale-agnostic).
// Each pattern accepts both the German default and the English variant.
// Note: Appearance (Erscheinungsbild) and Goals (Ziele) are no longer
//   separate section headings — they are rows inside the App section.
// -------------------------------------------------------------------------
const HEADING_ACCOUNT      = /^(Account|Konto)$/i;
const HEADING_GLUCOSE      = /^(Glucose|Glukose)$/i;
const HEADING_INSULIN      = /^Insulin$/i;
const HEADING_APPOINTMENTS = /^(Appointments|Termine)$/i;
const HEADING_CGM          = /^CGM$/i;
const HEADING_APP          = /^App$/i;
const HEADING_DATA         = /^(Data|Daten)$/i;
const HEADING_INTEGRATIONS = /^(Integrations|Integrationen)$/i;
const HEADING_SUPPORT      = /^(Help & Feedback|Hilfe & Feedback)$/i;

// -------------------------------------------------------------------------
// Primary row aria-label regexes (locale-agnostic).
// -------------------------------------------------------------------------
const ROW_ACCOUNT       = /(Open Account|Konto öffnen)/i;
const ROW_TARGET_RANGE  = /(Open Target range|Zielbereich öffnen)/i;
const ROW_INSULIN       = /(Expand insulin settings|Insulin-Einstellungen aufklappen)/i;
const ROW_APPOINTMENTS  = /(Open Doctor appointments|Arzttermine öffnen)/i;
const ROW_CGM           = /Open FreeStyle Libre 2 \/ 3|FreeStyle Libre 2 \/ 3 öffnen/i;
const ROW_NOTIFICATIONS = /(Open Notifications|Benachrichtigungen öffnen)/i;
const ROW_APPEARANCE    = /(Open Appearance|Erscheinungsbild öffnen)/i;
const ROW_MACROS        = /(Open Daily Macro Targets|Tägliche Makro-Ziele öffnen)/i;
const ROW_IMPORT        = /(Open Import data|Daten importieren öffnen)/i;
const ROW_GOOGLE_SHEETS = /Open Google Sheets|Google Sheets öffnen/i;
const ROW_SUPPORT       = /(Open Feature Requests|Feature-Wünsche öffnen)/i;

// Short visible timeout per assertion. Sections are SSR'd synchronously.
const VISIBLE_TIMEOUT = 5_000;

// Helper: click a tab button. Use .first() because the tab bar and the
// section heading inside it can both match the same text pattern.
async function clickTab(page: Page, pattern: RegExp) {
  await page.getByRole("button", { name: pattern }).first().click();
}

test.describe("Settings page — structural smoke test", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await loginAsTestUser(page);
  });

  test("every major SettingsSection heading is visible in its tab", async ({ page }) => {
    await page.goto("/settings");

    // ── Konto tab (default, no click needed) ──────────────────────────
    await expect(
      page.getByRole("heading", { name: HEADING_ACCOUNT }),
      'section heading "Account" should be visible in Konto tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Glukose tab ───────────────────────────────────────────────────
    await clickTab(page, TAB_GLUKOSE);
    await expect(
      page.getByRole("heading", { name: HEADING_GLUCOSE }),
      'section heading "Glucose" should be visible in Glukose tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: HEADING_APPOINTMENTS }),
      'section heading "Appointments" should be visible in Glukose tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Insulin tab ───────────────────────────────────────────────────
    await clickTab(page, TAB_INSULIN);
    await expect(
      page.getByRole("heading", { name: HEADING_INSULIN }),
      'section heading "Insulin" should be visible in Insulin tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── CGM tab ───────────────────────────────────────────────────────
    await clickTab(page, TAB_CGM);
    await expect(
      page.getByRole("heading", { name: HEADING_CGM }),
      'section heading "CGM" should be visible in CGM tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── App tab (Appearance + Goals merged as rows, not sections) ──────
    await clickTab(page, TAB_APP);
    await expect(
      page.getByRole("heading", { name: HEADING_APP }),
      'section heading "App" should be visible in App tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Mehr tab ──────────────────────────────────────────────────────
    await clickTab(page, TAB_MEHR);
    await expect(
      page.getByRole("heading", { name: HEADING_DATA }),
      'section heading "Data" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: HEADING_INTEGRATIONS }),
      'section heading "Integrations" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("heading", { name: HEADING_SUPPORT }),
      'section heading "Support" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test("every major section has its primary row visible in its tab", async ({ page }) => {
    await page.goto("/settings");

    // ── Konto tab (default) ───────────────────────────────────────────
    await expect(
      page.getByRole("button", { name: ROW_ACCOUNT }),
      '"Account row" should be visible in Konto tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Glukose tab ───────────────────────────────────────────────────
    await clickTab(page, TAB_GLUKOSE);
    await expect(
      page.getByRole("button", { name: ROW_TARGET_RANGE }),
      '"Target range row" should be visible in Glukose tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("button", { name: ROW_APPOINTMENTS }),
      '"Appointments row" should be visible in Glukose tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Insulin tab ───────────────────────────────────────────────────
    await clickTab(page, TAB_INSULIN);
    await expect(
      page.getByRole("button", { name: ROW_INSULIN }),
      '"Insulin expand button" should be visible in Insulin tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── CGM tab ───────────────────────────────────────────────────────
    await clickTab(page, TAB_CGM);
    await expect(
      page.getByRole("button", { name: ROW_CGM }),
      '"Libre 2/3 CGM row" should be visible in CGM tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── App tab ───────────────────────────────────────────────────────
    await clickTab(page, TAB_APP);
    await expect(
      page.getByRole("button", { name: ROW_NOTIFICATIONS }),
      '"Notifications row" should be visible in App tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("button", { name: ROW_APPEARANCE }),
      '"Appearance row" should be visible in App tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("button", { name: ROW_MACROS }),
      '"Macro targets row" should be visible in App tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // ── Mehr tab ──────────────────────────────────────────────────────
    await clickTab(page, TAB_MEHR);
    await expect(
      page.getByRole("button", { name: ROW_IMPORT }),
      '"Import data row" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("button", { name: ROW_GOOGLE_SHEETS }),
      '"Google Sheets row" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(
      page.getByRole("button", { name: ROW_SUPPORT }),
      '"Feature Requests row" should be visible in Mehr tab',
    ).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});
