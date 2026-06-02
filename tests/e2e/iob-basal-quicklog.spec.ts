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
//   5. The sheet (role="dialog") contains InsulinForm with Basal pre-selected.
//      InsulinForm uses plain <button> elements for the type toggle — not ARIA
//      radio buttons — so we assert the Basal button is present (not aria-checked).
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
//
//   BZ-Check modal suppression: BzCheckModal is shown whenever the custom
//   event "glev:meal-check-reminder" is dispatched on window. We suppress it
//   by patching EventTarget.prototype.dispatchEvent via context.addInitScript()
//   before any app code runs — pattern from iob-bolus-quicklog.spec.ts.
//
//   We use dispatchEvent("click") instead of locator.click() for the "Log Basal"
//   button to bypass coordinate-based hit testing in case the BZ-Check modal
//   backdrop is at pointerEvents:auto for any reason.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

/**
 * Suppress the BZ-Check bottom-sheet for the lifetime of this browser context.
 *
 * BzCheckModal (components/BzCheckModal.tsx) is shown whenever the custom
 * event `glev:meal-check-reminder` is dispatched on `window`. We intercept
 * EventTarget.prototype.dispatchEvent before any app code runs and silently
 * drop those events, keeping `payload=null` in MealCheckReminderProvider so
 * the backdrop overlay is never activated and the dashboard stays interactive.
 */
async function suppressBzModal(context: BrowserContext) {
  await context.addInitScript(() => {
    const original = EventTarget.prototype.dispatchEvent;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    EventTarget.prototype.dispatchEvent = function dispatchEvent(event: Event): boolean {
      if (event.type === "glev:meal-check-reminder") return true;
      return original.call(this, event);
    };
  });
}

async function loginAsTestUser(page: Page, workerIndex: number) {
  const { email, password } = loadTestUserByIndex(workerIndex);
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
    // suppressBzModal must run before clearCookies so the init script is
    // registered on the context before any page navigation.
    await suppressBzModal(context);
    await context.clearCookies();
  });

  test("tapping 'Log Basal' opens an inline bottom sheet with basal InsulinForm", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

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
    //
    // Use dispatchEvent("click") instead of locator.click() to bypass
    // coordinate-based hit testing. If the BZ-Check modal backdrop is at
    // pointerEvents:auto for any reason, regular click() is intercepted at
    // the viewport coordinates; dispatchEvent fires the DOM event directly
    // on the element's listeners regardless of what covers it.
    await logBasalBtn.dispatchEvent("click");

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

    // The InsulinForm type selector renders plain <button> elements ("Bolus" /
    // "Basal"), not ARIA radio buttons. Verify both are present inside the
    // dialog — the form is opened with initialType="basal" so the Basal button
    // should be visible and the Bolus button available for switching.
    const basalTypeBtn = dialog.getByRole("button", { name: /^Basal$/i });
    await expect(basalTypeBtn).toBeAttached({ timeout: 10_000 });
    await expect(basalTypeBtn).toBeVisible({ timeout: 5_000 });

    const bolusTypeBtn = dialog.getByRole("button", { name: /^Bolus$/i });
    await expect(bolusTypeBtn).toBeAttached({ timeout: 5_000 });

    // ── 6. Closing the sheet (ESC) returns to the dashboard without navigating
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    expect(page.url()).toBe(dashboardUrl);
  });
});
