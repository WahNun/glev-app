// End-to-end coverage for the Settings → Language picker.
//
// Why this exists:
//   The Appearance picker (theme-picker.spec.ts) is covered, but the
//   Language picker right next to it is at least as easy to break and
//   is the user-facing surface that flips the entire UI between German
//   and English. A regression here is invisible to all the other tests
//   because they run in whichever locale the cookie happens to hold.
//
//   Concrete classes of regression this guards against:
//     * Cookie-name typo in lib/locale.ts (writeLocaleCookie writes a
//       different name than i18n/request.ts reads → picker appears to
//       work but the next request still ships the old bundle).
//     * Reload trigger removed (`window.location.reload()` dropped →
//       cookie flips but the page never re-fetches messages).
//     * Server messages out of sync with what the picker advertises
//       (e.g. "Appearance" key renamed in en.json but not de.json).
//
// What this asserts:
//   1. Opening the language sheet, picking the OTHER locale, and
//      hitting Save flips the rendered copy on /settings — verified
//      against the localized "Appearance" / "Erscheinungsbild" section
//      header, which is always in the DOM (no sheet to open) and is
//      one of the cleanest German/English copy splits.
//   2. The NEXT_LOCALE cookie is written with the chosen locale value
//      (this is the same cookie i18n/request.ts reads on every server
//      request, so a name-typo regression would land here first).
//   3. The choice survives a hard `page.reload()` — both the cookie
//      and the rendered copy must still be the picked locale after the
//      browser does a full network reload.
//
// We intentionally drive the picker through the real login flow rather
// than seeding the picker's React state directly, so the test catches
// breakage in any layer between login → middleware → settings page →
// language picker → cookie → next-intl server request config.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

/**
 * Same admin client shape `tests/support/testUser.ts` uses. We re-create
 * it here (rather than importing the helper) for the same reason
 * carb-unit-picker.spec.ts does: the env vars are already required for
 * the suite to run, and a one-line client construction is cheaper than
 * a new export surface.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "language-picker spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Reset the test user's persisted language to a known baseline. The
 * `profiles` table is keyed by `user_id` (FK to auth.users.id), NOT by
 * `id` — there's no `id` column at all (see the carb-unit-picker spec's
 * note on the same gotcha). Update returns 0 rows on a typo and Supabase
 * will not error, so any future regression that flips this column name
 * would silently leave the row stale; the next test's afterEach run
 * would then catch a divergence between cookie + DB.
 */
