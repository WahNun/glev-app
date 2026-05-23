// Regression guard for overflow-prone small-text elements on the marketing phone.
//
// Why this file exists:
//   Task #566 caught a silent clip regression on the three RateTile chip tiles
//   (Good Rate / Spike Rate / Hypo Rate). Task #567 added automated checks for
//   those. Task #572 extended coverage to other small-text areas that carry the
//   same overflow risk: MacroRing labels in the daily-macros card and row labels
//   in the Settings screen. All of these elements use whiteSpace:nowrap +
//   overflow:hidden + textOverflow:ellipsis — exactly the pattern that clips
//   text silently when a container is too narrow.
//   Task #577 identified that the Insights screen (BottomNav "INSIGHTS" tab)
//   also renders small-text elements — swipe-pager card titles (fontSize:9),
//   meal-evaluation row labels (fixed width:72, fontSize:10), and TIR legend
//   spans (fontSize:8) — inside fixed-width containers with the same silent-clip
//   risk. Tasks #575 and #578 implemented the resulting describe blocks below
//   (PART 5 card-label tests and PART 5 TIR-legend tests respectively).
//   Task #579 adds coverage for the stacked progress bar in the TIR card. The
//   bar container (height:12, borderRadius:99) holds four coloured segment divs
//   with percentage-based widths (2% / 6% / 78% / 14%). A layout regression on
//   the parent MockCard could collapse the bar to zero height or cause the
//   segments to overflow without any existing guard catching it.
//
// What we cover:
//   PART 1 — RateTile chip tiles (original Task #567 coverage)
//     1. All three RateTile chip tiles render visibly on the Dashboard screen
//        in both the DE and EN marketing phone variants.
//     2. The label div of every tile does NOT overflow its container —
//        `scrollWidth <= offsetWidth` is the browser-level invariant broken
//        when `overflow:hidden` + `whiteSpace:nowrap` clips inline text.
//     3. Neither the label nor the sub-text div contains a Unicode ellipsis
//        ("…" / "..."), confirming `textOverflow:ellipsis` is NOT actively
//        truncating readable copy.
//     4. The full expected text is present with no characters swallowed.
//
//   PART 2 — MacroRing labels (Task #572)
//     The daily-macros card on the Dashboard renders four ring widgets:
//     Carbs / Protein / Fat (FETT in DE) / Fiber. Each label div uses the
//     same nowrap+ellipsis pattern. The DE label "FETT" and EN label "FAT"
//     differ in length — both are tested so locale-specific regressions are
//     caught.
//
//   PART 3 — Settings row labels (Task #572)
//     The Settings screen row labels ("Benachrichtigungen", "Erscheinungsbild",
//     "CGM Verbindung" in DE; "Notifications", "CGM Connection", "Macro Targets"
//     in EN) also use nowrap+ellipsis. We cover the longest label per locale.
//
//   PART 4 — Engine step-pill labels (Task #574)
//     The Engine screen renders three step-pill buttons at the top of the
//     3-step wizard. Each pill carries a numeric prefix and a translated label
//     (e.g. "1 · Food", "2 · Macros", "3 · Result" in EN). The pills sit inside
//     a 3-column grid with small fixed-width cells and font-size 9.5 px —
//     the same silent-clipping risk as RateTile labels. DE uses "1 · Essen",
//     "2 · Makros", "3 · Ergebnis"; "Ergebnis" is longer than "Result" and is
//     the most likely to overflow.
//
//   PART 5 — Insights screen card labels and TIR legend spans (Tasks #575, #578)
//     The Insights screen contains CardLabel texts (card headers at fontSize:9)
//     and meal-evaluation row labels inside a fixed width:72 container. Both
//     groups are locale-translated and at overflow risk:
//       DE card headers: "Time in Range · 7T", "Ø Glukose", "GMI · gesch. A1c",
//                        "7-Tage-Trend", "Ø pro Tag", "Mahlzeiten-Bewertung · 7T"
//       EN card headers: "Time in Range · 7d", "Avg. glucose", "GMI · est. A1c",
//                        "7-day trend", "Avg. / day", "Meal rating · 7d"
//       DE row labels:   "Im Ziel", "Spike", "Hypo-Risiko"
//       EN row labels:   "In range", "Spike", "Hypo risk"
//     The TIR card also renders four coloured legend <span> elements at
//     fontSize:8 in a space-between flex row (Task #578):
//       DE: "● Sehr tief 2%", "● Tief 6%", "● Im Ziel 78%", "● Hoch 14%"
//       EN: "● Very low 2%",  "● Low 6%",  "● In range 78%","● High 14%"
//
//   PART 6 — TIR stacked bar segments (Task #579)
//     The TIR card contains a stacked progress bar (data-testid="tir-stacked-bar")
//     at height:12. It holds four coloured child divs with percentage-based widths:
//       2% (very low / very low), 6% (low / low), 78% (in-range), 14% (high).
//     A CSS regression (e.g. parent MockCard layout change) could collapse the bar
//     to zero height or cause segments to overflow the container silently.
//     Checks per locale (DE and EN — same bar, locale-neutral):
//       • The bar container is visible and has offsetHeight > 0
//       • Each of the four segment divs has offsetWidth > 0
//       • The bar container does not overflow its parent (scrollWidth ≤ offsetWidth)
//
//   PART 7 — Engine Step 3 result-cell labels and disclaimer (Task #601)
//     After clicking "3 · Ergebnis" / "3 · Result" pill on the Engine screen, the
//     result view renders a 3-column breakdown grid (fontSize:7.5, padding 4–6 px)
//     and a disclaimer footer with a bold label rendered via <strong>. Neither has
//     an explicit overflow guard.
//     Checks per locale (DE + EN):
//       • Cell labels ("Carb", "Korrektur"/"Correction", "Gesamt"/"Total") are
//         visible, scrollWidth ≤ offsetWidth, no ellipsis.
//       • Disclaimer bold label ("Wichtig:" / "Important:") is visible and not
//         overflowing.
//
// Structure:
//   Eighteen `test.describe` blocks — two per part (DE + EN each) — so regressions
//   are pinpointed to the affected locale and element group.
//   (PART 5 uses four describe blocks — card headers and meal-row labels tested
//   separately per locale — and PART 5 TIR legend adds two more, giving 6 for PART 5.)
//
//   PART 7 — Engine Step 3 result-cell labels and disclaimer (Task #601)
//     After navigating to the Engine screen and clicking the "3 · Ergebnis" /
//     "3 · Result" step pill, the result view renders a 3-column breakdown grid
//     (fontSize:7.5, no explicit overflow guard) and a disclaimer footer whose
//     bold label uses `<strong>` (also at risk of clip in narrow containers).
//     Covered per locale (DE + EN):
//       DE cell labels: "Carb", "Korrektur", "Gesamt"
//       EN cell labels: "Carb", "Correction", "Total"
//       Disclaimer label: "Wichtig:" (DE) / "Important:" (EN)
//     Each element: visible, scrollWidth ≤ offsetWidth, no ellipsis.
//
// Selector strategy:
//   Elements are targeted by exact visible text content. Nav buttons in the
//   BottomNav are clicked by their uppercased label text to switch screens.

