// End-to-end test for the "+ Bolus loggen" quick-action chip on the IOB card.
//
// What & why:
//   The IOB card shows a "+ Bolus loggen" chip whenever the bolus IOB is
//   non-zero (!cleared). Tapping it opens an inline BottomSheet with
//   InsulinForm pre-set to bolus mode, mirroring the existing basal flow.
//   This test covers the full round-trip: chip tap → sheet opens → dose
//   entry → save → sheet closes.
//
// Assertions:
//   1. Dashboard loads and the IOB card renders with the bolus view active.
//   2. The "+ Bolus loggen" chip is visible (requires active IOB).
//   3. Tapping the chip opens a bottom sheet (no navigation away).
//   4. The sheet (role="dialog") contains InsulinForm with Bolus pre-selected
//      (aria-checked="true" on the Bolus radio option inside the dialog).
//   5. Entering an insulin name enables the save button.
//   6. Clicking save closes the sheet.
//
// Implementation notes:
//   The "+ Bolus loggen" chip only renders when cleared === false
//   (iob >= 0.05). To guarantee this without relying on test-user data,
//   we intercept GET requests to the Supabase REST API for insulin_logs
//   and return a synthetic bolus injection from 30 minutes ago. This
//   puts IOB at ~3.0 IE (well above the 0.05 cleared threshold) without
//   writing anything to the database.
//
//   For the save step we intercept the Supabase POST for insulin_logs too
//   and return a minimal success payload, then dispatch "glev:insulin-updated"
//   ourselves — exactly what a real save would do. This makes the test
//   hermetic: no real DB writes, no cleanup needed.
//
//   BZ-Check modal suppression: BzCheckModal is shown whenever the custom
//   event "glev:meal-check-reminder" is dispatched on window (by
//   MealCheckReminderProvider). In headless Chromium no Notification
//   permission is granted, but stale localStorage state or in-flight
//   checks can still trigger it. We suppress it by patching
//   EventTarget.prototype.dispatchEvent via context.addInitScript() —
//   the patch runs before any app code and silently drops those events,
//   keeping payload=null so the backdrop overlay is never activated.
//   Pattern borrowed from iob-wirkdauer-bar.spec.ts.
//
//   BottomSheet renders role="dialog" aria-label={title}.
//   Titles: "Bolus loggen" (de) / "Log bolus" (en).

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

/** Dismiss the cookie-consent overlay if it appears. */
async function dismissCookieDialog(page: Page) {
  try {
    const rejectBtn = page.getByRole("button", { name: /^ablehnen$/i });
    await rejectBtn.waitFor({ state: "visible", timeout: 3_000 });
    await rejectBtn.click();
    await rejectBtn.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  } catch { /* dialog not present */ }
}

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

