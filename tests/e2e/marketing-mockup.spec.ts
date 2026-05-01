// End-to-end visual coverage for the marketing demo phone (AppMockupPhone).
//
// Why this test exists:
// The hero mockup on the public marketing pages (`/`) is one of the
// highest-leverage surfaces — visitors decide whether to sign up
// partly based on how the phone "looks like an app". A regression
// that breaks one of the five screens (wrong copy, missing label,
// broken sub-toggle) currently goes undetected until someone
// manually opens the page. We turn the manual screenshot pass into
// an automated check.
//
// What we cover:
//
//   1. The interactive phone on `/` (no `lockTab`). We walk the
//      bottom nav in the same order a curious visitor would —
//      Dashboard → Glev step 1 → step 2 → step 3 → Verlauf
//      (Insights default) → Verlauf (Einträge sub-toggle) →
//      Einstellungen — and assert at least one stable German
//      label per screen so a regression in any single screen
//      surfaces as a focused failure.
//
//   2. The locked-tab variants used by FeatureLiveMockup at mobile
//      viewport (≤720px). FeatureDeepDive renders four locked
//      phones, one per feature row (engine, entries, dashboard,
//      insights). We force a mobile viewport so the responsive
//      switch in FeatureLiveMockup picks the phone branch instead
//      of the desktop iframe, then verify each locked phone
//      renders its target screen and hides the bottom nav.
//
// We pin selectors to `data-testid="app-mockup-phone"` so the
// test is robust against marketing copy/layout shuffles around
// the phone — only the phone's own DOM is asserted against.

import { expect, test, type Locator, type Page } from "@playwright/test";

const PHONE = '[data-testid="app-mockup-phone"]';

/** Bottom-nav buttons render as <button> with an UPPERCASE label
 *  ("DASHBOARD", "GLEV", "VERLAUF", "EINSTELLUNGEN"). The same
 *  uppercase form is the accessible name, so we can target each
 *  via getByRole. Using uppercase (instead of e.g. "Einstellungen")
 *  also disambiguates from the Settings screen <h1> and the row
 *  labels inside it. */
const NAV = {
  dashboard: "DASHBOARD",
  glev: "GLEV",
  verlauf: "VERLAUF",
  settings: "EINSTELLUNGEN",
} as const;

async function expectAllVisible(scope: Locator, texts: (string | RegExp)[]) {
  for (const t of texts) {
    await expect(scope.getByText(t).first()).toBeVisible();
  }
}

/** Matches a bottom-nav button by its UPPERCASE visible label.
 *
 *  We can't simply use `getByRole("button", { name: label })`:
 *
 *   • The GLEV nav button wraps an inline `<svg aria-label="Glev">`
 *     next to its `<span>GLEV</span>`, so its computed accessible
 *     name is "Glev GLEV" — neither exact `"GLEV"` nor exact
 *     `"Glev GLEV"` is stable copy to assert on.
 *
 *   • The cog button in the top-right header has aria-label
 *     "Einstellungen öffnen", and Playwright's role-name match is
 *     case-insensitive substring, so a non-exact `"EINSTELLUNGEN"`
 *     filter also matches the cog.
 *
 *  Filtering `<button>` elements by visible text content sidesteps
 *  both: the cog has no text content, and the GLEV button's text
 *  content is exactly "GLEV". */
function navButton(scope: Locator, label: string) {
  return scope.locator("button").filter({ hasText: label });
}

async function gotoHomeAndFindPhone(page: Page): Promise<Locator> {
  // Use "domcontentloaded" instead of the default "load" — at desktop
  // viewport, FeatureDeepDive mounts four `<iframe src=…/mockups/…>`
  // children and the full `load` event waits for every iframe's
  // resources to settle, which routinely takes >60s on Replit.
  // The hero phone is rendered server-side and is already visible
  // by the time the document is parsed.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const phone = page.locator(PHONE).first();
  await expect(phone).toBeVisible();
  return phone;
}

