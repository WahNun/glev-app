// End-to-end test for IOB card expand/collapse interaction (Task #560).
//
// What & why:
//   Task #553 converted the IOB card from a 3D-flip animation to a
//   CSS max-height/opacity expand/collapse. Without an automated guard,
//   a regression (e.g. the detail section never appearing, aria-expanded
//   staying false, or the card not collapsing on a second tap) would be
//   silent until a user reports it.
//
// Assertions:
//   1. On page load the detail section is collapsed (max-height: 0px).
//   2. aria-expanded on the toggle button is "false" before any interaction.
//   3. Clicking the toggle button makes the detail section expand (max-height > 0).
//   4. aria-expanded flips to "true" after the first tap.
//   5. A second click collapses the detail section again (max-height back to 0).
//   6. aria-expanded returns to "false" after the second tap.
//
// Implementation notes:
//   The collapsible container uses `max-height: 0 / overflow: hidden` (not
//   `display: none`), so child elements keep a non-zero intrinsic bounding
//   box and `toBeVisible()` on them returns true even when collapsed.
//   We therefore check `toHaveCSS("max-height", "0px")` on the container
//   element (data-testid="iob-detail-section") and pair it with the
//   aria-expanded attribute on the toggle button.
//
// No data seeding is required — the IOB card always renders on the
// dashboard regardless of active doses (it shows a "cleared" state
// with 0.0 IE when no recent insulin is logged).

import { expect, test, type Page } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


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

test.describe("IOB card expand/collapse", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("tapping the IOB card expands and collapses the detail section", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);

    // ── 1. Locate the IOB card toggle button ───────────────────────────────
    //
    // The chevron button inside IOBCard carries a locale-sensitive
    // aria-label (German: "Details ein-/ausblenden",
    //             English:  "Toggle IOB details").
    // We target it by a regex that covers both locales, then scroll it
    // into view and wait for it to be attached to the DOM.
    const toggleBtn = page.getByRole("button", {
      name: /Details ein-\/ausblenden|Toggle IOB details/i,
    });

    await expect(toggleBtn).toBeAttached({ timeout: 30_000 });
    await toggleBtn.scrollIntoViewIfNeeded();
    await expect(toggleBtn).toBeVisible({ timeout: 10_000 });

    // ── 2. Locate the collapsible detail section container ─────────────────
    //
    // `data-testid="iob-detail-section"` is set on the outer collapsible
    // div in IOBCard.tsx. Its CSS transitions between max-height:0 (closed)
    // and max-height:600px (open). We assert on max-height rather than
    // toBeVisible() because the child nodes keep a non-zero intrinsic size
    // even when the container is clipped by overflow:hidden.
    const detailSection = page.getByTestId("iob-detail-section");
    await expect(detailSection).toBeAttached({ timeout: 10_000 });

    // ── 3. Collapsed state: aria-expanded is false and section is closed ───
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    await expect(detailSection).toHaveCSS("max-height", "0px");

    // ── 4. First tap: card expands ─────────────────────────────────────────
    //
    // We click the toggle button rather than the full card wrapper so the
    // action is deterministic — clicking the outer div can accidentally
    // land on child elements that stop propagation.
    await toggleBtn.click();

    // aria-expanded flips synchronously with state.
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    // max-height transitions to 600px. Allow up to 2 s for the CSS
    // transition (400 ms) to complete and Playwright to read the final value.
    await expect(detailSection).not.toHaveCSS("max-height", "0px", { timeout: 2_000 });

    // ── 5. Second tap: card collapses ──────────────────────────────────────
    await toggleBtn.click();

    await expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    await expect(detailSection).toHaveCSS("max-height", "0px", { timeout: 2_000 });
  });
});
