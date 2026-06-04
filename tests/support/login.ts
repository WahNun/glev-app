// Shared Playwright login helper used across e2e specs.
//
// Why this file exists:
//   Multiple specs need to log in as a provisioned test user before they
//   can exercise authenticated routes. The plain "fill + click submit +
//   waitForURL" pattern has two failure modes in Replit dev:
//
//   1. CookieBanner blocks the form — context.clearCookies() removes the
//      glev_cookie_consent localStorage entry too (via clearCookies clearing
//      the Playwright context storage), leaving the cookie consent dialog
//      visible on top of the login form inputs.
//
//   2. router.replace("/dashboard") doesn't fire a real browser navigation —
//      fixed in app/login/page.tsx (window.location.replace). But to be safe,
//      tests should also pre-set cookie consent before navigating to /login.
//
// Usage:
//   import { ensureLoggedIn } from "../support/login";
//
//   test.beforeEach(async ({ context }) => {
//     await context.clearCookies();
//   });
//
//   test("...", async ({ page }) => {
//     await ensureLoggedIn(page, test.info().workerIndex);
//     // page is now on /dashboard
//   });

import type { Page } from "@playwright/test";
import { loadTestUserByIndex } from "./testUser";

/**
 * Navigate to /dashboard. If the app redirects to /login (session absent),
 * perform a full UI login and wait for /dashboard to load.
 *
 * Also handles:
 *   - Pre-setting glev_cookie_consent so the cookie banner never overlays
 *     the login form (important after context.clearCookies()).
 *   - Dismissing the BzCheckModal (bg-at-check sheet) via focus + Escape,
 *     as documented in .agents/memory/bzcheck-modal-playwright.md.
 *
 * After this function returns the page URL matches /dashboard.
 */
export async function ensureLoggedIn(
  page: Page,
  workerIndex: number,
): Promise<void> {
  // Pre-accept cookie consent so the CookieBanner never blocks the login
  // form. CookieBanner reads localStorage("glev_cookie_consent") on mount;
  // if unset it renders the dialog over the page. We inject this via
  // addInitScript so it is present even before any page navigation.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "glev_cookie_consent",
      JSON.stringify({
        v: 2,
        necessary: true,
        analytics: false,
        marketing: false,
      }),
    );
  });

  // Navigate to /dashboard — middleware redirects to /login if not authed.
  await page.goto("/dashboard", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const currentUrl = page.url();
  if (
    currentUrl.includes("/login") ||
    currentUrl.includes("/onboarding") ||
    currentUrl === "about:blank"
  ) {
    if (!currentUrl.includes("/login")) {
      await page.goto("/login", { waitUntil: "domcontentloaded" });
    }

    const { email, password } = loadTestUserByIndex(workerIndex);

    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);

    // Click submit and wait for the hard redirect to /dashboard.
    // The login page uses window.location.replace("/dashboard") so this
    // is a real browser navigation — waitForURL fires reliably.
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
      page.locator('button[type="submit"]').first().click(),
    ]);
  }

  // BzCheckModal can appear on first load for new test users. It confines
  // getByRole() scope to the dialog, making all out-of-modal elements
  // unreachable. Dismiss via focus + Escape (see bzcheck-modal-playwright.md).
  const bzDialog = page.locator('[role="dialog"][aria-modal="true"]');
  const dialogVisible = await bzDialog
    .isVisible({ timeout: 4_000 })
    .catch(() => false);
  if (dialogVisible) {
    const bzInput = bzDialog.locator('input[type="number"]');
    await bzInput.focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}
