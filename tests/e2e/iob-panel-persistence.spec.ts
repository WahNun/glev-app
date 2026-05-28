// End-to-end test for IOB detail panel localStorage persistence (Task #563).
//
// What & why:
//   Task #561 added localStorage persistence for the IOB detail panel's
//   open/closed state using the key `glev_iob_expanded`. Without an
//   automated gate, a regression (wrong key name, missing `useEffect`
//   dep, SSR-side initialisation bypassing localStorage) would only be
//   discovered when a user notices the panel no longer remembers its
//   position across reloads.
//
// What this asserts:
//   1. Expanding the panel, then reloading the page → panel stays expanded.
//   2. Collapsing the panel, then reloading → panel stays collapsed.
//
// Mechanism under test:
//   • IOBCard initialises `expanded` from
//     `localStorage.getItem("glev_iob_expanded") === "true"` (client-side only).
//   • A `useEffect` fires whenever `expanded` changes and writes
//     `localStorage.setItem("glev_iob_expanded", String(expanded))`.
//   • The toggle button carries `aria-expanded={expanded}`, which is the
//     assertion target — no dependency on locale strings.
//
// Test isolation:
//   Each case starts by clearing `glev_iob_expanded` from localStorage so
//   a leftover value from a previous run cannot produce a false-positive.
//   Auth cookies are cleared before login in `beforeEach` to ensure we
//   always start from a clean session.
//
// What this does NOT test (and why):
//   • The visual expand/collapse animation — CSS transitions are not
//     meaningful to assert and would add flake.
//   • The IOB value or sparkline content — those are covered by unit
//     tests in `tests/unit/`.

import { expect, test, type Page } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

const IOB_LS_KEY = "glev_iob_expanded";

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

/** Returns the toggle button for the IOB detail panel.
 *  The button carries aria-expanded and a locale-independent role so
 *  we can locate it without depending on translated aria-label text. */
function iobToggleButton(page: Page) {
  // The chevron button is the only element on the page that:
  //   (a) has role="button" (implicit for <button>), and
  //   (b) has an aria-label matching either the German or English copy.
  // We accept both locales so the test is stable regardless of the
  // locale cookie the test user happens to have set.
  return page.getByRole("button", {
    name: /Details ein-\/ausblenden|Toggle IOB details/i,
  });
}

/** Read the current aria-expanded state of the IOB toggle button. */
async function isExpanded(page: Page): Promise<boolean> {
  const btn = iobToggleButton(page);
  const value = await btn.getAttribute("aria-expanded");
  return value === "true";
}

/** Read glev_iob_expanded directly from localStorage. */
async function getLocalStorageValue(page: Page): Promise<string | null> {
  return page.evaluate(
    (key: string) => window.localStorage.getItem(key),
    IOB_LS_KEY,
  );
}

/** Remove glev_iob_expanded from localStorage for a clean-slate start. */
async function clearLocalStorage(page: Page) {
  await page.evaluate(
    (key: string) => { try { window.localStorage.removeItem(key); } catch { /* noop */ } },
    IOB_LS_KEY,
  );
}

test.describe("IOB panel — localStorage persistence across page reload", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await loginAsTestUser(page, test.info().workerIndex);
    // Remove any leftover persistence key so each test begins from a
    // predictable (absent) state, independent of previous test runs.
    await clearLocalStorage(page);
  });

  test("panel stays expanded after a page reload", async ({ page }) => {
    const btn = iobToggleButton(page);
    await expect(btn).toBeVisible({ timeout: 20_000 });

    // ── 1. Start: ensure the panel is collapsed ─────────────────────────
    //
    // If the button is already expanded (e.g. a prior default), collapse
    // it first so the next click reliably puts it into the expanded state.
    if (await isExpanded(page)) {
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "false", { timeout: 5_000 });
    }

    // ── 2. Expand the panel ─────────────────────────────────────────────
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });

    // Verify localStorage was written before we reload.
    await expect.poll(() => getLocalStorageValue(page)).toBe("true");

    // ── 3. Reload and assert the panel is still expanded ────────────────
    await page.reload();
    // Wait for the dashboard to be interactive again after the reload.
    const btnAfterReload = iobToggleButton(page);
    await expect(btnAfterReload).toBeVisible({ timeout: 20_000 });
    await expect(btnAfterReload).toHaveAttribute("aria-expanded", "true", {
      timeout: 10_000,
    });

    // The localStorage key must still be set to "true" after reload so
    // a second reload would also restore the correct state.
    await expect.poll(() => getLocalStorageValue(page)).toBe("true");
  });

  test("panel stays collapsed after a page reload", async ({ page }) => {
    const btn = iobToggleButton(page);
    await expect(btn).toBeVisible({ timeout: 20_000 });

    // ── 1. Expand first (so we have something to collapse) ──────────────
    if (!(await isExpanded(page))) {
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
    }

    // ── 2. Collapse the panel ───────────────────────────────────────────
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false", { timeout: 5_000 });

    // Verify the key is written as "false" before the reload.
    await expect.poll(() => getLocalStorageValue(page)).toBe("false");

    // ── 3. Reload and assert the panel is still collapsed ───────────────
    await page.reload();
    const btnAfterReload = iobToggleButton(page);
    await expect(btnAfterReload).toBeVisible({ timeout: 20_000 });
    await expect(btnAfterReload).toHaveAttribute("aria-expanded", "false", {
      timeout: 10_000,
    });

    // localStorage key must remain "false" after reload.
    await expect.poll(() => getLocalStorageValue(page)).toBe("false");
  });
});
