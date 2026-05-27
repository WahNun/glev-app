// End-to-end test for the "Log Basal" quick-action button on the IOB card
// (Task #730).
//
// What & why:
//   The IOB card gained a "Basal" tab (Task #712) and a "Log Basal" quick-log
//   button that navigates to /engine?tab=log&startType=basal, which pre-selects
//   the Basal segment in InsulinForm. Without an automated guard, a regression
//   in the click handler, the navigation target, or the InsulinForm's
//   initialType pre-selection would go undetected until a user reports it.
//
// Assertions:
//   1. Dashboard loads and the IOB card renders.
//   2. Clicking the "Basal" tab chip switches the card to the basal view.
//   3. A "Log Basal" button becomes visible on the basal view.
//   4. Clicking the button navigates to /engine?tab=log&startType=basal.
//   5. The InsulinForm renders with the Basal segment pre-selected
//      (aria-checked="true" on the Basal radio option).
//
// Implementation notes:
//   The IOB card tab chips (Bolus / Basal) are plain <button> elements.
//   We locate the "Basal" chip via its text so the selector survives
//   translation changes — both locales use "Basal" for the basal tab label.
//
//   The "Log Basal" quick-log button renders as
//     `+ {t("iob_log_basal_btn")}` → "+ Basal loggen" (de) / "+ Log Basal" (en).
//   We match it with a regex covering both locales.
//
//   The InsulinForm Segmented control uses role="radio" + aria-checked for
//   each segment option. After pre-selection, the "Basal" radio has
//   aria-checked="true".
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

  test("tapping 'Log Basal' navigates to engine log with basal pre-selected", async ({ page }) => {
    await loginAsTestUser(page);

    // ── 1. Locate the IOB card Bolus/Basal tab chip row ───────────────────
    //
    // The IOB card renders two small chip-style <button> elements:
    // "Bolus" and "Basal". We locate the "Basal" chip by its exact text;
    // both de and en use the same label so no regex is required.
    // We use .first() as a safeguard because the InsulinForm on the Engine
    // page also contains a "Basal" radio option — but that page isn't loaded
    // yet at this point.
    const basalTabChip = page.getByRole("button", { name: "Basal", exact: true }).first();

    await expect(basalTabChip).toBeAttached({ timeout: 30_000 });
    await basalTabChip.scrollIntoViewIfNeeded();
    await expect(basalTabChip).toBeVisible({ timeout: 10_000 });

    // ── 2. Switch the card to the Basal view ──────────────────────────────
    await basalTabChip.click();

    // ── 3. The "Log Basal" quick-action button must now be visible ─────────
    //
    // Button text: "+ Basal loggen" (de) or "+ Log Basal" (en).
    // The "+" is a literal text prefix prepended in the JSX, so we match
    // a substring that is locale-invariant enough.
    const logBasalBtn = page.getByRole("button", {
      name: /Basal loggen|Log Basal/i,
    }).first();

    await expect(logBasalBtn).toBeAttached({ timeout: 10_000 });
    await expect(logBasalBtn).toBeVisible({ timeout: 5_000 });

    // ── 4. Tap the button — expect navigation to /engine?tab=log&startType=basal
    await Promise.all([
      page.waitForURL(/\/engine\?.*tab=log.*startType=basal|\/engine\?.*startType=basal.*tab=log/, {
        timeout: 30_000,
      }),
      logBasalBtn.click(),
    ]);

    // Verify both required query parameters are present.
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/\/engine$/);
    expect(url.searchParams.get("tab")).toBe("log");
    expect(url.searchParams.get("startType")).toBe("basal");

    // ── 5. InsulinForm renders with the Basal segment pre-selected ─────────
    //
    // The SegmentedChoice control uses role="radiogroup" + role="radio".
    // When initialType="basal", the "Basal" radio is mounted with
    // aria-checked="true". We wait for the log tab to render first.
    //
    // Both locales label this radio "BASAL" (uppercase via CSS
    // text-transform, but the DOM text is "Basal").
    const basalRadio = page.getByRole("radio", { name: /^basal$/i });

    await expect(basalRadio).toBeAttached({ timeout: 15_000 });
    await expect(basalRadio).toBeVisible({ timeout: 10_000 });
    await expect(basalRadio).toHaveAttribute("aria-checked", "true");

    // Also assert the Bolus segment is NOT selected, confirming mutual exclusion.
    const bolusRadio = page.getByRole("radio", { name: /^bolus$/i });
    await expect(bolusRadio).toHaveAttribute("aria-checked", "false");
  });
});
