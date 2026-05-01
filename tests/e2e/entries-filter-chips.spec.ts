// End-to-end coverage for the active-filter chip row on /entries.
//
// Why this exists:
//   Task #7 added removable chips next to the Filters trigger so users
//   can see *which* filters are active without opening the dropdown,
//   and dismiss any single one with a click. Before this change the UI
//   only showed a numeric badge ("Filters · 3"). The chip row is
//   purely client-side (FilterState in `app/(protected)/entries/page.tsx`)
//   so a regression — wrong label, broken removal, missing wrap on
//   narrow viewports — would silently ship without these assertions.
//
// What this asserts (and why each piece matters):
//   1. With no filters active, no chips render and the trigger reads
//      just "Filters" (no count). This catches an accidental
//      reintroduction of the "Filters · N" suffix or a stray chip
//      element bleeding through the `activeChips.length === 0` branch.
//   2. Selecting one option from each of three sections (Entry type
//      "Bolus", Meal kind "Fast Carbs", Outcome "Good") produces three
//      chips with the matching human labels — proving the FilterState →
//      ENTRY_TYPE_OPTIONS / MEAL_KIND_OPTIONS / OUTCOME_OPTIONS label
//      mapping is intact.
//   3. Clicking a chip's button removes that single filter only — the
//      other two chips remain — proving the per-section removal
//      callback is wired to the right toggle.
//   4. Clearing every chip restores the inactive trigger style (no
//      chips, no count). This is the inverse of step 1 and guards
//      against the chip remove callback being a no-op.
//
// We use the same Supabase email/password login flow as the carb-unit
// spec so any regression between login → middleware → /entries → filter
// state is caught here too.

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

