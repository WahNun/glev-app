// Regression coverage for "Light Mode nur in der App" (Task #184).
//
// The user's theme choice (Dark / Light / System) only applies inside
// the in-app surface. Marketing / public pages must always render in
// dark — many landing components hardcode dark hex values, so a global
// Light Mode would produce white-on-white text on the homepage and the
// other public surfaces.
//
// What this asserts:
//   1. Loading the marketing homepage `/` with a `THEME=light` cookie
//      already set still yields `<html data-theme="dark">` (both the
//      SSR-rendered attribute AND after the pre-hydration script has
//      run). The cookie itself stays untouched — we want the user's
//      pick to come back when they navigate into the app.
//   2. Navigating to `/login` (also a public route) keeps the document
//      clamped to dark.
//
// We don't drive the in-app side here; the existing theme-picker spec
// already covers that the picker writes the cookie and applies it to
// the in-app surface. This file's job is the marketing-clamp half of
// the contract.

import { expect, test } from "@playwright/test";

const THEME_COOKIE = "THEME";

test.describe("Marketing pages stay dark regardless of THEME cookie", () => {
  test("/ ignores THEME=light and renders dark", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([{
      name: THEME_COOKIE,
      value: "light",
      url: baseURL!,
      sameSite: "Lax",
    }]);

    await page.goto("/");

    // Both the SSR attribute and the post-pre-hydration value must be
    // "dark". They are set by different code paths (server in
    // app/layout.tsx vs the inline NO_FLICKER_THEME_SCRIPT) so a
    // regression in either alone would still flip one of them.
    const dataTheme = await page.locator("html").getAttribute("data-theme");
    expect(dataTheme).toBe("dark");

    // The browser-chrome meta also follows the same rule.
    const themeColor = await page
      .locator('meta[name="theme-color"]')
      .first()
      .getAttribute("content");
    expect(themeColor).toBe("#0A0A0F");

    // The cookie is untouched — the in-app surface should still see
    // the user's "light" pick on the next /settings visit.
    const cookies = await context.cookies();
    const themeCookie = cookies.find((c) => c.name === THEME_COOKIE);
    expect(themeCookie?.value).toBe("light");
  });

  test("/login ignores THEME=light and renders dark", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([{
      name: THEME_COOKIE,
      value: "light",
      url: baseURL!,
      sameSite: "Lax",
    }]);

    await page.goto("/login");

    const dataTheme = await page.locator("html").getAttribute("data-theme");
    expect(dataTheme).toBe("dark");
  });
});