test.describe("Marketing AppMockupPhone — interactive bottom nav", () => {
  test("walks Dashboard → Glev (1/2/3) → Verlauf (Insights/Einträge) → Einstellungen", async ({ page }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // ── Dashboard (initial tab) ──────────────────────────────────────
    // Live glucose hero, Heutige Makros, Control Score, the three
    // rate tiles (Treffer-/Spike-/Hypo-Quote), and the recent log
    // ("Aktuell"). One label per card so a single broken card pins
    // the failure cleanly.
    await expectAllVisible(phone, [
      /Glucose · live/,
      /Heutige Makros/,
      /Control Score · 7T/,
      /Treffer-Quote/,
      /Spike-Quote/,
      /Hypo-Quote/,
      /Aktuell/,
      /Mahlzeit loggen/,
    ]);

    // ── Glev Engine — Step 1 (Essen) ─────────────────────────────────
    await navButton(phone, NAV.glev).click();
    await expectAllVisible(phone, [
      /Glev Engine/,
      /1 · Essen/,
      /2 · Makros/,
      /3 · Ergebnis/,
      /TIPPEN ZUM SPRECHEN/,
      /Aktueller Glukosewert/,
    ]);

    // ── Step 2 (Makros) — reachable via "Stattdessen tippen →" ───────
    // Tap the manual fallback so step 2 hydrates without sitting
    // through the 2.6s mic→parse animation.
    await phone.getByRole("button", { name: /Stattdessen tippen/ }).click();
    await expectAllVisible(phone, [
      /Makros prüfen/,
      /Quelle · Datenbank/,
      /Kohlenhydrate/,
      /Ballaststoffe/,
      /Klassifizierung/,
    ]);
    await expect(phone.getByRole("button", { name: /Bolus berechnen/ })).toBeVisible();

    // ── Step 3 (Ergebnis) — reachable via "Bolus berechnen →" ────────
    await phone.getByRole("button", { name: /Bolus berechnen/ }).click();
    await expectAllVisible(phone, [
      /Deine Einschätzung/,
      /Empfohlene Dosis/,
      /Begründung/,
      /Konfidenz/,
    ]);
    // Confirmation CTA is present but we don't tap it — it triggers
    // a tab switch to "entries" via setTimeout, which we'd just have
    // to undo before the next assertion.
    await expect(phone.getByRole("button", { name: /Bestätigen & Speichern/ })).toBeVisible();

    // ── Verlauf · Insights (default sub-tab) ─────────────────────────
    // Tapping the Verlauf nav button always lands on Insights first,
    // matching the real /history route default.
    await navButton(phone, NAV.verlauf).click();
    await expectAllVisible(phone, [
      /Time in Range · 7T/,
      /Ø Glukose/,
      /GMI · gesch\. A1c/,
      /7-Tage-Trend/,
      /Mahlzeiten-Bewertung · 7T/,
    ]);

    // ── Verlauf · Einträge (sub-toggle) ──────────────────────────────
    await phone.getByRole("button", { name: "Einträge" }).click();
    await expectAllVisible(phone, [
      /Klicke eine Zeile zum Aufklappen/,
      /Filters · 2/,
      /Suchen…/,
      /Haferflocken/,
      /Chicken Bowl/,
      /Linsencurry/,
      /Gestern/,
    ]);

    // ── Einstellungen ────────────────────────────────────────────────
    await navButton(phone, NAV.settings).click();
    await expectAllVisible(phone, [
      /^Sprache$/,
      /CGM Verbindung/,
      /^Insulin$/,
      /Makro-Ziele/,
      /Benachrichtigungen/,
      /Erscheinungsbild/,
      /^Konto$/,
    ]);
  });
});

test.describe("Marketing AppMockupPhone — locked-tab variants on mobile", () => {
  test("FeatureDeepDive renders one locked phone per feature row", async ({ page }) => {
    // Force a mobile viewport so FeatureLiveMockup's matchMedia
    // resolves to the "mobile" branch and mounts <AppMockupPhone
    // lockTab=…> instead of the desktop iframe.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // The marketing page mounts:
    //   • 1 hero phone (no lockTab)             → index 0
    //   • 4 FeatureDeepDive phones, in order:
    //       voice    → engine                   → index 1
    //       macro    → entries                  → index 2
    //       cgm      → dashboard                → index 3
    //       insights → insights                 → index 4
    // Wait for all five to mount before reaching past the hero —
    // FeatureLiveMockup hydrates lazily after a useEffect tick.
    const phones = page.locator(PHONE);
    await expect(phones).toHaveCount(5, { timeout: 30_000 });

    const lockedEngine    = phones.nth(1);
    const lockedEntries   = phones.nth(2);
    const lockedDashboard = phones.nth(3);
    const lockedInsights  = phones.nth(4);

    // Locked phones must NOT show the bottom nav — that's the
    // contract FeatureLiveMockup relies on so each card focuses
    // on a single screen with no escape hatch.
    for (const p of [lockedEngine, lockedEntries, lockedDashboard, lockedInsights]) {
      await p.scrollIntoViewIfNeeded();
      await expect(navButton(p, NAV.dashboard)).toHaveCount(0);
      await expect(navButton(p, NAV.glev)).toHaveCount(0);
      await expect(navButton(p, NAV.verlauf)).toHaveCount(0);
      await expect(navButton(p, NAV.settings)).toHaveCount(0);
    }

    // Locked engine phone — Glev Engine wizard, step 1 by default.
    await lockedEngine.scrollIntoViewIfNeeded();
    await expectAllVisible(lockedEngine, [
      /Glev Engine/,
      /TIPPEN ZUM SPRECHEN/,
      /Aktueller Glukosewert/,
    ]);

    // Locked entries phone — chronological log. Sub-toggle is
    // hidden when locked, so "Insights" must NOT appear here.
    await lockedEntries.scrollIntoViewIfNeeded();
    await expectAllVisible(lockedEntries, [
      /Klicke eine Zeile zum Aufklappen/,
      /Filters · 2/,
      /Haferflocken/,
    ]);
    await expect(lockedEntries.getByRole("button", { name: "Insights" })).toHaveCount(0);

    // Locked dashboard phone — live glucose hero + Heutige Makros.
    await lockedDashboard.scrollIntoViewIfNeeded();
    await expectAllVisible(lockedDashboard, [
      /Glucose · live/,
      /Heutige Makros/,
      /Control Score · 7T/,
    ]);

    // Locked insights phone — Time in Range + trend cards. Same
    // sub-toggle invariant as entries.
    await lockedInsights.scrollIntoViewIfNeeded();
    await expectAllVisible(lockedInsights, [
      /Time in Range · 7T/,
      /7-Tage-Trend/,
      /Mahlzeiten-Bewertung · 7T/,
    ]);
    await expect(lockedInsights.getByRole("button", { name: "Einträge" })).toHaveCount(0);
  });
});
