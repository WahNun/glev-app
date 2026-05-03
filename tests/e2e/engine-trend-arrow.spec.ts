// End-to-end coverage for the pre-meal Trend Arrow on the engine page
// (Task #210, follow-up to Task #204 which introduced the arrow).
//
// Why this exists:
//   The TrendArrow component on /engine renders a small ↑/↗/→/↘/↓ glyph
//   next to the "Glukose vor Mahlzeit" label, driven by classified CGM
//   samples in the 15 min before the active meal time. The classifier
//   itself (lib/engine/trend.ts) has unit coverage, but the *render*
//   path — mapping a TrendClass to its glyph + color, hiding the arrow
//   when no samples are cached, and swapping the tooltip to the active
//   locale's `engine_rec_trend_<class>` string — was previously
//   uncovered. This is exactly the kind of regression that's easy to
//   miss because the arrow is small, conditional, and lives inside
//   Step 2 of the wizard.
//
// What this asserts:
//   1. Seeded "rising_fast" samples → the arrow renders with
//      `data-testid="engine-trend-arrow-rising_fast"` and the locale's
//      `engine_rec_trend_rising_fast` text as both `title` and
//      `aria-label`. Verified for BOTH the German and English bundles
//      so a missing translation key would surface immediately.
//   2. An empty CGM history response → the arrow does NOT render at
//      all (no `[data-testid^="engine-trend-arrow-"]` element in the
//      DOM). Guards against an "always-render-stable" regression.
//
// We mock /api/cgm/history (and the related /api/cgm/glucose latest-
// reading probe) at the network layer via `page.route`. Seeding the
// real Supabase tables would require pinning a CGM source on the test
// user's profile + writing into source-specific tables (LLU cache /
// nightscout_readings / apple_health_readings) which the dispatcher
// chooses non-deterministically — far more brittle than intercepting
// the single endpoint the page actually consumes.
//
// We drive the wizard from Step 1 → Step 2 via the chat path: a mocked
// /api/chat-macros call returns populated macros, which makes the
// "Weiter zu Makros prüfen" button appear and lands the user on the
// macros card where the TrendArrow lives.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
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

/**
 * Pre-seed the NEXT_LOCALE cookie BEFORE any navigation so the very
 * first server-rendered HTML already speaks the requested language.
 * Mirrors the pattern in language-picker.spec.ts. Path "/" + same-site
 * "Lax" matches what `lib/locale.ts:writeLocaleCookie` writes in
 * production so a future cookie-attribute drift would also fail any
 * test that relies on this helper.
 */
async function setLocaleCookie(context: BrowserContext, locale: "de" | "en") {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: locale,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
}

/**
 * Build N synthetic CGM samples on a linear ramp anchored to "now".
 * Returns the same `{ value, timestamp }` shape `/api/cgm/history`
 * emits and `lib/engine/trend.classifyPreReferenceTrend` consumes.
 *
 * Spread strictly INSIDE the 15 min pre-reference window:
 *   sample i sits at  (now − 14 + i*step) minutes,  i = 0..N−1
 * with `step = 14 / (N−1)` so the oldest sample is 14 min ago and the
 * newest is right at "now − 0.x min". Five samples → step ≈ 3.5 min,
 * matching the Libre 1/min sampling cadence the trend window targets.
 */
function rampSamples(startMgDl: number, slopeMgPerMin: number, count = 5): Array<{ value: number; timestamp: string }> {
  const now = Date.now();
  const stepMin = 14 / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const minutesAgo = 14 - i * stepMin;
    const t = new Date(now - minutesAgo * 60_000);
    return {
      value: Math.round(startMgDl + slopeMgPerMin * (i * stepMin) * 10) / 10,
      timestamp: t.toISOString(),
    };
  });
}

/**
 * Wire up the network mocks the engine page hits on mount + when the
 * user types in the chat panel. Returns nothing — installs the routes
 * on the supplied page.
 *
 *  - /api/cgm/history    → seeded `history` payload (or empty list).
 *  - /api/cgm/glucose    → "not connected" so the glucose autofill
 *                          effect is a no-op (it would otherwise
 *                          attempt LLU credentials and 4xx noisily).
 *  - /api/chat-macros    → a deterministic macros payload that lets
 *                          us advance the wizard to Step 2.
 */
async function installEngineMocks(
  page: Page,
  history: Array<{ value: number; timestamp: string }>,
) {
  await page.route("**/api/cgm/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        current: history.length > 0 ? history[history.length - 1] : null,
        history,
        source: "llu",
      }),
    });
  });
  await page.route("**/api/cgm/glucose", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false, glucose: null }),
    });
  });
  await page.route("**/api/chat-macros", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Got it — 50 g carbs.",
        nutritionSource: "estimated",
        macros: { carbs: 50, protein: 10, fat: 5, fiber: 3, calories: 0 },
        description: "test meal",
        items: [],
      }),
    });
  });
}

