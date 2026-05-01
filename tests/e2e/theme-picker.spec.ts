// End-to-end coverage for the Settings → Appearance picker.
//
// What this asserts (and why each piece matters):
//   1. The picker is wired to `useTheme` correctly — clicking a segment
//      updates `<html data-theme>` immediately, with no reload.
//   2. The persistence layer writes both the THEME cookie (used by the
//      pre-hydration script in app/layout.tsx) AND the `glev_theme`
//      localStorage entry (used as a backwards-compat fallback). A
//      regression in either name would silently break theme persistence.
//   3. The "system" option resolves against the OS preference live —
//      Playwright forces colorScheme: "dark" in the project config so
//      "system" must resolve to "dark".
//   4. After a full page reload, the SSR HTML already carries the
//      correct `data-theme` attribute. That's the FOUC guard: the very
//      first painted frame must be the right theme, before any JS runs.
//      We verify this by reading the raw HTML response (no JS executed)
//      and checking the attribute on `<html>`.
//
// We intentionally drive the picker through the real login flow rather
// than seeding cookies, so the test catches breakage in any layer
// between login → middleware → settings page → theme picker.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";
import { THEME_COOKIE, THEME_STORAGE_KEY } from "@/lib/theme";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

/**
 * The /settings page is a flat list of SettingsSection / SettingsRow
 * components — no internal tablist — so the Appearance radiogroup is
 * always in the DOM after navigation. Match labels against both the
 * German default ("Erscheinungsbild") and the English variant so the
 * spec stays stable regardless of the active locale at runtime. See
 * `tests/e2e/carb-unit-picker.spec.ts` for the same flat-page pattern.
 */
const APPEARANCE_LABEL = /^(Appearance|Erscheinungsbild)$/i;
const DARK_LABEL = /^(Dark|Dunkel)$/i;
const LIGHT_LABEL = /^(Light|Hell)$/i;
const SYSTEM_LABEL = /^System$/i;

async function loginAsTestUser(page: Page) {
  const { email, password } = loadTestUser();
  await page.goto("/login");
  // The login form is a <form> with a single submit button — no
  // labelled inputs, so target by placeholder/type which is stable.
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function getHtmlDataTheme(page: Page): Promise<string | null> {
  return page.locator("html").getAttribute("data-theme");
}

async function getThemeCookieValue(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const c = cookies.find(x => x.name === THEME_COOKIE);
  return c ? decodeURIComponent(c.value) : null;
}

async function getLocalStorageTheme(page: Page): Promise<string | null> {
  return page.evaluate(key => window.localStorage.getItem(key), THEME_STORAGE_KEY);
}

test.describe("Settings → Appearance theme picker", () => {
  test.beforeEach(async ({ page, context }) => {
    // Start each test with a clean slate — no leftover THEME cookie or
    // localStorage entry from a previous case. Otherwise the "system"
    // assertion could pass for the wrong reason.
    await context.clearCookies();
    await loginAsTestUser(page);
    await page.evaluate(() => {
      try { window.localStorage.removeItem("glev_theme"); } catch { /* ignore */ }
    });
  });

  test("switches dark / light / system live and persists each choice", async ({ page }) => {
    await page.goto("/settings");

    // The radiogroup is labelled by the localized "Appearance" string —
    // we don't want this test to depend on the active locale, so we
    // accept either the German default ("Erscheinungsbild") or the
    // English label, and use a case-insensitive match to be robust
    // against minor copy tweaks.
    const radiogroup = page.getByRole("radiogroup", { name: APPEARANCE_LABEL });
    await expect(radiogroup).toBeVisible();

    const darkBtn   = radiogroup.getByRole("radio", { name: DARK_LABEL });
    const lightBtn  = radiogroup.getByRole("radio", { name: LIGHT_LABEL });
    const systemBtn = radiogroup.getByRole("radio", { name: SYSTEM_LABEL });

    // --- DARK -------------------------------------------------------
    await darkBtn.click();
    await expect.poll(() => getHtmlDataTheme(page)).toBe("dark");
    await expect(darkBtn).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => getThemeCookieValue(page)).toBe("dark");
    await expect.poll(() => getLocalStorageTheme(page)).toBe("dark");

    // --- LIGHT ------------------------------------------------------
    await lightBtn.click();
    await expect.poll(() => getHtmlDataTheme(page)).toBe("light");
    await expect(lightBtn).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => getThemeCookieValue(page)).toBe("light");
    await expect.poll(() => getLocalStorageTheme(page)).toBe("light");

    // --- SYSTEM ------------------------------------------------------
    // Playwright's project config pins colorScheme: "dark", so the
    // matchMedia listener inside ThemeProvider must resolve "system"
    // back to "dark". The choice cookie itself stores "system" — only
    // the *resolved* attribute differs.
    await systemBtn.click();
    await expect.poll(() => getHtmlDataTheme(page)).toBe("dark");
    await expect(systemBtn).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => getThemeCookieValue(page)).toBe("system");
    await expect.poll(() => getLocalStorageTheme(page)).toBe("system");
  });

  test("preserves chosen theme across a full reload with no FOUC", async ({ page, request }) => {
    await page.goto("/settings");

    const radiogroup = page.getByRole("radiogroup", { name: APPEARANCE_LABEL });
    const lightBtn = radiogroup.getByRole("radio", { name: LIGHT_LABEL });
    await lightBtn.click();
    await expect.poll(() => getHtmlDataTheme(page)).toBe("light");
    await expect.poll(() => getThemeCookieValue(page)).toBe("light");

    // ---- FOUC guard: the SSR/pre-hydration HTML must already have
    // `data-theme="light"`. We hit the URL through Playwright's request
    // API with the browser's cookies attached so JS never runs — what
    // we get back is exactly what the browser would render in the
    // first frame. If the pre-hydration script regressed (cookie name
    // typo, etc.), the attribute would be missing or "dark" here.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    const res = await request.get("/settings", { headers: { Cookie: cookieHeader } });
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    // Match `<html ... data-theme="light"` — attribute order varies.
    expect(html).toMatch(/<html[^>]*\bdata-theme="light"/);

    // ---- Now do a real browser reload and confirm the live page also
    // ends up light.
    await page.reload();
    await expect.poll(() => getHtmlDataTheme(page)).toBe("light");
    // And the choice survives in both persistence layers after reload.
    await expect.poll(() => getThemeCookieValue(page)).toBe("light");
    await expect.poll(() => getLocalStorageTheme(page)).toBe("light");
  });
});
