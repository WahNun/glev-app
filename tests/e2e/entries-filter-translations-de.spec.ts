// Task #617 — Playwright coverage that the filter-sheet section headings
// and date-range chip on /entries render in German when locale=de.
//
// Why this exists:
//   A previous task (referenced in the chips namespace) translated the
//   filter-section labels (`filter_section_entry_type`,
//   `filter_section_meal_kind`, `filter_section_exercise_kind`,
//   `filter_section_outcome`) and the date-range option labels
//   (`date_range_7d` etc.) in `messages/de.json`. Without an e2e test
//   those keys can silently regress in three ways:
//     a) A future refactor renames the key (e.g. `filter_section_entry_type`
//        → `filter_entry_type`) and the dialog falls back to the raw key
//        string or English.
//     b) The `tChips` call inside FilterSection or dateRangeOptions is
//        accidentally replaced with a hardcoded English string.
//     c) The locale cookie/profile reconciliation path breaks so the page
//        renders in English even when the user's language is "de".
//
// What this asserts (and why each piece matters):
//   1. With locale pinned to "de", the filter dialog shows the four section
//      headings in German ("Eintragstyp", "Mahlzeitentyp", "Trainingsart",
//      "Ergebnis") and NOT their English counterparts ("Entry type",
//      "Meal kind", "Exercise kind", "Outcome"). This catches regressions
//      in the `tChips("filter_section_*")` call path inside FilterSection.
//   2. Selecting the "Letzte 7 Tage" (7-day) date range and then closing
//      the dialog produces an active chip labelled "Letzte 7 Tage" — not
//      "Last 7 days". This covers both halves of the date-range
//      translation: the radio label inside the dialog (rendered via
//      `dateRangeOptions` memo → `tChips("date_range_7d")`) and the
//      chip summary text (rendered via `tDateRangeSummary` →
//      `tChips("date_range_7d")`).
//
// Pattern follows entries-chips-de.spec.ts: pin locale on both surfaces
// the server reads (NEXT_LOCALE cookie) AND `profiles.language` (which
// LanguageSync reconciles on every navigation).

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "entries-filter-translations-de spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const LOCALE_COOKIE = "NEXT_LOCALE";

async function pinDeLocale(context: BrowserContext, baseURL: string) {
  await context.clearCookies();
  await context.addCookies([{
    name: LOCALE_COOKIE,
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
}

async function setProfileLanguage(userId: string, language: "de" | "en") {
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ language })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.language set failed: ${error.message}`);
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

test.describe("Entries → filter-sheet translations render in German (Task #617)", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await pinDeLocale(context, baseURL!);
    await setProfileLanguage(testUser.userId, "de");
  });

  test.afterEach(async ({ context, baseURL }) => {
    // Restore the suite-wide DE baseline so other specs are unaffected.
    await pinDeLocale(context, baseURL!);
    await setProfileLanguage(testUser.userId, "de");
  });

  test("filter dialog section headings render in German and English headings do not leak", async ({ page }) => {
    await loginAsTestUser(page);

    // Sanity: locale cookie must survive the login navigation.
    const cookies = await page.context().cookies();
    const localeCookie = cookies.find((c) => c.name === LOCALE_COOKIE);
    expect(localeCookie?.value, "NEXT_LOCALE cookie must be 'de' after login").toBe("de");

    await page.goto("/entries");
    // Clear any persisted filter state so the dialog opens in a clean state.
    await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
    await page.reload();

    // Open the filter sheet. The trigger label is hardcoded "Filters" (EN)
    // in the source — intentionally not translated (product decision).
    const filtersBtn = page.getByRole("button", { name: /^Filters$/ });
    await expect(filtersBtn).toBeVisible({ timeout: 20_000 });
    await filtersBtn.click();

    // The dialog aria-label is also hardcoded in English; this is fine
    // because it is an accessibility identifier, not user-visible copy.
    const dialog = page.getByRole("dialog", { name: /Filter entries/i });
    await expect(dialog).toBeVisible();

    // ---- GERMAN SECTION HEADINGS PRESENT ----------------------------
    // FilterSection and DateRangeSection both render their `title` prop
    // inside a plain <div>. Use exact matching to avoid false positives
    // from option labels that contain the heading word (e.g. "Ergebnis"
    // also appears as an option label in some contexts).
    const germanHeadings = [
      "Zeitraum",      // filter_section_date_range  (DateRangeSection title)
      "Eintragstyp",   // filter_section_entry_type
      "Mahlzeitentyp", // filter_section_meal_kind
      "Trainingsart",  // filter_section_exercise_kind
      "Ergebnis",      // filter_section_outcome
    ];
    for (const heading of germanHeadings) {
      await expect(
        dialog.getByText(heading, { exact: true }),
        `German section heading "${heading}" must be visible in the filter dialog`,
      ).toBeVisible();
    }

    // ---- ENGLISH SECTION HEADINGS MUST NOT LEAK ---------------------
    // If any i18n key resolves to its English fallback the wrong string
    // appears — these assertions catch that regression.
    const englishHeadings = ["Date range", "Entry type", "Meal kind", "Exercise kind", "Outcome"];
    for (const heading of englishHeadings) {
      await expect(
        dialog.getByText(heading, { exact: true }),
        `English section heading "${heading}" must not appear when locale=de`,
      ).toHaveCount(0);
    }
  });

  test("active date-range chip shows 'Letzte 7 Tage' instead of 'Last 7 days' in German locale", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/entries");
    await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
    await page.reload();

    // Open filter dialog and select the 7-day range.
    // `dateRangeOptions` (a locale-aware memo) translates "Last 7 days"
    // → "Letzte 7 Tage" via `tChips("date_range_7d")`, so the radio
    // button inside the dialog carries the German label.
    const filtersBtn = page.getByRole("button", { name: /^Filters$/ });
    await expect(filtersBtn).toBeVisible({ timeout: 20_000 });
    await filtersBtn.click();

    const dialog = page.getByRole("dialog", { name: /Filter entries/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("radio", { name: "Letzte 7 Tage", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The active-filter chip label comes from `tDateRangeSummary("7d", …)`
    // → `tChips("date_range_7d")` → "Letzte 7 Tage" in DE.
    // Aria-label format mirrors the multi-select chips ("Remove filter: <label>").
    const dateChip = page.getByRole("button", { name: "Remove filter: Letzte 7 Tage" });
    await expect(
      dateChip,
      'Active date chip must read "Letzte 7 Tage" when locale=de',
    ).toBeVisible();

    // The English label must not appear anywhere in the active-chip area.
    await expect(
      page.getByRole("button", { name: "Remove filter: Last 7 days" }),
      '"Last 7 days" chip must not render when locale=de',
    ).toHaveCount(0);
  });
});
