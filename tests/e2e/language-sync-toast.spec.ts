// Regression guard for Task #947: LanguageSync shows the correct toast
// when the Supabase profiles PATCH succeeds or fails.
//
// Why this exists:
//   `LanguageSync` (components/LanguageSync.tsx) reads a `glev_lang_toast`
//   sessionStorage flag set by `setLocale()` before the page reloads.
//   On the next mount it calls `persistLocaleToProfile()`, which PATCHes
//   `profiles.language` in Supabase. Depending on the result it shows:
//     • success  → green "Language saved to your account" toast
//     • failure  → red "Language saved on this device only — sync failed" toast
//
//   Without an automated test the red path is invisible: a silent Supabase
//   error, an RLS rejection, or a network hiccup would drop the error toast
//   without any test catching it.
//
// What this asserts:
//   1. Error path: PATCH to /rest/v1/profiles returns 503 →
//      the "saved on this device only" (red) toast is visible.
//   2. Happy path: PATCH is NOT intercepted →
//      the "saved to your account" (green) toast is visible.
//
// Strategy:
//   We skip UI-driven language switching (which triggers a page reload that
//   complicates route-intercept timing) and instead inject the trigger
//   conditions directly:
//     • NEXT_LOCALE cookie set to a valid locale (so `readLocaleCookie()`
//       returns non-null)
//     • `glev_lang_toast = "pending"` in sessionStorage (LanguageSync then
//       calls `persistLocaleToProfile()`)
//   Then we reload the page so LanguageSync's useEffect fires, and we
//   assert the toast rendered by the component.
//
//   For the error path the route intercept filters on PATCH only, leaving
//   the GET (profile read for cross-device sync) untouched so the rest of
//   the component flow is unaffected.
//
// Translation-key guard:
//   A fast synchronous test asserts that both `lang_saved_account` and
//   `lang_saved_device_only` exist in `messages/en.json` and
//   `messages/de.json` before the browser tests run. A missing key would
//   cause a silent no-op toast instead of a failing test.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loadTestUserByIndex } from "../support/testUser";

// ---------------------------------------------------------------------------
// Translation-key guard
// ---------------------------------------------------------------------------
const EN_MESSAGES = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "messages/en.json"), "utf8"),
) as Record<string, Record<string, string>>;

const DE_MESSAGES = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "messages/de.json"), "utf8"),
) as Record<string, Record<string, string>>;

test("messages/en.json contains both LanguageSync toast keys", () => {
  for (const key of ["lang_saved_account", "lang_saved_device_only"]) {
    expect(
      EN_MESSAGES["settings"]?.[key],
      `messages/en.json is missing "settings.${key}"`,
    ).toBeTruthy();
  }
});

test("messages/de.json contains both LanguageSync toast keys", () => {
  for (const key of ["lang_saved_account", "lang_saved_device_only"]) {
    expect(
      DE_MESSAGES["settings"]?.[key],
      `messages/de.json is missing "settings.${key}"`,
    ).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set the NEXT_LOCALE cookie before the first navigation so the server
 *  renders the expected locale bundle on the initial request. */
async function setLocaleCookie(
  context: BrowserContext,
  locale: "de" | "en",
): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: "NEXT_LOCALE",
      value: locale,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function loginAsTestUser(page: Page, workerIndex: number): Promise<void> {
  const { email, password } = loadTestUserByIndex(workerIndex);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/** Inject the sessionStorage flag that LanguageSync reads to decide
 *  whether a DB write is pending after a language switch.  Must be called
 *  while a protected page is open (sessionStorage is origin-scoped). */
async function injectPendingWriteFlag(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.setItem("glev_lang_toast", "pending");
  });
}

/** Install a route intercept that forces PATCH requests to the Supabase
 *  `profiles` table to return a 503.  GET/HEAD requests (the cross-device
 *  sync SELECT in LanguageSync step 2) pass through untouched. */
async function interceptProfilesPatchWith503(page: Page): Promise<void> {
  await page.route("**/rest/v1/profiles*", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Service Unavailable (test intercept)" }),
      });
    } else {
      await route.continue();
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("LanguageSync toast — DB write error path", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("shows the red error toast when the Supabase PATCH returns 503", async ({
    page,
    context,
  }) => {
    // Start in German so `readLocaleCookie()` returns "de" after login.
    await setLocaleCookie(context, "de");

    // Intercept BEFORE any navigation so the handler is active for the
    // reload that follows the pending-flag injection.
    await interceptProfilesPatchWith503(page);

    await loginAsTestUser(page, test.info().workerIndex);

    // After login we are on /dashboard — LanguageSync is mounted in the
    // protected layout.  Inject the pending flag, then reload so that
    // LanguageSync's useEffect fires and tries to persist the locale.
    await injectPendingWriteFlag(page);

    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.reload(),
    ]);

    // The error toast renders as a `role="status"` element and contains
    // the "device only" copy from messages/de.json (DE locale is active).
    const errorToast = page.getByRole("status");
    await expect(errorToast).toBeVisible({ timeout: 8_000 });
    await expect(errorToast).toContainText(
      DE_MESSAGES["settings"]["lang_saved_device_only"],
    );
  });
});

test.describe("LanguageSync toast — happy path", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("shows the green success toast when the Supabase PATCH succeeds", async ({
    page,
    context,
  }) => {
    // Use English so we can verify the EN toast copy.
    await setLocaleCookie(context, "en");

    await loginAsTestUser(page, test.info().workerIndex);

    await injectPendingWriteFlag(page);

    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.reload(),
    ]);

    // The success toast contains the "saved to your account" copy from
    // messages/en.json.  No route intercept — the real Supabase write runs.
    const successToast = page.getByRole("status");
    await expect(successToast).toBeVisible({ timeout: 8_000 });
    await expect(successToast).toContainText(
      EN_MESSAGES["settings"]["lang_saved_account"],
    );
  });
});