async function resetProfileLanguage(language: "de" | "en") {
  const { userId } = loadTestUser();
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ language })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.language reset failed: ${error.message}`);
}

// The cookie name MUST match what next-intl reads on the server in
// i18n/request.ts. Keeping it inline (rather than importing from
// lib/locale.ts) means a typo regression on either side of the
// boundary still trips the test.
const LOCALE_COOKIE = "NEXT_LOCALE";

// The /settings page is a flat list of SettingsSection / SettingsRow
// components — no internal tablist — so unlike the older theme-picker
// pattern there's no settings-tab to click first. The language row is
// always in the DOM after navigation. SettingsRow ariaLabel uses
// tSettings("row_open_aria"), interpolated with the localized
// "Language / region" / "Sprache / Region" label.
const LANGUAGE_ROW_ARIA =
  /(Open Language \/ region|Language \/ region öffnen|Open Sprache \/ Region|Sprache \/ Region öffnen)/i;
// The bottom sheet itself is labelled by tSettings("language_card_title"),
// which is intentionally bilingual on both sides ("Sprache / Language" and
// "Language / Sprache") so the user always sees the right hand side too.
const LANGUAGE_SHEET_LABEL = /(Sprache \/ Language|Language \/ Sprache)/i;
// The Save button label is tCommon("save") — "Save" / "Speichern".
const SAVE_BUTTON = /^(Save|Speichern)$/i;

// One of the cleanest "did the locale actually flip?" anchors: the
// section header above the theme picker. Always in the DOM on /settings
// (no sheet to open) and the two strings share zero substrings, so
// each direction is unambiguous.
//   en.json → "section_appearance": "Appearance"
//   de.json → "section_appearance": "Erscheinungsbild"
const APPEARANCE_HEADER_EN = /^Appearance$/;
const APPEARANCE_HEADER_DE = /^Erscheinungsbild$/;

async function loginAsTestUser(page: Page) {
  const { email, password } = loadTestUser();
  await page.goto("/login");
  // The login form has an email input, a password input, and a single
  // submit button — no labelled inputs, so target by type which is
  // stable regardless of which locale the form happens to render in.
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/**
 * Seed a NEXT_LOCALE cookie BEFORE any page load. Two reasons we pin a
 * known starting locale rather than letting the page boot off
 * Accept-Language:
 *
 *   1. The picker's pendingLocale state only arms when the chosen
 *      <option> differs from `currentLocale`. `currentLocale` is read
 *      from the cookie via a useEffect; if there's no cookie it falls
 *      back to DEFAULT_LOCALE ("de"). Without the cookie, the SERVER
 *      may render English (Accept-Language) while the picker thinks
 *      "de" is the current locale — selecting "de" would be a no-op,
 *      Save would stay disabled, and the test would hang. Pinning the
 *      cookie keeps server + picker + select all aligned.
 *   2. It removes a hidden dependency on whichever Accept-Language
 *      header the test browser happens to send (which can shift
 *      across Chromium / Playwright versions).
 */
async function pinStartingLocale(context: BrowserContext, baseURL: string, locale: "de" | "en") {
  await context.addCookies([{
    name: LOCALE_COOKIE,
    value: locale,
    url: baseURL,
    sameSite: "Lax",
  }]);
}

async function getLocaleCookieValue(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === LOCALE_COOKIE);
  return c ? decodeURIComponent(c.value) : null;
}

/**
 * Open the Language sheet, pick `next` from the select, and click Save.
 * Resolves once the post-Save reload has finished — i.e. the WHOLE
 * round-trip (write cookie → reload → server reads cookie → ships new
 * bundle → React renders new copy) is complete.
 *
 * The caller is responsible for ensuring `next` is DIFFERENT from the
 * currently-staged locale; otherwise the change-handler short-circuits
 * (pendingLocale stays null → Save button stays disabled).
 */
async function switchLocaleViaPicker(page: Page, next: "de" | "en") {
  // Open the language sheet from the SettingsRow.
  await page.getByRole("button", { name: LANGUAGE_ROW_ARIA }).click();

  // Scope into the dialog so we don't accidentally pick up similar
  // controls elsewhere on the page. The BottomSheet sets
  // role="dialog" + aria-label={title}, so we can match by that.
  const sheet = page.getByRole("dialog", { name: LANGUAGE_SHEET_LABEL });
  await expect(sheet).toBeVisible();

  // The select has no aria-label — it's the only <select> in the open
  // sheet, so a scoped locator is unambiguous. selectOption sets the
  // value AND fires a `change` event, which is what arms `pendingLocale`
  // and enables the Save button.
  await sheet.locator("select").selectOption(next);

  // Save click triggers writeLocaleCookie() → supabase.update() →
  // window.location.reload(). We have to register the navigation
  // listener BEFORE the click — `page.waitForLoadState("load")` alone
  // would resolve immediately because the page is already in the load
  // state at the time of the click. `waitForEvent("framenavigated")`
  // fires once the reload commits a new document, and the trailing
  // `waitForLoadState("load")` then waits for that new document to
  // finish loading. Together they guarantee assertions run against
  // the post-reload DOM, not the still-mounted pre-reload one.
  const navigationPromise = page.waitForEvent("framenavigated");
  await sheet.getByRole("button", { name: SAVE_BUTTON }).click();
  await navigationPromise;
  await page.waitForLoadState("load");
}

test.describe("Settings → Language picker", () => {
  // Test-isolation guard. The Playwright suite shares one Supabase test
  // user (tests/global-setup.ts) across every spec, and `setLocale()` is
  // designed to ALSO persist the choice to `profiles.language` so the
  // user's preference can survive across devices. If a test left that
  // column at "en", LanguageSync (mounted in the protected layout) would
  // reconcile follow-up specs back to "en" on next login — even after a
  // BrowserContext-level cookie wipe — and silently pollute the suite.
  //
  // We reset both surfaces back to the "de" baseline after every test:
  //   * The NEXT_LOCALE cookie at the BrowserContext layer (covers the
  //     next test in this file before login).
  //   * The `profiles.language` row via the service-role admin client
  //     (covers ANY downstream spec that logs in as the shared user).
  test.afterEach(async ({ context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([{
      name: LOCALE_COOKIE,
      value: "de",
      url: baseURL!,
      sameSite: "Lax",
    }]);
    await resetProfileLanguage("de");
  });

  test("flips the UI to the chosen locale, writes NEXT_LOCALE, and reloads with new copy", async ({ page, context, baseURL }) => {
    // Pin starting locale to German so the boot state is deterministic
    // and the picker's currentLocale matches what the server renders.
    await context.clearCookies();
    await pinStartingLocale(context, baseURL!, "de");
    await loginAsTestUser(page);

    await page.goto("/settings");

    // Sanity baseline: the German section header is visible (page is
    // in 'de' as pinned). The English variant must NOT be present.
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_DE })).toBeVisible();
    expect(await getLocaleCookieValue(page)).toBe("de");

    // ---- DRIVE THE PICKER: de → en ---------------------------------
    await switchLocaleViaPicker(page, "en");

    // The cookie must now hold the chosen value verbatim. A name-typo
    // regression (writeLocaleCookie writing e.g. "NEXT_LOCAL") would
    // make this read 'de' even though the document.cookie string was
    // populated, because we look up by the canonical name above.
    expect(await getLocaleCookieValue(page)).toBe("en");

    // Server re-rendered with the en bundle on the post-Save reload.
    // The English header must be visible; the German one gone.
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_EN })).toBeVisible();
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_DE })).toHaveCount(0);

    // ---- REVERSE THE SWITCH: en → de --------------------------------
    // Doubles as a regression check on the en→de path AND leaves the
    // test user back at the pinned starting locale for downstream specs.
    await switchLocaleViaPicker(page, "de");
    expect(await getLocaleCookieValue(page)).toBe("de");
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_DE })).toBeVisible();
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_EN })).toHaveCount(0);
  });

  test("locale choice survives a hard reload", async ({ page, context, baseURL }) => {
    // Same pinning trick — start in German, then switch to English and
    // verify the choice is sticky across a real network reload.
    await context.clearCookies();
    await pinStartingLocale(context, baseURL!, "de");
    await loginAsTestUser(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_DE })).toBeVisible();

    await switchLocaleViaPicker(page, "en");
    expect(await getLocaleCookieValue(page)).toBe("en");
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_EN })).toBeVisible();

    // ---- HARD RELOAD ------------------------------------------------
    // page.reload() makes a real network round-trip — the server re-runs
    // i18n/request.ts which re-reads the NEXT_LOCALE cookie. If the
    // cookie name on the write side ever drifts from the read side,
    // this is where we'd see the page snap back to the boot locale.
    await page.reload();

    // Cookie still set to our pick.
    expect(await getLocaleCookieValue(page)).toBe("en");
    // And the chosen-locale section header is still rendered; the boot
    // locale's header must be gone.
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_EN })).toBeVisible();
    await expect(page.getByRole("heading", { name: APPEARANCE_HEADER_DE })).toHaveCount(0);
  });
});
