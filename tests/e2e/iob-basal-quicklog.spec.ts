// End-to-end test for the "Log Basal" quick-action button on the IOB card
// (Task #731 — updated from Task #730).
//
// What & why:
//   The IOB card gained a "Basal" tab (Task #712) and a "Log Basal" quick-log
//   button. Task #731 changed the button to open an inline bottom sheet with
//   InsulinForm pre-set to basal mode instead of navigating to
//   /engine?tab=log&startType=basal. This keeps the user on the dashboard
//   and preserves scroll position.
//
// Assertions:
//   1. Dashboard loads and the IOB card renders.
//   2. Clicking the "Basal" tab chip switches the card to the basal view.
//   3. A "Log Basal" button becomes visible on the basal view.
//   4. Clicking the button opens a bottom sheet (no navigation away).
//   5. The sheet (role="dialog") contains InsulinForm with Basal pre-selected
//      (aria-checked="true" on the Basal radio option inside the dialog).
//   6. Closing the sheet (ESC) returns to the dashboard view without navigating.
//
// Implementation notes:
//   BottomSheet renders role="dialog" aria-label={title}. We scope all
//   within-sheet assertions to that dialog element to avoid false matches
//   against the visible "+ Basal loggen" chip on the IOB card itself.
//
//   The IOB card tab chips (Bolus / Basal) are plain <button> elements.
//   Both locales use "Basal" for the tab label — no regex needed there.
//
//   The "Log Basal" quick-log button renders as
//     `+ {t("iob_log_basal_btn")}` → "+ Basal loggen" (de) / "+ Log Basal" (en).
//
//   No data seeding required — the IOB card always renders on the dashboard
//   (it shows a cleared/no-log state when no basal insulin has been recorded).

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

  // A "BZ-Wert eintragen — BZ-Check" modal can appear from stale
  // localStorage state before the login form is interactive.
  // Dismiss it if present so the login fields stay reachable.
  const cancelBtn = page.getByRole("button", { name: /Abbrechen|Cancel/i }).first();
  const maybeDismiss = cancelBtn.click({ timeout: 3_000 }).catch(() => {/* no modal — fine */});
  await maybeDismiss;

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

test.describe("IOB card — basal quick-log button", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("tapping 'Log Basal' opens an inline bottom sheet with basal InsulinForm", async ({ page }) => {
    await loginAsTestUser(page);

    // Record the current URL so we can verify no navigation happened.
    const dashboardUrl = page.url();

    // ── 1. Locate the IOB card Bolus/Basal tab chip row ───────────────────
    //
    // The IOB card renders two small chip-style <button> elements:
    // "Bolus" and "Basal". We locate the "Basal" chip by its exact text.
    const basalTabChip = page.getByRole("button", { name: "Basal", exact: true }).first();

    await expect(basalTabChip).toBeAttached({ timeout: 30_000 });
    await basalTabChip.scrollIntoViewIfNeeded();
    await expect(basalTabChip).toBeVisible({ timeout: 10_000 });

    // ── 2. Switch the card to the Basal view ──────────────────────────────
    await basalTabChip.click();

    // ── 3. The "Log Basal" quick-action button must now be visible ─────────
    //
    // Button text: "+ Basal loggen" (de) or "+ Log Basal" (en).
    const logBasalBtn = page.getByRole("button", {
      name: /Basal loggen|Log Basal/i,
    }).first();

    await expect(logBasalBtn).toBeAttached({ timeout: 10_000 });
    await expect(logBasalBtn).toBeVisible({ timeout: 5_000 });

    // ── 4. Tap the button — expect a bottom sheet to appear, NOT navigation ─
    await logBasalBtn.click();

    // Confirm we stayed on the dashboard (no URL change).
    expect(page.url()).toBe(dashboardUrl);

    // ── 5. Sheet is open — scope all assertions to the dialog element ──────
    //
    // BottomSheet renders role="dialog" with aria-label matching the title prop
    // ("Basal loggen" de / "Log basal" en). Scoping to the dialog prevents
    // false matches against the "+ Basal loggen" button still visible behind
    // the sheet backdrop.
    const dialog = page.getByRole("dialog", { name: /Basal loggen|Log basal/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // InsulinForm uses role="radio" + aria-checked on each segment button.
    // With initialType="basal" the "Basal" radio must be aria-checked="true".
    const basalRadio = dialog.getByRole("radio", { name: /^basal$/i });
    await expect(basalRadio).toBeAttached({ timeout: 10_000 });
    await expect(basalRadio).toBeVisible({ timeout: 5_000 });
    await expect(basalRadio).toHaveAttribute("aria-checked", "true");

    const bolusRadio = dialog.getByRole("radio", { name: /^bolus$/i });
    await expect(bolusRadio).toHaveAttribute("aria-checked", "false");

    // ── 6. Closing the sheet (ESC) returns to the dashboard without navigating
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    expect(page.url()).toBe(dashboardUrl);
  });
});