/**
 * Drive the chat panel from Step 1 → Step 2 by typing a placeholder
 * message and clicking Send (which hits the mocked /api/chat-macros).
 * Once the patch lands the "Weiter zu Makros prüfen" CTA appears; we
 * click it and wait for the Step-2 macros card to mount.
 */
async function advanceToMacrosStep(page: Page) {
  // The chat input is the only text input on Step 1. Use a CSS
  // attribute selector on placeholder so the test stays locale-
  // agnostic (the placeholder copy differs per language but is
  // always set to a single string by t("chat_placeholder")).
  const chatInput = page.locator('input[placeholder]').first();
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await chatInput.fill("test meal");
  // The Send button is the only enabled, type=button button next to
  // the chat input row; targeting by name covers both DE and EN.
  await page.getByRole("button", { name: /^(Send|Senden)$/i }).click();
  // Once the mocked patch lands, the wizard exposes the Weiter CTA.
  // The accessible name comes from aria-label (`btn_advance_to_macros_aria`),
  // not the visible button text — match the aria-label copy in both
  // locales so the locator finds the CTA regardless of language.
  const advanceBtn = page.getByRole("button", { name: /(Continue to step 2|Weiter zu Schritt 2)/i });
  await expect(advanceBtn).toBeVisible({ timeout: 15_000 });
  await advanceBtn.click();
}

// Localized tooltip text for `rising_fast`. Pulled from messages/<locale>.json:366
// — kept inline so a regression in the message file (rename / delete /
// punctuation drift) trips this test before it reaches users. The
// strings are matched as substrings to keep the test resilient to
// future copy tweaks while still catching wholesale rewording.
const RISING_FAST_FRAGMENT: Record<"de" | "en", RegExp> = {
  de: /Glukose steigt schnell/,
  en: /glucose rising fast/,
};

test.describe("Engine TrendArrow render path", () => {
  for (const locale of ["de", "en"] as const) {
    test(`renders the rising_fast arrow with the ${locale.toUpperCase()} tooltip`, async ({ page, context }) => {
      await setLocaleCookie(context, locale);
      // Slope of +2 mg/dL/min comfortably crosses the 1.5 fast-rise
      // threshold (lib/engine/trend.ts:34) so the classifier returns
      // "rising_fast" without flapping at the boundary.
      await installEngineMocks(page, rampSamples(110, 2));
      await loginAsTestUser(page);
      await page.goto("/engine");

      await advanceToMacrosStep(page);

      const arrow = page.locator('[data-testid="engine-trend-arrow-rising_fast"]');
      await expect(arrow).toBeVisible({ timeout: 15_000 });

      // Tooltip parity: the localized engine_rec_trend_rising_fast
      // string drives BOTH `title` (mouse hover) and `aria-label`
      // (assistive tech). Asserting on both pins down the contract.
      const titleAttr = await arrow.getAttribute("title");
      const ariaAttr  = await arrow.getAttribute("aria-label");
      expect(titleAttr ?? "").toMatch(RISING_FAST_FRAGMENT[locale]);
      expect(ariaAttr  ?? "").toMatch(RISING_FAST_FRAGMENT[locale]);
      // The arrow glyph itself is the visible affordance — make sure
      // it actually rendered text content, not just an empty span.
      await expect(arrow).toHaveText("↑");
    });
  }

  test("hides the arrow when no CGM samples are available", async ({ page, context }) => {
    await setLocaleCookie(context, "en");
    // Empty history → currentTrend === undefined → conditional in
    // page.tsx:2130 short-circuits and TrendArrow is not mounted.
    await installEngineMocks(page, []);
    await loginAsTestUser(page);
    await page.goto("/engine");

    await advanceToMacrosStep(page);

    // Make sure the macros section actually rendered before asserting
    // absence — otherwise we'd be passing for the wrong reason (Step 2
    // never mounted at all). The "Glukose & Zeit" / "Glucose & time"
    // section header sits right above where the arrow would render.
    const glucoseLabel = page.getByText(/Glukose vorher|Glucose before/i).first();
    await expect(glucoseLabel).toBeVisible({ timeout: 15_000 });

    // No arrow of any class should be present.
    const anyArrow = page.locator('[data-testid^="engine-trend-arrow-"]');
    await expect(anyArrow).toHaveCount(0);
  });
});