import { expect, test, type Locator, type Page } from "@playwright/test";

const PHONE = '[data-testid="app-mockup-phone"]';

// The label strings as they appear in the DOM (before CSS text-transform:
// uppercase makes them visually "GOOD RATE" etc.). Identical in both locales.
const RATE_LABELS = ["Good Rate", "Spike Rate", "Hypo Rate"] as const;

async function gotoHomeAndFindPhone(page: Page): Promise<Locator> {
  // Use "domcontentloaded" for speed — the hero phone is server-side rendered
  // and already in the DOM before iframes and deferred assets finish loading.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const phone = page.locator(PHONE).first();
  await expect(phone).toBeVisible();
  return phone;
}

/** Assert that an element's text is not clipped by overflow or ellipsis. */
async function assertNoOverflow(
  el: Locator,
  description: string,
): Promise<void> {
  // 1. scrollWidth must not exceed offsetWidth.
  //    When overflow:hidden + whiteSpace:nowrap clip the text, the browser
  //    still tracks the true text width in scrollWidth, so this comparison
  //    reliably catches silent truncation.
  const isOverflowing = await el.evaluate(
    (node) => node.scrollWidth > node.offsetWidth,
  );
  expect(
    isOverflowing,
    `${description} overflows its tile container (scrollWidth > offsetWidth) — ` +
      `check for whiteSpace:nowrap / overflow:hidden / a font-size increase on the element`,
  ).toBe(false);

  // 2. No ellipsis character — a second-layer guard in case JS appends "…".
  const text = (await el.textContent()) ?? "";
  expect(
    text.includes("…") || text.includes("..."),
    `${description} text contains an ellipsis ("${text}") — ` +
      `textOverflow:ellipsis is actively truncating the copy`,
  ).toBe(false);
}

