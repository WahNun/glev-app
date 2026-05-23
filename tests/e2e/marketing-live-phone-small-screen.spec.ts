// Regression guard for the LivePhoneScaler wrapper on narrow viewports.
//
// Why this file exists:
//   Task #569 introduced the LivePhoneScaler component around the live
//   dashboard AppMockupPhone in the Feature-Row on the marketing homepage.
//   The scaler measures its container width via ResizeObserver and applies
//   transform: scale(containerWidth / 320) so the fixed-width 320×660 px
//   phone frame stays within bounds.
//
//   Without this guard, someone could:
//     • Remove the LivePhoneScaler wrapper (reverting to a plain <div>)
//     • Remove the transform logic from the inner div
//     • Change the section padding in a way that breaks layout
//   …and the phone could overflow or clip on narrow viewports without any
//   automated check catching it.
//
// What this asserts (at 360×780 px viewport — narrow Android):
//   1. The page has NO horizontal overflow — document.documentElement.scrollWidth
//      does not exceed window.innerWidth. This is the user-visible symptom of
//      a layout regression.
//   2. The LivePhoneScaler outer wrapper ([data-testid="live-phone-scaler"])
//      is present in the DOM. If the scaler is removed and replaced by a plain
//      <div>, this testid is gone and the test fails immediately.
//   3. The scaler's rendered width does not exceed the viewport width.
//   4. The inner scaling div ([data-testid="live-phone-scaler-inner"]) has a
//      non-"none" CSS transform value. LivePhoneScaler always sets an inline
//      `transform: scale(${scale})` — even when scale=1 (phone fits exactly),
//      this produces `matrix(1, 0, 0, 1, 0, 0)` in getComputedStyle(). A plain
//      <div> with no transform style would produce "none". This check catches
//      regressions where the transform logic is removed from inside the scaler.
//
// Layout note — why scale = 1 at 360 px:
//   AppMockupPhone has a fixed intrinsic width of 320 px. This sizes the grid
//   column to 320 px on any viewport, so the available width the ResizeObserver
//   measures equals 320 px — no scaling is needed. The transform is still set
//   (to scale(1)), keeping the inline style contract intact and making the guard
//   reliable regardless of viewport. On real devices where the viewport truly
//   constrains the column to < 320 px, the scaler actively shrinks the phone.
//
// Viewport: 360×780 — the most common narrow Android (Samsung Galaxy A-series
// and similar). Specified in the task definition.

import { expect, test } from "@playwright/test";

test.describe("LivePhoneScaler — narrow Android viewport (360×780)", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("live dashboard phone does not overflow its container on 360px viewport", async ({
    page,
  }) => {
    // Use "networkidle" so the React tree has hydrated and the ResizeObserver
    // tick inside LivePhoneScaler has had a chance to fire and update the scale.
    await page.goto("/", { waitUntil: "networkidle" });

    // ── 1. No horizontal page overflow ────────────────────────────────────
    // A layout regression (phone too wide, section padding removed, etc.)
    // would cause the document to scroll horizontally.
    const isPageOverflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(
      isPageOverflowing,
      "The marketing homepage has horizontal overflow at 360px viewport " +
        "(document.documentElement.scrollWidth > window.innerWidth). " +
        "The live dashboard phone may be missing its LivePhoneScaler wrapper " +
        "in app/page.tsx — check that <LivePhoneScaler> wraps the dashboard " +
        "AppMockupPhone in the deepdive FeatureImageRow.",
    ).toBe(false);

    // ── 2. LivePhoneScaler wrapper is present ─────────────────────────────
    // The outer div must carry data-testid="live-phone-scaler". If the scaler
    // component is removed and replaced by a plain <div>, the testid is gone.
    const scaler = page.locator('[data-testid="live-phone-scaler"]');
    await expect(
      scaler,
      "Expected [data-testid='live-phone-scaler'] to be visible. " +
        "This element is rendered by the LivePhoneScaler wrapper in app/page.tsx. " +
        "If it is missing, the scaler has been removed or replaced.",
    ).toBeVisible();

    // ── 3. Outer wrapper width within viewport ────────────────────────────
    const scalerWidth = await scaler.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    expect(
      scalerWidth,
      `LivePhoneScaler outer div is ${scalerWidth}px wide, which exceeds the ` +
        "360px viewport. The wrapper must use width: min(320px, 100%) to stay " +
        "within its containing column.",
    ).toBeLessThanOrEqual(360);

    // ── 4. Transform style is set on the inner div ────────────────────────
    // LivePhoneScaler always sets an inline transform on its inner div via
    // React state (style={{ transform: `scale(${scale})` }}). Even when
    // scale = 1 this produces getComputedStyle → "matrix(1, 0, 0, 1, 0, 0)"
    // rather than "none". A plain <div> with no transform has transform: none.
    // This check catches the regression where the transform mechanism is
    // removed while the testid divs happen to remain.
    const inner = page.locator('[data-testid="live-phone-scaler-inner"]');
    await expect(
      inner,
      "Expected [data-testid='live-phone-scaler-inner'] to be visible. " +
        "This element is rendered by the inner div inside LivePhoneScaler " +
        "in app/page.tsx.",
    ).toBeVisible();

    const transformValue = await inner.evaluate(
      (el) => window.getComputedStyle(el).transform,
    );
    expect(
      transformValue,
      "LivePhoneScaler inner div has transform: none " +
        `(computed: "${transformValue}"). ` +
        "The LivePhoneScaler must apply an inline transform: scale(${scale}) " +
        "on its inner div. Even when scale=1, this produces a non-none computed " +
        "transform value. 'none' means the transform has been removed — check " +
        "the LivePhoneScaler implementation in app/page.tsx.",
    ).not.toBe("none");
  });
});
