// End-to-end coverage for the Settings → Language preference round-trip.
//
// Why this exists (and how it differs from language-picker.spec.ts):
//   language-picker.spec.ts verifies that the UI copy flips (cookie write,
//   text changes, hard-reload survival) and that profiles.language is
//   written to the database.
//
//   This spec verifies the FULL round-trip from the user perspective:
//     1. User changes language in Settings → EN.
//     2. profiles.language = 'en' lands in the database (polled).
//     3. After the post-Save reload, the <html lang="en"> attribute is set.
//     4. Reverse: switch back to DE → html[lang="de"].
//
//   The html[lang] attribute is the canonical locale signal that:
//     • Screen readers use to select the right language voice.
//     • next-intl sets via <html lang={locale}> in app/layout.tsx.
//     • SEO crawlers read to determine the document language.
//   A regression where the cookie flips but the server still ships the
//   old locale bundle (e.g. because i18n/request.ts reads a different
//   cookie name) would show here as the html[lang] staying at "de".

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "language-preference spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readPersistedLanguage(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("language")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles.language read failed: ${error.message}`);
  return (data?.language ?? null) as string | null;
}

async function resetProfileLanguage(userId: string, language: "de" | "en") {
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ language })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.language reset failed: ${error.message}`);
}

const LOCALE_COOKIE = "NEXT_LOCALE";

// Aria patterns for the language row and sheet — mirrors language-picker.spec.ts
// so both specs stay aligned when the UI copy changes.
const LANGUAGE_ROW_ARIA =
  /(Open Language \/ region|Language \/ region öffnen|Open Sprache \/ Region|Sprache \/ Region öffnen)/i;
const LANGUAGE_SHEET_LABEL = /(Sprache \/ Language|Language \/ Sprache)/i;
const SAVE_BUTTON = /^(Save|Speichern)$/i;

async function pinStartingLocale(
  context: BrowserContext,
  baseURL: string,
  locale: "de" | "en",
) {
  await context.addCookies([
    {
      name: LOCALE_COOKIE,
      value: locale,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
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

/**
 * Open the language sheet in Settings, pick `next`, click Save, and wait
 * for the post-Save reload to finish. The caller must ensure `next` differs
 * from the currently rendered locale, otherwise the Save button stays disabled.
 */
async function switchLocaleViaPicker(page: Page, next: "de" | "en") {
  await page.getByRole("button", { name: LANGUAGE_ROW_ARIA }).click();

  const sheet = page.getByRole("dialog", { name: LANGUAGE_SHEET_LABEL });
  await expect(sheet).toBeVisible();

  await sheet.locator("select").selectOption(next);

  const navigationPromise = page.waitForEvent("framenavigated");
  await sheet.getByRole("button", { name: SAVE_BUTTON }).click();
  await navigationPromise;
  await page.waitForLoadState("load");
}

test.describe("Language preference round-trip", () => {
  test.afterEach(async ({ context, baseURL }) => {
    const { userId } = loadTestUserByIndex(test.info().workerIndex);
    await context.clearCookies();
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "de",
        url: baseURL!,
        sameSite: "Lax",
      },
    ]);
    await resetProfileLanguage(userId, "de");
  });

  test(
    "switching to EN writes profiles.language='en' to DB and sets html[lang='en'] after reload",
    async ({ page, context, baseURL }) => {
      const { userId } = loadTestUserByIndex(test.info().workerIndex);

      // Start from a clean German baseline.
      await context.clearCookies();
      await pinStartingLocale(context, baseURL!, "de");
      await loginAsTestUser(page, test.info().workerIndex);

      // Pre-check: DB must already be 'de' (or null — null means the column
      // was never written, which is a separate bug the DB write test catches).
      const initialDbLang = await readPersistedLanguage(userId);
      // Accept null here only if the profiles row is genuinely new; the
      // important assertion is what happens AFTER the switch.
      expect(
        initialDbLang === null || initialDbLang === "de",
        `profiles.language baseline expected 'de' or null, got '${initialDbLang}'`,
      ).toBe(true);

      // The <html> element must carry lang="de" on the German baseline.
      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute("lang", "de");

      // ---- Switch de → en via the Settings picker ----------------------
      await switchLocaleViaPicker(page, "en");

      // 1. DB write: profiles.language must become 'en'.
      //    persistLocaleToProfile() fires before the reload, so by the time
      //    the reload has settled the row should already be committed. We
      //    poll with a 10 s timeout to absorb CI network jitter.
      await expect
        .poll(
          () => readPersistedLanguage(userId),
          {
            timeout: 10_000,
            message:
              "profiles.language must be updated to 'en' after picker switch",
          },
        )
        .toBe("en");

      // 2. The post-Save reload re-ran i18n/request.ts which reads the
      //    NEXT_LOCALE cookie and shipped the English bundle. The <html>
      //    element must now carry lang="en".
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      // ---- Reverse: switch en → de and verify html[lang] flips back ----
      await switchLocaleViaPicker(page, "de");

      await expect
        .poll(
          () => readPersistedLanguage(userId),
          {
            timeout: 10_000,
            message: "profiles.language must revert to 'de'",
          },
        )
        .toBe("de");

      await expect(page.locator("html")).toHaveAttribute("lang", "de");
    },
  );

  test(
    "html[lang] is correct after a hard reload following a language switch",
    async ({ page, context, baseURL }) => {
      // Complements the above test by verifying the attribute is stable
      // across a NEW navigation (not just the post-Save auto-reload).
      // This guards against a theoretical race where the auto-reload
      // happens to carry the right bundle but a fresh navigation fetches
      // the wrong locale because the cookie was written incorrectly.
      await context.clearCookies();
      await pinStartingLocale(context, baseURL!, "de");
      await loginAsTestUser(page, test.info().workerIndex);

      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute("lang", "de");

      await switchLocaleViaPicker(page, "en");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");

      // Hard reload — page.reload() issues a real network request with the
      // current cookie jar. The server re-resolves the locale from the
      // NEXT_LOCALE cookie written by setLocale().
      await page.reload();
      await page.waitForLoadState("load");

      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    },
  );
});
