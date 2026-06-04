// E2E coverage for the voice intent → InsulinForm pre-fill pipeline.
//
// Background:
//   The voice intent router classifies a spoken transcript and dispatches
//   a CustomEvent so log forms can pre-fill without any data being written
//   automatically (compliance gate D-003: no auto-save).
//
//   The safety risk: a bug in the classification logic or the event dispatch
//   could silently pre-fill wrong values. This spec pins the contract at the
//   browser level.
//
// What this asserts:
//   1. Dispatching `glev:open-bolus-log` with { units: 3, insulin_name: "NovoRapid" }
//      pre-fills the InsulinForm's units field with "3" and the insulin name
//      input with "NovoRapid" — without submitting anything.
//   2. The Save button ("Insulin loggen" / "Log Insulin") remains present
//      (D-003: user must still tap).
//   3. Dispatching without an insulin_name leaves the name field unchanged.
//   4. A glev:open-bolus-log event with units=0 leaves the units field unchanged
//      (no dangerous zero pre-fill — the handler guards `units > 0`).
//   5. The event forces the bolus tab even when another type is active.
//
// Implementation note:
//   We navigate to /engine?tab=bolus which mounts InsulinForm directly, then
//   use page.evaluate() to dispatch the CustomEvent. This bypasses voice
//   recording and Mistral — those are covered by the unit tests in
//   tests/unit/intentClassifier.test.ts and tests/unit/classifyIntentRoute.test.ts.
//   Here we close the browser-level gap: does InsulinForm actually listen for
//   the event and update state?

import { expect, test, type Page } from "@playwright/test";
import { ensureLoggedIn } from "../support/login";

async function loginAndGoToBolusTab(page: Page, workerIndex: number) {
  await ensureLoggedIn(page, workerIndex);

  // Navigate to /engine?tab=bolus — the `tab` query param is read by a
  // useEffect in the engine page and sets the tab state to "bolus", which
  // renders <InsulinForm /> directly (see engine/page.tsx).
  await page.goto("/engine?tab=bolus");

  // The BzCheckModal (aria-modal="true") can appear on first load for new
  // test users. While open it confines Playwright's getByRole() scope to
  // the dialog, making all out-of-modal elements invisible to role-based
  // locators. Dismiss it and wait for it to leave the DOM before proceeding.
  const bzDialog = page.locator('[role="dialog"][aria-modal="true"]');
  const dialogVisible = await bzDialog.isVisible({ timeout: 4_000 }).catch(() => false);
  if (dialogVisible) {
    // BzCheckModal is a CSS-transform bottom-sheet (always in DOM, slides
    // off-screen via translateY — never detaches). Its Abbrechen button is
    // below the viewport in headless mode so click() and force:true both fail.
    //
    // Strategy: focus the modal's numeric input (off-screen focus is fine in
    // Playwright) and press Escape. BzCheckModal attaches handleKeyDown to
    // that input; Escape calls onClose(), toggling open=false and sliding the
    // sheet away via CSS transition (0.28s).
    const bzInput = bzDialog.locator('input[type="number"]');
    await bzInput.focus();
    await page.keyboard.press("Escape");
    // Wait for the CSS slide-out transition to complete before continuing.
    await page.waitForTimeout(500);
  }

  // Wait for InsulinForm to mount. We locate the units input by the "+0.5"
  // step button that SnapSlider always renders next to it — language-agnostic
  // and structurally stable.
  await expect(page.locator('button[aria-label="+0.5"]')).toBeVisible({
    timeout: 30_000,
  });
}

// ── Locators (language-agnostic) ──────────────────────────────────────────

/**
 * The units input rendered by SnapSlider. Its aria-label comes from the
 * i18n key `engineLog.units_label` which is "Einheiten" (de) / "Units" (en).
 * We match both, plus the structural fallback (sits between −0.5 and +0.5).
 */
const unitsInput = (page: Page) =>
  page.locator('[aria-label="Units"], [aria-label="Einheiten"]').first();