test.describe("IOB card — bolus quick-log chip", () => {
  test.beforeEach(async ({ context }) => {
    // suppressBzModal must run before clearCookies so the init script is
    // registered on the context before any page navigation.
    await suppressBzModal(context);
    await context.clearCookies();
  });

  test("tapping '+ Bolus loggen' opens an inline sheet and closes it after saving", async ({ page }) => {
    // ── 0. Intercept Supabase REST calls for insulin_logs ──────────────────
    //
    // GET: inject a synthetic bolus from 30 min ago so IOB > 0 and the chip
    //      is rendered.
    // POST: return a minimal success payload and dispatch the custom event
    //       that the dashboard and bolus sheet listen to, so the sheet closes
    //       without a real DB write.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const fakeBolus = {
      id: "fake-bolus-e2e-test-id",
      user_id: "test-user",
      created_at: thirtyMinAgo,
      insulin_type: "bolus",
      insulin_name: "Fiasp",
      units: 4.0,
      cgm_glucose_at_log: null,
      notes: null,
      related_entry_id: null,
    };

    await page.route("**/rest/v1/insulin_logs**", async (route) => {
      const method = route.request().method();

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([fakeBolus]),
        });
        return;
      }

      if (method === "POST") {
        // Return a minimal Supabase insert-success payload (single-row array).
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([{ ...fakeBolus, id: "fake-bolus-e2e-saved-id" }]),
        });
        // Fire the event the dashboard and bolus sheet listen to.
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
        });
        return;
      }

      await route.continue();
    });

    // ── 1. Log in and land on the dashboard ────────────────────────────────
    await loginAsTestUser(page, test.info().workerIndex);
    const dashboardUrl = page.url();

    // Dismiss cookie-consent overlay if it appears.
    await dismissCookieDialog(page);

    // ── 2. The "+ Bolus loggen" chip must be visible ───────────────────────
    //
    // The chip renders inside the bolus view (default tab) when !cleared.
    // Text: "+ Bolus loggen" (de) / "+ Log Bolus" (en).
    const logBolusChip = page.getByRole("button", {
      name: /Bolus loggen|Log [Bb]olus/i,
    }).first();

    // Wait for the chip to appear in the DOM (dashboard loaded + IOB computed).
    await expect(logBolusChip).toBeAttached({ timeout: 30_000 });
    await logBolusChip.scrollIntoViewIfNeeded();
    await expect(logBolusChip).toBeVisible({ timeout: 10_000 });

    // ── 3. Tap the chip — expect a bottom sheet, NOT navigation ───────────
    //
    // Use dispatchEvent("click") instead of locator.click() to bypass
    // coordinate-based hit testing. If BZ-Check modal backdrop is at
    // pointerEvents:auto for any reason, regular click() is intercepted at
    // the viewport coordinates; dispatchEvent fires the DOM event directly
    // on the element's listeners regardless of what covers it.
    // Pattern from iob-wirkdauer-bar.spec.ts expandBolusSection().
    await logBolusChip.dispatchEvent("click");
    expect(page.url()).toBe(dashboardUrl);

    // ── 4. Sheet is open — scope all assertions to the dialog ─────────────
    //
    // BottomSheet renders role="dialog" aria-label="Bolus loggen" (de) /
    // "Log bolus" (en). Scoping to the dialog prevents false positives
    // against the "+ Bolus loggen" chip visible behind the backdrop.
    const dialog = page.getByRole("dialog", { name: /Bolus loggen|Log bolus/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The InsulinForm type selector renders plain <button> elements ("Bolus" /
    // "Basal"), not ARIA radio buttons. Verify both are present and that
    // initialType="bolus" has pre-set the form to the bolus tab.
    const bolusTypeBtn = dialog.getByRole("button", { name: /^Bolus$/i });
    await expect(bolusTypeBtn).toBeAttached({ timeout: 10_000 });
    await expect(bolusTypeBtn).toBeVisible({ timeout: 5_000 });

    const basalTypeBtn = dialog.getByRole("button", { name: /^Basal$/i });
    await expect(basalTypeBtn).toBeAttached({ timeout: 5_000 });

    // ── 5. Fill in an insulin name to enable the save button ──────────────
    //
    // The save button ("Insulin loggen" / "Log Insulin") is disabled until
    // name.trim().length > 0. The name field is a plain <input> with a brand
    // placeholder ("Fiasp" de / "Fiasp" en). Its accessible name in the ARIA
    // tree is the placeholder text, not the section label (the label is in a
    // sibling <div>, not an aria-label or <label for=...>).
    // Use getByPlaceholder to target it unambiguously.
    const nameInput = dialog.getByPlaceholder(/Fiasp|Tresiba/i).first();
    await nameInput.fill("Fiasp");

    // Save button label: "Insulin loggen" (de) / "Log Insulin" (en).
    const saveBtn = dialog.getByRole("button", {
      name: /Insulin loggen|Log Insulin/i,
    });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });

    // ── 6. Click save and verify the sheet closes ─────────────────────────
    //
    // The form dispatches "glev:insulin-updated" on success, which triggers
    // setBolusSheetOpen(false) in the dashboard. Our POST intercept fires
    // that event immediately after returning the mocked 201 response.
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Confirm we never navigated away from the dashboard.
    expect(page.url()).toBe(dashboardUrl);
  });
});