// ──────────────────────────────────────────────────────────────────────────────
// DE locale
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Marketing phone RateTile chip tiles — DE locale", () => {
  // Pin to German so the dashboard namespace (good_sub / spike_sub /
  // hypo_sub) renders German copy. The label strings are locale-neutral but
  // the sub-text strings differ between locales.
  test.use({ locale: "de-DE" });

  // DE sub-text values as rendered by tDash("good_sub", { n: 14 }),
  // tDash("spike_sub"), tDash("hypo_sub") from messages/de.json.
  const DE_SUBS = ["14 gut", "Hyperglykämie", "Hypoglykämie"] as const;

  test("all three RateTiles are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Dashboard is the default tab — no nav click needed.
    // Anchor on one rate label so we don't run overflow checks on a
    // partially-hydrated frame.
    await expect(phone.getByText(/Good Rate/)).toBeVisible();

    // ── Label divs ────────────────────────────────────────────────────
    for (const label of RATE_LABELS) {
      // exact:true avoids matching a parent div whose textContent
      // includes the label along with the value and sub strings.
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `RateTile label "${label}" (DE)`);

      // Full text round-trip — no characters swallowed.
      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim().toLowerCase()).toBe(label.toLowerCase());
    }

    // ── Sub-text divs ─────────────────────────────────────────────────
    for (const sub of DE_SUBS) {
      const subEl = phone.getByText(sub, { exact: true }).first();
      await expect(subEl).toBeVisible();
      await assertNoOverflow(subEl, `RateTile sub "${sub}" (DE)`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// EN locale
// ──────────────────────────────────────────────────────────────────────────────

test.describe("Marketing phone RateTile chip tiles — EN locale", () => {
  test.use({ locale: "en-US" });

  // EN sub-text values: messages/en.json good_sub / spike_sub / hypo_sub.
  const EN_SUBS = ["14 good", "Hyperglycemia", "Hypoglycemia"] as const;

  test("all three RateTiles are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await expect(phone.getByText(/Good Rate/)).toBeVisible();

    // ── Label divs ────────────────────────────────────────────────────
    for (const label of RATE_LABELS) {
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `RateTile label "${label}" (EN)`);

      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim().toLowerCase()).toBe(label.toLowerCase());
    }

    // ── Sub-text divs ─────────────────────────────────────────────────
    for (const sub of EN_SUBS) {
      const subEl = phone.getByText(sub, { exact: true }).first();
      await expect(subEl).toBeVisible();
      await assertNoOverflow(subEl, `RateTile sub "${sub}" (EN)`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 2 — MacroRing labels
//
// The daily-macros card uses a 4-column grid of MacroRing widgets. Each label
// div carries `whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"`.
// The label texts come from messages/{de,en}.json → dashboard.macro_* keys.
//
// DE: "CARBS" / "PROTEIN" / "FETT" / "FIBER"
// EN: "CARBS" / "PROTEIN" / "FAT"  / "FIBER"
//
// The difference ("FETT" vs "FAT") means a styling change could clip one locale
// but not the other — hence separate describe blocks per locale.
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Marketing phone MacroRing labels — DE locale", () => {
  test.use({ locale: "de-DE" });

  // Values from messages/de.json → dashboard: macro_carbs / macro_protein /
  // macro_fat / macro_fiber. Already uppercase in the JSON; CSS text-transform
  // has no additional effect but is still present on the element.
  const DE_MACRO_LABELS = ["CARBS", "PROTEIN", "FETT", "FIBER"] as const;

  test("all four MacroRing labels are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Dashboard is the default tab. Anchor on the first label to ensure the
    // daily-macros card has hydrated before we run overflow checks.
    await expect(phone.getByText("CARBS", { exact: true }).first()).toBeVisible();

    for (const label of DE_MACRO_LABELS) {
      // Each label appears exactly once in the daily-macros card.
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `MacroRing label "${label}" (DE)`);

      // Full-text round-trip — no characters swallowed by ellipsis.
      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

test.describe("Marketing phone MacroRing labels — EN locale", () => {
  test.use({ locale: "en-US" });

  // Values from messages/en.json → dashboard: macro_carbs / macro_protein /
  // macro_fat / macro_fiber. "FAT" differs from the DE "FETT".
  const EN_MACRO_LABELS = ["CARBS", "PROTEIN", "FAT", "FIBER"] as const;

  test("all four MacroRing labels are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await expect(phone.getByText("CARBS", { exact: true }).first()).toBeVisible();

    for (const label of EN_MACRO_LABELS) {
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `MacroRing label "${label}" (EN)`);

      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 3 — Settings screen row labels
//
// The Settings screen row labels are rendered in a span with
// `whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"`.
// We navigate there by clicking the Settings tab in the BottomNav (label text
// "EINSTELL." in DE, "SETTINGS" in EN — uppercased from tNav("settings")).
//
// Longest DE labels (most likely to overflow in a narrow column):
//   "Benachrichtigungen" (18 chars) · "Erscheinungsbild" (16 chars) ·
//   "CGM Verbindung" (14 chars)
//
// Longest EN labels:
//   "CGM Connection" (14 chars) · "Macro Targets" (13 chars) ·
//   "Notifications" (13 chars)
// ══════════════════════════════════════════════════════════════════════════════

/** Click the Settings tab in the marketing phone bottom nav, then wait for a
 *  known Settings-screen element to be visible before continuing. */
async function gotoSettingsScreen(phone: Locator, navLabel: string, anchorText: string): Promise<void> {
  // The BottomNav renders each tab as a <button> whose text content is the
  // uppercased nav label (e.g. "EINSTELL." or "SETTINGS"). We use exact:true
  // so the EN "SETTINGS" button doesn't also match the cog button whose
  // aria-label is "Open settings" (partial match would hit both).
  const settingsBtn = phone.getByRole("button", { name: navLabel, exact: true });
  await settingsBtn.click();
  // Wait for a Settings-screen label to confirm the tab has switched.
  await expect(phone.getByText(anchorText, { exact: true }).first()).toBeVisible();
}

test.describe("Marketing phone Settings row labels — DE locale", () => {
  test.use({ locale: "de-DE" });

  // Subset of row labels from SettingsScreen — the longest ones are most likely
  // to overflow. "Benachrichtigungen" is the longest at 18 chars.
  const DE_SETTINGS_LABELS = [
    "Benachrichtigungen",
    "Erscheinungsbild",
    "CGM Verbindung",
  ] as const;

  test("Settings row labels are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to Settings tab. Nav button is "EINSTELL." (uppercased).
    await gotoSettingsScreen(phone, "EINSTELL.", "Benachrichtigungen");

    for (const label of DE_SETTINGS_LABELS) {
      // Row labels are in a <span> inside the settings list; exact match avoids
      // picking up the page title or sub-labels.
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `Settings row label "${label}" (DE)`);

      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

test.describe("Marketing phone Settings row labels — EN locale", () => {
  test.use({ locale: "en-US" });

  // Longest EN labels. "CGM Connection" and "Macro Targets" are both 14 chars.
  const EN_SETTINGS_LABELS = [
    "CGM Connection",
    "Macro Targets",
    "Notifications",
  ] as const;

  test("Settings row labels are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to Settings tab. Nav button is "SETTINGS" (uppercased).
    await gotoSettingsScreen(phone, "SETTINGS", "Notifications");

    for (const label of EN_SETTINGS_LABELS) {
      const labelEl = phone.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await assertNoOverflow(labelEl, `Settings row label "${label}" (EN)`);

      const rawText = (await labelEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 4 — Engine step-pill labels (Task #574)
//
// The Engine screen shows a 3-step wizard. The step selector at the top is a
// 3-column CSS grid where each cell contains a <button> with the label text
// "1 · <step_name>". The grid uses `repeat(3, 1fr)` with padding 4 px and
// font-size 9.5 px — the cells are narrow and the text has no explicit overflow
// guard, making silent clipping a real risk when translation strings grow.
//
// DE: "1 · Essen" / "2 · Makros" / "3 · Ergebnis"
// EN: "1 · Food"  / "2 · Macros" / "3 · Result"
//
// "Ergebnis" (8 chars + prefix) is the longest label and most likely to clip.
// We navigate to the Engine tab via the "GLEV" BottomNav button (label text is
// tNav("glev").toUpperCase() = "GLEV" in both locales).
// ══════════════════════════════════════════════════════════════════════════════

/** Click the Glev/Engine tab in the marketing phone bottom nav, then wait for
 *  a known Engine-screen element to be visible before continuing. */
async function gotoEngineScreen(phone: Locator, anchorText: string): Promise<void> {
  // The BottomNav renders the Engine tab as a <button> whose visible text
  // content is "GLEV" (uppercased tNav("glev")) in both DE and EN locales.
  const glevBtn = phone.getByRole("button", { name: "GLEV", exact: true });
  await glevBtn.click();
  // Wait for a step-pill to confirm the Engine screen has mounted.
  await expect(phone.getByText(anchorText, { exact: true }).first()).toBeVisible();
}

test.describe("Marketing phone Engine step-pill labels — DE locale", () => {
  test.use({ locale: "de-DE" });

  // Full pill button text as rendered by the component:
  //   `1 · ${tEng("step_label_food")}` etc., with messages/de.json values.
  const DE_PILL_LABELS = [
    "1 · Essen",
    "2 · Makros",
    "3 · Ergebnis",
  ] as const;

  test("all three Engine step-pills are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to the Engine screen. Anchor on the first pill.
    await gotoEngineScreen(phone, "1 · Essen");

    for (const label of DE_PILL_LABELS) {
      // Each pill is a <button> whose full text content is the label string.
      const pillEl = phone.getByText(label, { exact: true }).first();
      await expect(pillEl).toBeVisible();
      await assertNoOverflow(pillEl, `Engine step-pill "${label}" (DE)`);

      // Full-text round-trip — no characters swallowed by overflow clipping.
      const rawText = (await pillEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

test.describe("Marketing phone Engine step-pill labels — EN locale", () => {
  test.use({ locale: "en-US" });

  // Full pill button text with messages/en.json values.
  const EN_PILL_LABELS = [
    "1 · Food",
    "2 · Macros",
    "3 · Result",
  ] as const;

  test("all three Engine step-pills are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to the Engine screen. Anchor on the first pill.
    await gotoEngineScreen(phone, "1 · Food");

    for (const label of EN_PILL_LABELS) {
      const pillEl = phone.getByText(label, { exact: true }).first();
      await expect(pillEl).toBeVisible();
      await assertNoOverflow(pillEl, `Engine step-pill "${label}" (EN)`);

      const rawText = (await pillEl.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 5 — Insights screen card labels and TIR legend spans (Tasks #575, #578)
//
// The InsightsScreen renders:
//   • CardLabel elements (fontSize:9, fontWeight:700) as card header titles
//     inside flex containers — the longest DE label is
//     "Mahlzeiten-Bewertung · 7T" (26 chars).
//   • Meal-evaluation row labels inside a fixed width:72 container (fontSize:10)
//     — "Hypo-Risiko" in DE is the at-risk outlier.
//
// Navigation: click the "INSIGHTS" BottomNav button (uppercased in both
// locales) then anchor on the TIR card header before running checks.
// ══════════════════════════════════════════════════════════════════════════════

/** Click the Insights tab in the marketing phone bottom nav, then wait for a
 *  known Insights-screen element to be visible before continuing. */
async function gotoInsightsScreen(
  phone: Locator,
  tirHeaderText: string,
): Promise<void> {
  // BottomNav uppercases the nav label — "INSIGHTS" in both locales.
  const insightsBtn = phone.getByRole("button", {
    name: "INSIGHTS",
    exact: true,
  });
  await insightsBtn.click();
  // Anchor on the Time-in-Range card header to confirm the screen has loaded.
  await expect(
    phone.getByText(tirHeaderText, { exact: true }).first(),
  ).toBeVisible();
}

test.describe("Marketing phone Insights card labels — DE locale", () => {
  test.use({ locale: "de-DE" });

  // CardLabel texts used as card headers in InsightsScreen (DE).
  // These are hardcoded strings in AppMockupPhone.tsx via pickCopy().
  const DE_CARD_HEADERS = [
    "Time in Range · 7T",
    "Ø Glukose",
    "GMI · gesch. A1c",
    "7-Tage-Trend",
    "Ø pro Tag",
    "Mahlzeiten-Bewertung · 7T",
  ] as const;

  // Meal-evaluation row labels inside the fixed width:72 container.
  // "Hypo-Risiko" is the longest and most at risk of overflow.
  const DE_MEAL_ROW_LABELS = ["Im Ziel", "Spike", "Hypo-Risiko"] as const;

  test("Insights card headers are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7T");

    for (const header of DE_CARD_HEADERS) {
      const el = phone.getByText(header, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `Insights card header "${header}" (DE)`);

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(header);
    }
  });

  test("Insights meal-evaluation row labels are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7T");

    for (const label of DE_MEAL_ROW_LABELS) {
      const el = phone.getByText(label, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(
        el,
        `Insights meal-eval row label "${label}" (DE)`,
      );

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

test.describe("Marketing phone Insights card labels — EN locale", () => {
  test.use({ locale: "en-US" });

  // CardLabel texts used as card headers in InsightsScreen (EN).
  const EN_CARD_HEADERS = [
    "Time in Range · 7d",
    "Avg. glucose",
    "GMI · est. A1c",
    "7-day trend",
    "Avg. / day",
    "Meal rating · 7d",
  ] as const;

  // Meal-evaluation row labels inside the fixed width:72 container (EN).
  const EN_MEAL_ROW_LABELS = ["In range", "Spike", "Hypo risk"] as const;

  test("Insights card headers are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7d");

    for (const header of EN_CARD_HEADERS) {
      const el = phone.getByText(header, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `Insights card header "${header}" (EN)`);

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(header);
    }
  });

  test("Insights meal-evaluation row labels are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7d");

    for (const label of EN_MEAL_ROW_LABELS) {
      const el = phone.getByText(label, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(
        el,
        `Insights meal-eval row label "${label}" (EN)`,
      );

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 5 (continued) — TIR legend spans (Task #578)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Marketing phone Insights TIR legend spans — DE locale", () => {
  test.use({ locale: "de-DE" });

  // Full text content of each <span> in the TIR legend row (DE).
  // pickCopy(locale, { de: "Sehr tief", en: "Very low" }) etc., combined with
  // the static bullet and percentage literals in AppMockupPhone.tsx.
  const DE_TIR_LEGEND = [
    "● Sehr tief 2%",
    "● Tief 6%",
    "● Im Ziel 78%",
    "● Hoch 14%",
  ] as const;

  test("TIR legend spans are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7T");

    for (const spanText of DE_TIR_LEGEND) {
      const el = phone.getByText(spanText, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `TIR legend span "${spanText}" (DE)`);

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(spanText);
    }
  });
});

test.describe("Marketing phone Insights TIR legend spans — EN locale", () => {
  test.use({ locale: "en-US" });

  // Full text content of each <span> in the TIR legend row (EN).
  const EN_TIR_LEGEND = [
    "● Very low 2%",
    "● Low 6%",
    "● In range 78%",
    "● High 14%",
  ] as const;

  test("TIR legend spans are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoInsightsScreen(phone, "Time in Range · 7d");

    for (const spanText of EN_TIR_LEGEND) {
      const el = phone.getByText(spanText, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `TIR legend span "${spanText}" (EN)`);

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(spanText);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 6 — TIR stacked bar segments (Task #579)
//
// The TIR card contains a stacked progress bar at height:12. It holds four
// coloured child <div> elements with percentage-based inline widths:
//   2%  — very low (PINK)
//   6%  — low (ORANGE)
//   78% — in-range (GREEN)
//   14% — high (#FFD166)
//
// The bar container is identified by data-testid="tir-stacked-bar".
// A layout regression (e.g. a parent MockCard flex/grid change) could collapse
// the bar to zero height or cause the segments to overflow the container without
// any visible indicator. These checks guard all three failure modes:
//   1. Container visible + offsetHeight > 0
//   2. Each segment div has offsetWidth > 0 (none collapsed)
//   3. Bar container scrollWidth ≤ offsetWidth (no horizontal overflow)
//
// The bar itself is locale-neutral (same colours and widths in DE and EN), but
// we run the check in both locales so regressions that only appear in one locale
// context (e.g. due to a different surrounding layout) are still caught.
// ══════════════════════════════════════════════════════════════════════════════

/** Shared helper: assert TIR stacked bar geometry inside `phone`. */
async function assertTirBarGeometry(phone: Locator, locale: string): Promise<void> {
  const bar = phone.locator('[data-testid="tir-stacked-bar"]').first();

  // 1. Container must be visible.
  await expect(bar, `TIR bar container not visible (${locale})`).toBeVisible();

  // 2. Container must have a positive rendered height.
  const barHeight = await bar.evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(
    barHeight,
    `TIR bar container has offsetHeight ${barHeight} — expected > 0 (${locale}). ` +
      `A parent layout change may have collapsed the bar.`,
  ).toBeGreaterThan(0);

  // 3. Container must not overflow its parent horizontally.
  const barOverflows = await bar.evaluate(
    (el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).offsetWidth,
  );
  expect(
    barOverflows,
    `TIR bar container overflows its parent (scrollWidth > offsetWidth) in ${locale}. ` +
      `Check the parent MockCard or container div for a width regression.`,
  ).toBe(false);

  // 4. All four segment divs must have a positive rendered width.
  //    The four children are direct child divs of the bar container.
  const segmentWidths = await bar.evaluate((el) => {
    return Array.from(el.children).map((child) => ({
      width: (child as HTMLElement).offsetWidth,
      style: (child as HTMLElement).style.width,
    }));
  });

  expect(
    segmentWidths.length,
    `TIR bar expected 4 segment divs, got ${segmentWidths.length} (${locale})`,
  ).toBe(4);

  const EXPECTED_WIDTHS = ["2%", "6%", "78%", "14%"] as const;

  for (let i = 0; i < segmentWidths.length; i++) {
    const { width, style } = segmentWidths[i];
    expect(
      width,
      `TIR bar segment ${i + 1} (style width:${style ?? EXPECTED_WIDTHS[i]}) ` +
        `has offsetWidth ${width} — expected > 0 (${locale}). ` +
        `The parent bar may have collapsed or the segment flex sizing may be broken.`,
    ).toBeGreaterThan(0);
  }
}

test.describe("Marketing phone TIR stacked bar segments — DE locale", () => {
  test.use({ locale: "de-DE" });

  test("TIR stacked bar is visible, has height > 0, all segments have width > 0, and does not overflow in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to the Insights screen — anchor on the TIR card header.
    await gotoInsightsScreen(phone, "Time in Range · 7T");

    await assertTirBarGeometry(phone, "DE");
  });
});

test.describe("Marketing phone TIR stacked bar segments — EN locale", () => {
  test.use({ locale: "en-US" });

  test("TIR stacked bar is visible, has height > 0, all segments have width > 0, and does not overflow in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to the Insights screen — anchor on the TIR card header.
    await gotoInsightsScreen(phone, "Time in Range · 7d");

    await assertTirBarGeometry(phone, "EN");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PART 7 — Engine Step 3 result-cell labels and disclaimer (Task #601)
//
// The Engine Step 3 (Result / Ergebnis) view contains:
//   • A 3-column breakdown grid with cell labels at fontSize:7.5 and padding:4–6 px.
//     Each cell has `textAlign:"center"` but no explicit overflow guard — silent
//     clipping is possible if translations grow or the container narrows.
//   • A disclaimer footer whose bold label is rendered via <strong> at fontSize:8.5.
//
// Navigation:
//   1. gotoEngineScreen() — clicks "GLEV" in the BottomNav and anchors on the
//      first step pill.
//   2. Click the "3 · Ergebnis" (DE) / "3 · Result" (EN) pill button.
//   3. Anchor on the confidence badge ("HOCH" / "HIGH") to confirm Step 3 is live.
//
// Checked elements per locale:
//   DE: cell labels "Carb", "Korrektur", "Gesamt"; disclaimer label "Wichtig:"
//   EN: cell labels "Carb", "Correction", "Total"; disclaimer label "Important:"
// ══════════════════════════════════════════════════════════════════════════════

/** Navigate to Engine Step 3 inside `phone`.
 *
 *  The step-3 pill is disabled until the wizard has progressed to step 3
 *  (`reachable = s.id <= step` in AppMockupPhone.tsx). We must walk through
 *  the wizard interactively:
 *
 *  1. Click "GLEV" BottomNav button → Engine Step 1 mounts.
 *  2. Click the speak/mic button (tEng("voice_btn_speak")) → a 2.6 s mock
 *     animation runs and auto-advances to Step 2.
 *  3. Click the "Calculate bolus →" / "Bolus berechnen →" CTA → Step 3 mounts.
 *  4. Anchor on the confidence badge to confirm Step 3 has rendered.
 */
async function gotoEngineStep3(
  phone: Locator,
  speakBtnLabel: string,
  calculateBolusBtnLabel: string,
  confidenceBadgeText: string,
): Promise<void> {
  // Step 1 — open the Engine screen. The speak button label is a reliable
  // anchor because it only appears on Step 1 and is visible immediately.
  await gotoEngineScreen(phone, speakBtnLabel);

  // Step 2 — tap the mic/speak button to trigger the mock voice flow.
  //   The flow runs: idle → listening (1.5 s) → parsing (1.1 s) → idle + setStep(2).
  //   Total auto-advance time ≈ 2.6 s. Playwright's default actionTimeout is 15 s.
  const speakBtn = phone.getByText(speakBtnLabel, { exact: true }).first();
  await speakBtn.click();

  // Step 3 — wait for the "Calculate bolus →" button that only renders in Step 2.
  const calculateBtn = phone.getByText(calculateBolusBtnLabel, { exact: true }).first();
  await expect(calculateBtn).toBeVisible({ timeout: 8_000 });
  await calculateBtn.click();

  // Step 4 — wait for the confidence badge that only appears on Step 3.
  await expect(
    phone.getByText(confidenceBadgeText, { exact: true }).first(),
  ).toBeVisible();
}

test.describe("Marketing phone Engine Step 3 result labels — DE locale", () => {
  test.use({ locale: "de-DE" });

  // Cell labels from AppMockupPhone.tsx EngineStepResult → cellCarb / cellCorr /
  // cellTotal (messages/de.json values via pickCopy).
  const DE_CELL_LABELS = ["Carb", "Korrektur", "Gesamt"] as const;

  // Disclaimer bold label: tEng("disclaimer_label") → messages/de.json.
  const DE_DISCLAIMER_LABEL = "Wichtig:";

  test("Engine Step 3 cell labels are visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to Step 3 via the full wizard flow:
    //   Step 1 (speak button) → Step 2 (macros form) → Step 3 (result).
    // Speak button: tEng("voice_btn_speak") = "Sprechen" (DE).
    // Calculate bolus CTA: tEng("btn_calculate_bolus") = "Bolus berechnen →" (DE).
    // Confidence badge on Step 3: pickCopy → "HOCH" (DE).
    await gotoEngineStep3(phone, "Sprechen", "Bolus berechnen →", "HOCH");

    for (const label of DE_CELL_LABELS) {
      // Cell labels are rendered in a <div> at fontSize:7.5 inside a 1fr column.
      const el = phone.getByText(label, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `Engine Step 3 cell label "${label}" (DE)`);

      // Full-text round-trip — no characters swallowed.
      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });

  test("Engine Step 3 disclaimer label is visible and not overflowing in DE", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoEngineStep3(phone, "Sprechen", "Bolus berechnen →", "HOCH");

    // The disclaimer bold label is rendered via <strong> inside the footer div.
    const el = phone.getByText(DE_DISCLAIMER_LABEL, { exact: true }).first();
    await expect(el).toBeVisible();
    await assertNoOverflow(
      el,
      `Engine Step 3 disclaimer label "${DE_DISCLAIMER_LABEL}" (DE)`,
    );

    const rawText = (await el.textContent()) ?? "";
    expect(rawText.trim()).toBe(DE_DISCLAIMER_LABEL);
  });
});

test.describe("Marketing phone Engine Step 3 result labels — EN locale", () => {
  test.use({ locale: "en-US" });

  // Cell labels from AppMockupPhone.tsx EngineStepResult → cellCarb / cellCorr /
  // cellTotal (messages/en.json values via pickCopy).
  const EN_CELL_LABELS = ["Carb", "Correction", "Total"] as const;

  // Disclaimer bold label: tEng("disclaimer_label") → messages/en.json.
  const EN_DISCLAIMER_LABEL = "Important:";

  test("Engine Step 3 cell labels are visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    // Navigate to Step 3 via the full wizard flow.
    // Speak button: tEng("voice_btn_speak") = "Speak" (EN).
    // Calculate bolus CTA: tEng("btn_calculate_bolus") = "Calculate bolus →" (EN).
    // Confidence badge on Step 3: pickCopy → "HIGH" (EN).
    await gotoEngineStep3(phone, "Speak", "Calculate bolus →", "HIGH");

    for (const label of EN_CELL_LABELS) {
      const el = phone.getByText(label, { exact: true }).first();
      await expect(el).toBeVisible();
      await assertNoOverflow(el, `Engine Step 3 cell label "${label}" (EN)`);

      const rawText = (await el.textContent()) ?? "";
      expect(rawText.trim()).toBe(label);
    }
  });

  test("Engine Step 3 disclaimer label is visible and not overflowing in EN", async ({
    page,
  }) => {
    const phone = await gotoHomeAndFindPhone(page);

    await gotoEngineStep3(phone, "Speak", "Calculate bolus →", "HIGH");

    // The disclaimer bold label is rendered via <strong> inside the footer div.
    const el = phone.getByText(EN_DISCLAIMER_LABEL, { exact: true }).first();
    await expect(el).toBeVisible();
    await assertNoOverflow(
      el,
      `Engine Step 3 disclaimer label "${EN_DISCLAIMER_LABEL}" (EN)`,
    );

    const rawText = (await el.textContent()) ?? "";
    expect(rawText.trim()).toBe(EN_DISCLAIMER_LABEL);
  });
});