/**
 * The save button. We use a filter (not getByRole) so the search is NOT
 * confined to any aria-modal scope. Matches "Insulin loggen" (de) and
 * "Log Insulin" (en).
 */
const saveBtn = (page: Page) =>
  page.locator("button").filter({ hasText: /Insulin loggen|Log Insulin/i });

// ── helpers ───────────────────────────────────────────────────────────────

async function dispatchBolusEvent(
  page: Page,
  detail: { units?: number; insulin_name?: string; notes?: string },
) {
  await page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent("glev:open-bolus-log", { detail: d }));
  }, detail);
  // Give React one frame to flush the state update.
  await page.waitForTimeout(200);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("voice-intent → InsulinForm pre-fill", () => {
  test(
    'glev:open-bolus-log pre-fills units=3 and insulin_name="NovoRapid"',
    async ({ page }) => {
      await loginAndGoToBolusTab(page, test.info().workerIndex);

      // Dispatch the event that useVoiceIntents would dispatch after
      // classifying the transcript "3 Einheiten NovoRapid".
      await dispatchBolusEvent(page, { units: 3, insulin_name: "NovoRapid" });

      // Units field must show "3".
      await expect(unitsInput(page)).toHaveValue("3");

      // Insulin name input must show "NovoRapid".
      // The input is a plain text <input> with placeholder "Fiasp" (bolus tab).
      const nameInput = page.locator('input[placeholder="Fiasp"]');
      await expect(nameInput).toHaveValue("NovoRapid");

      // Compliance gate D-003: Save button must still be present — the
      // event ONLY pre-fills the form; it never auto-submits.
      await expect(saveBtn(page)).toBeVisible();
    },
  );

  test(
    "glev:open-bolus-log without insulin_name does not corrupt the name field",
    async ({ page }) => {
      await loginAndGoToBolusTab(page, test.info().workerIndex);

      // Record whatever the name field shows before the event.
      const nameInput = page.locator('input[placeholder="Fiasp"]');
      const nameBefore = await nameInput.inputValue();

      // Dispatch without insulin_name.
      await dispatchBolusEvent(page, { units: 7 });

      // Units must update to 7.
      await expect(unitsInput(page)).toHaveValue("7");

      // Name field must remain unchanged — no phantom value.
      await expect(nameInput).toHaveValue(nameBefore);
    },
  );

  test(
    "glev:open-bolus-log with units=0 does not overwrite the units field",
    async ({ page }) => {
      await loginAndGoToBolusTab(page, test.info().workerIndex);

      // Record the default value before the event.
      const unitsBefore = await unitsInput(page).inputValue();

      // Dispatch with units=0 — the handler guards `units > 0` so the
      // field must stay at whatever it was before.
      await dispatchBolusEvent(page, { units: 0 });

      await expect(unitsInput(page)).toHaveValue(unitsBefore);
    },
  );

  test(
    "glev:open-bolus-log forces the bolus tab even when basal is active",
    async ({ page }) => {
      await loginAndGoToBolusTab(page, test.info().workerIndex);

      // Switch to basal tab first by clicking the "Basal" option in the
      // Segmented control.
      const basalBtn = page.getByRole("button", { name: /^Basal$/i });
      if ((await basalBtn.count()) > 0) {
        await basalBtn.first().click();
        // The placeholder changes from "Fiasp" to "Tresiba" on the basal tab.
        await expect(
          page.locator('input[placeholder="Tresiba"]'),
        ).toBeVisible({ timeout: 5_000 });
      }

      // Dispatch a bolus intent — the handler calls setType("bolus").
      await dispatchBolusEvent(page, { units: 4, insulin_name: "Fiasp" });

      // The form must switch back to bolus tab (placeholder = "Fiasp").
      await expect(page.locator('input[placeholder="Fiasp"]')).toBeVisible();

      await expect(unitsInput(page)).toHaveValue("4");
    },
  );
});
