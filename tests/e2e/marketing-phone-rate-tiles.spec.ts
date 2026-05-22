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
// Structure:
//   Six `test.describe` blocks — two per part (DE + EN each) — so regressions
//   are pinpointed to the affected locale and element group.
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
