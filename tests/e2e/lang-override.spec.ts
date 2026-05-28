// Regression coverage for the `?lang=` URL override on marketing pages
// (Task #182, implemented in Task #179).
//
// The middleware reads `?lang=de` / `?lang=en` on LANG_OVERRIDE_PATHS and
// forwards the chosen locale to the next-intl request config via the
// `x-glev-locale-override` request header. The request config honours that
// header at highest precedence — above NEXT_LOCALE cookie, geo-IP country,
// and Accept-Language.
//
// What this file asserts for /pro × {de, en} and /beta × {de, en}:
//   1. `<html lang>` matches the ?lang= value, NOT Accept-Language.
//   2. A locale-unique string in the Hero section is visible, confirming that
//      the server-rendered content also matches.
//   3. The test uses an Accept-Language that disagrees with ?lang= so a
//      regression (i.e. Accept-Language winning over the URL override) would
//      flip both assertions and cause the test to fail.
//
// Cookie state: we wipe NEXT_LOCALE before each test to eliminate any
// cookie-driven locale from previous test runs bleeding into this spec.

import { expect, test } from "@playwright/test";

// Locale-unique hero marker strings taken from messages/de.json and
// messages/en.json (previewPro / previewBeta namespaces). These must
// appear somewhere in the visible hero section after SSR.
const MARKERS = {
  pro: {
    de: "Preis sichern",    // previewPro.hero_title (DE only)
    en: "Lock in your price", // previewPro.hero_title (EN only)
  },
  beta: {
    // previewBeta.hero_title is identical in DE and EN, so we use
    // hero_subtitle which differs.
    de: "Jetzt kostenlos sichern",  // previewBeta.hero_subtitle (DE)
    en: "Sign up free now",          // previewBeta.hero_subtitle (EN)
  },
} as const;

type Page = "pro" | "beta";
type Locale = "de" | "en";

// Build the four test cases: page × locale, with the opposite Accept-Language
// header so the URL override must win to get the right result.
const CASES: Array<{ page: Page; lang: Locale; acceptLanguage: string }> = [
  { page: "pro",  lang: "de", acceptLanguage: "en-US,en;q=0.9" },
  { page: "pro",  lang: "en", acceptLanguage: "de-DE,de;q=0.9" },
  { page: "beta", lang: "de", acceptLanguage: "en-US,en;q=0.9" },
  { page: "beta", lang: "en", acceptLanguage: "de-DE,de;q=0.9" },
];

test.describe("?lang= URL override on /pro and /beta", () => {
  for (const { page, lang, acceptLanguage } of CASES) {
    const opposite = lang === "de" ? "en" : "de";

    test(`/${page}?lang=${lang} renders ${lang} even with Accept-Language: ${opposite}`, async ({
      context,
      baseURL,
    }) => {
      // Wipe any NEXT_LOCALE cookie so cookie-precedence cannot mask a
      // regression where the URL override stops working.
      await context.clearCookies();

      // Force Accept-Language to the locale OPPOSITE to ?lang= so a
      // regression (Accept-Language winning) produces the wrong locale.
      await context.setExtraHTTPHeaders({ "accept-language": acceptLanguage });

      const p = await context.newPage();
      await p.goto(`/${page}?lang=${lang}`);

      // 1. <html lang> must match the ?lang= value.
      const htmlLang = await p.locator("html").getAttribute("lang");
      expect(htmlLang, `html[lang] on /${page}?lang=${lang}`).toBe(lang);

      // 2. A locale-unique marker string must be visible in the page body.
      const marker = MARKERS[page][lang];
      await expect(
        p.getByText(marker, { exact: false }).first(),
        `hero marker "${marker}" visible on /${page}?lang=${lang}`,
      ).toBeVisible();

      // Cleanup: remove the extra header override for subsequent tests.
      await context.setExtraHTTPHeaders({});
    });
  }
});