test.describe("Entries → active filter chips", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await loginAsTestUser(page);
    await page.goto("/entries");
    // Filters persist in sessionStorage across navigations, so wipe
    // the per-tab state to guarantee a clean baseline.
    await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
    await page.reload();
  });

  test("renders chips for active selections, removes them individually, and restores the inactive trigger", async ({ page }) => {
    const filtersBtn = page.getByRole("button", { name: /^Filters$/ });
    await expect(filtersBtn).toBeVisible();

    // ---- BASELINE: no chips, no count ------------------------------
    // The trigger label is exactly "Filters" (the old "· N" suffix
    // was deliberately removed in favour of the chip row).
    await expect(filtersBtn).toHaveText(/^Filters$/);
    // A "Remove filter:" aria-label is unique to chip buttons, so its
    // absence is a strong signal that no chips render at baseline.
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(0);

    // ---- OPEN PICKER + SELECT THREE FILTERS ------------------------
    await filtersBtn.click();
    const dialog = page.getByRole("dialog", { name: /Filter entries/i });
    await expect(dialog).toBeVisible();

    // The FilterSection renders each option as a checkbox-role pill
    // (see `FilterSection` in app/(protected)/entries/page.tsx). Use
    // role="checkbox" rather than "button" so we don't accidentally
    // match the trigger or the new chips outside the dialog.
    await dialog.getByRole("checkbox", { name: "Bolus", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Fast Carbs", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Good", exact: true }).click();

    // Close the dropdown so the chip row is the only thing in view.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // ---- THREE CHIPS PRESENT ---------------------------------------
    const bolusChip     = page.getByRole("button", { name: "Remove filter: Bolus" });
    const fastCarbsChip = page.getByRole("button", { name: "Remove filter: Fast Carbs" });
    const goodChip      = page.getByRole("button", { name: "Remove filter: Good" });
    await expect(bolusChip).toBeVisible();
    await expect(fastCarbsChip).toBeVisible();
    await expect(goodChip).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(3);

    // The trigger must NOT regrow a numeric count just because filters
    // are active — chips are the new affordance.
    await expect(filtersBtn).toHaveText(/^Filters$/);

    // ---- REMOVE ONE: only that chip disappears ---------------------
    await bolusChip.click();
    await expect(bolusChip).toBeHidden();
    await expect(fastCarbsChip).toBeVisible();
    await expect(goodChip).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(2);

    // ---- REMOVE THE OTHER TWO --------------------------------------
    await fastCarbsChip.click();
    await goodChip.click();
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(0);
    await expect(filtersBtn).toHaveText(/^Filters$/);
  });

  // The date-range section is structurally separate from the
  // checkbox-based multi-selects — it's a single-select group rendered
  // by `DateRangeSection`, and the chip's removal callback calls
  // `setDateRange("all")` instead of toggling a list. Cover it
  // explicitly so a regression in either side (chip generation OR
  // removal wiring) doesn't slip through behind the multi-select test.
  test("date range surfaces as a chip and clears back to All time when dismissed", async ({ page }) => {
    const filtersBtn = page.getByRole("button", { name: /^Filters$/ });

    // Open the dropdown and pick "Last 7 days". DateRangeSection uses
    // role="radio" pills; the option label ("Last 7 days") matches the
    // value rendered by `dateRangeSummary`, which is what the chip uses.
    await filtersBtn.click();
    const dialog = page.getByRole("dialog", { name: /Filter entries/i });
    await dialog.getByRole("radio", { name: "Last 7 days", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The chip label comes from `dateRangeSummary("7d", null, null)`
    // → "Last 7 days". Aria-label format matches the multi-select chips.
    const dateChip = page.getByRole("button", { name: "Remove filter: Last 7 days" });
    await expect(dateChip).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(1);

    // Clicking the chip must reset the range to "all" (the default
    // option), so reopening the panel shows "All time" selected.
    await dateChip.click();
    await expect(dateChip).toBeHidden();
    await expect(page.getByRole("button", { name: /^Remove filter:/ })).toHaveCount(0);

    await filtersBtn.click();
    const allTime = dialog.getByRole("radio", { name: "All time", exact: true });
    await expect(allTime).toHaveAttribute("aria-checked", "true");
  });

  // Narrow-viewport wrapping is a stated acceptance criterion of task
  // #7 ("On narrow screens the chip row wraps gracefully and never
  // overflows the viewport"). The styles set `flexWrap:"wrap"` and
  // chip `maxWidth:"100%"`, but only an actual layout assertion catches
  // a future regression where a developer accidentally swaps the row
  // to `nowrap` or removes the chip's `min-width:0`/ellipsis safety net.
  test("eight active chips wrap onto multiple rows on a narrow viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 720 });
    await page.reload();

    const filtersBtn = page.getByRole("button", { name: /^Filters$/ });
    await filtersBtn.click();
    const dialog = page.getByRole("dialog", { name: /Filter entries/i });
    // Pick all four entry-type options + all four meal-kind options →
    // 8 chips total, plenty to force wrapping at 380px.
    for (const name of ["Meal", "Bolus", "Basal", "Exercise"]) {
      await dialog.getByRole("checkbox", { name, exact: true }).click();
    }
    for (const name of ["Fast Carbs", "High Protein", "High Fat", "Balanced"]) {
      await dialog.getByRole("checkbox", { name, exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const chips = page.getByRole("button", { name: /^Remove filter:/ });
    await expect(chips).toHaveCount(8);

    // 1. No horizontal overflow on the document. `documentElement.scrollWidth`
    //    must not exceed `clientWidth` — the most direct signal that the
    //    chip row didn't push the page wider than the viewport.
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);

    // 2. Chips genuinely wrap onto multiple rows: at least two distinct
    //    `top` values across the 8 chip bounding boxes. A single-row
    //    layout would produce one `top` value (modulo sub-pixel jitter).
    const tops = await chips.evaluateAll(els =>
      els.map(el => Math.round(el.getBoundingClientRect().top)),
    );
    const distinctTops = new Set(tops);
    expect(distinctTops.size).toBeGreaterThanOrEqual(2);

    // 3. Every chip stays inside the viewport horizontally — no chip
    //    extends past the right edge of the page.
    const rightEdges = await chips.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().right),
    );
    for (const right of rightEdges) {
      expect(right).toBeLessThanOrEqual(overflow.client + 1);
    }
  });
});
