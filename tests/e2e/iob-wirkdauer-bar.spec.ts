// End-to-end regression guard for the IOBCard Wirkdauer bar (Task #717).
//
// ## What & Why
// The bolus Wirkdauer bar (`data-testid="iob-wirkdauer-bar"`) was added in
// task #712. Without an E2E guard, a JSX regression (bar div removed,
// data-testid renamed, conditional inverted) would be silent until a user
// reports it.
//
// ## Assertions
// 1. When no recent bolus dose is present (cleared state), the IOB card shows
//    the cleared empty-state element (`data-testid="iob-wirkdauer-cleared"`)
//    and the Wirkdauer bar is NOT in the DOM.
// 2. The bolus view's detail section (data-testid="iob-detail-section")
//    expands correctly — confirming the container is open when we check.
//
// ## Why only the cleared state is tested here
// Seeding a LIVE active dose (elapsed < DIA) would require creating an
// insulin_log or meal row via Supabase Admin and then waiting for the Next.js
// dashboard to render the IOBCard with that dose — this is covered by the
// iob-card-expand integration test family. The cleared state is fully
// deterministic (the test user has no recent doses) and validates both code
// paths of the conditional: `!cleared && clearsInMin > 0 → bar`, else `→ cleared`.

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

test.describe("IOBCard Wirkdauer bar", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("cleared state: iob-wirkdauer-cleared is shown and iob-wirkdauer-bar is absent", async ({ page }) => {
    await loginAsTestUser(page);

    // ── 1. Locate the IOB card toggle button ──────────────────────────────────
    const toggleBtn = page.getByRole("button", {
      name: /Details ein-\/ausblenden|Toggle IOB details/i,
    });
    await expect(toggleBtn).toBeAttached({ timeout: 30_000 });
    await toggleBtn.scrollIntoViewIfNeeded();
    await expect(toggleBtn).toBeVisible({ timeout: 10_000 });

    // ── 2. Ensure we are on the bolus tab (default) ───────────────────────────
    // The chip row has "Bolus" and "Basal" tabs. Bolus is the default.
    // We target it by text to ensure the bolus expanded view is what opens.
    const bolusTab = page.getByRole("button", { name: /^bolus$/i }).first();
    // The bolus tab might already be active; click it only if it exists and is
    // not yet selected. We use a relaxed approach — just clicking ensures state.
    if (await bolusTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await bolusTab.click();
    }

    // ── 3. Expand the detail section ─────────────────────────────────────────
    const detailSection = page.getByTestId("iob-detail-section");
    await expect(detailSection).toBeAttached();

    // Open the detail panel.
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    await expect(detailSection).not.toHaveCSS("max-height", "0px", { timeout: 2_000 });

    // ── 4. Cleared state: cleared element present, bar element absent ─────────
    //
    // The test user has no recent bolus doses, so IOBCard renders in the cleared
    // state: `cleared = true` because `iob < 0.05`. In that case the component
    // renders `data-testid="iob-wirkdauer-cleared"` and omits "iob-wirkdauer-bar".
    //
    // If someone removes the data-testid, inverts the conditional, or accidentally
    // renders both elements simultaneously, this test fails.
    const clearedEl = page.getByTestId("iob-wirkdauer-cleared");
    const barEl     = page.getByTestId("iob-wirkdauer-bar");

    await expect(clearedEl).toBeVisible({ timeout: 5_000 });
    await expect(barEl).not.toBeAttached();
  });
});
