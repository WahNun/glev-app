// Regression guard for RateTile chip-tile layout on the marketing phone.
//
// Why this test exists:
//   The original text-overflow bug (Task #566) was caught visually: the
//   three Rate Tiles (Good Rate / Spike Rate / Hypo Rate) on the marketing
//   demo phone silently clipped their label text when the tile grid was
//   narrower than the longest word. This spec turns that manual visual pass
//   into an automated check.
//
// What we cover:
//   1. All three RateTile chip tiles render visibly on the Dashboard screen
//      in both the DE and EN marketing phone variants.
//   2. The label div of every tile does NOT overflow its container —
//      `scrollWidth <= offsetWidth` is the browser-level invariant broken
//      when `overflow:hidden` + `whiteSpace:nowrap` clips inline text.
//   3. Neither the label nor the sub-text div contains a Unicode ellipsis
//      ("…" / "..."), confirming `textOverflow:ellipsis` is NOT actively
//      truncating readable copy.
//   4. The full expected text is present with no characters swallowed.
//
// Structure:
//   Two `test.describe` blocks — one pinned to `de-DE` (the marketing
//   default) and one to `en-US` — to ensure regressions introduced by
//   locale-specific label length are caught in either language.
//
// Selector strategy:
//   RateTile label divs are targeted by exact text content ("Good Rate",
//   "Spike Rate", "Hypo Rate"). These strings are identical in both
//   `messages/de.json` and `messages/en.json` so the label assertions are
//   locale-neutral. Sub-text strings differ per locale and are tested
//   separately in each describe block.

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
