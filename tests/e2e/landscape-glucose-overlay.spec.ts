// Regression guard for LandscapeGlucoseOverlay (Tasks #641, #642).
//
// ── Describe block 1 — viewport detection (Task #641) ──────────────────────
//   The LandscapeGlucoseOverlay was silently broken because the deprecated
//   `orientationchange` event stopped firing in modern browsers/WebViews and
//   there was no automated check to catch it. Task #640 fixed the detection
//   by also listening to `resize` and `screen.orientation.change`. This spec
//   guards against future regressions where the orientation/resize listener
//   is accidentally removed or the landscape condition (w > h && h <= 600)
//   changes.
//
//   What this asserts:
//     1. Portrait viewport (375×812): the overlay is NOT in the DOM.
//     2. Landscape viewport (844×390): Playwright's `setViewportSize` fires
//        a real `resize` event. The overlay must become visible.
//     3. Back to portrait (375×812): the overlay disappears again.
//
// ── Describe block 2 — CGM data rendering (Task #642) ──────────────────────
//   The first block only checked overlay presence/absence. A bug in the
//   data-loading or chart rendering path would go undetected. This block
//   seeds a mock CGM response via Playwright route interception, rotates to
//   landscape, and then asserts:
//     1. The glucose value (numeric, in mg/dL) is rendered visibly.
//     2. The trend SVG arrow element is present (TrendSvg renders an <svg>).
//     3. The chart SVG contains at least one <path> element (the glucose trace).
//
// Why we navigate to /login (not /dashboard):
//   LandscapeGlucoseOverlay is mounted in app/layout.tsx (the root layout),
//   so it is present on *every* page, including the public /login page.
//   Using /login avoids auth setup and the protected-route compilation path,
//   making this test faster and more self-contained.
//
// Why setViewportSize works:
//   The component listens to `window.addEventListener("resize", check)`.
//   Playwright's setViewportSize resizes the browser window and dispatches
//   a native resize event, triggering the React state update.
//
// Why page.route() is enough for the mock:
//   fetchCgmHistory() calls fetch("/api/cgm/history") in the browser. Playwright
//   route interception happens at the browser network layer — the mock response
//   is returned before the server sees the request. The module-level cache in
//   clientCache.ts starts empty for each fresh page, so the first fetch always
//   hits the interceptor.

import { expect, test } from "@playwright/test";

const OVERLAY_SELECTOR = '[aria-label="Live-Glukose Querformat"]';

const PORTRAIT  = { width: 375, height: 812 };
const LANDSCAPE = { width: 844, height: 390 };

// ── 1. Viewport detection ──────────────────────────────────────────────────

test.describe("LandscapeGlucoseOverlay — viewport detection", () => {
  test.use({ viewport: PORTRAIT });

  test("overlay hidden in portrait, visible in landscape, hidden again in portrait", async ({ page }) => {
    // Navigate to the login page — LandscapeGlucoseOverlay is in the root
    // layout, so it renders on every page including public ones.
    await page.goto("/login");

    // Wait for the page to be interactive so the client component hydrates.
    await page.waitForLoadState("domcontentloaded");

    // ── 1. Portrait: overlay must be absent ─────────────────────────────────
    // The component returns null when !landscape, so the element is not in
    // the DOM at all.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should NOT be present in portrait (375×812)",
    ).not.toBeVisible();

    // ── 2. Rotate to landscape ───────────────────────────────────────────────
    // setViewportSize dispatches a real browser resize event, which triggers
    // the `check` callback inside the useEffect and flips `landscape` to true.
    await page.setViewportSize(LANDSCAPE);

    // The overlay must appear. The React state update + re-render takes a few
    // animation frames so we give it a generous timeout.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible after rotating to landscape (844×390)",
    ).toBeVisible({ timeout: 8_000 });

    // ── 3. Back to portrait: overlay must disappear ──────────────────────────
    await page.setViewportSize(PORTRAIT);

    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should NOT be visible after returning to portrait (375×812)",
    ).not.toBeVisible({ timeout: 8_000 });
  });
});

// ── 2. CGM data rendering ──────────────────────────────────────────────────

test.describe("LandscapeGlucoseOverlay — CGM data rendering", () => {
  test.use({ viewport: PORTRAIT });

  test("glucose value, trend arrow SVG, and chart path are visible when CGM data is present", async ({ page }) => {
    // Build a mock CGM payload.
    // Timestamps are ISO strings — parseLluTs() falls back to parseDbTs()
    // which handles ISO-8601 correctly.
    const now = Date.now();
    const mkTs = (minsAgo: number) =>
      new Date(now - minsAgo * 60_000).toISOString();

    // Glucose value chosen to be clearly in-range (green) and easy to assert.
    const MOCK_VALUE = 142;

    const mockPayload = {
      current: {
        value: MOCK_VALUE,
        unit:  "mg/dL",
        timestamp: mkTs(4),
        trend: "flat",
      },
      history: [
        { value: 108, timestamp: mkTs(120), trend: "flat" },
        { value: 115, timestamp: mkTs(100), trend: "up" },
        { value: 122, timestamp: mkTs(80),  trend: "up" },
        { value: 131, timestamp: mkTs(60),  trend: "up" },
        { value: 137, timestamp: mkTs(40),  trend: "flat" },
        { value: 140, timestamp: mkTs(20),  trend: "flat" },
        { value: MOCK_VALUE, timestamp: mkTs(4), trend: "flat" },
      ],
    };

    // Intercept /api/cgm/history before navigating so the first fetch that
    // the component makes (when it enters landscape) is served the mock.
    await page.route("/api/cgm/history", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(mockPayload),
      });
    });

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Rotate to landscape — triggers the resize event + data fetch.
    await page.setViewportSize(LANDSCAPE);

    // The overlay wrapper must appear first.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible after rotating to landscape",
    ).toBeVisible({ timeout: 8_000 });

    // ── 1. Glucose value ─────────────────────────────────────────────────────
    // The component renders Math.round(current.v) as a large <span>. We look
    // for the exact text "142" inside the overlay. The unit label "mg/dL" is
    // a separate sibling span so the text node itself is just the number.
    await expect(
      page.locator(OVERLAY_SELECTOR).getByText(String(MOCK_VALUE), { exact: true }),
      `Glucose value ${MOCK_VALUE} should be rendered inside the overlay`,
    ).toBeVisible({ timeout: 8_000 });

    // ── 2. Trend SVG arrow ───────────────────────────────────────────────────
    // TrendSvg is rendered in a column-flex div that is a sibling of the
    // glucose number span and contains the "mg/dL" unit label plus the arrow:
    //
    //   <div style="flexDirection:column">
    //     <span>mg/dL</span>
    //     <TrendSvg />   ← renders <svg><line .../><polyline .../></svg>
    //   </div>
    //
    // Scoping via the "mg/dL" parent ensures we assert the arrow SVG
    // specifically — not any other SVG in the overlay (chart, crosshair, etc.).
    const trendContainer = page
      .locator(OVERLAY_SELECTOR)
      .getByText("mg/dL")
      .locator("..");
    await expect(
      trendContainer.locator("svg"),
      "TrendSvg should be attached in the mg/dL column (confirms arrow rendered)",
    ).toBeAttached({ timeout: 8_000 });

    // ── 3. Chart SVG path ────────────────────────────────────────────────────
    // LandscapeChart builds `path = visible.map((r, i) => ...).join(" ")` and
    // renders <path d={path} ...>. With 7 history points all within the last
    // 2 hours, visible.length > 0 is guaranteed, so the <path> must exist.
    // We use toBeAttached() on the first match — it verifies the element is in
    // the DOM without requiring a non-zero bounding box (SVG children can
    // report zero area in some Playwright/OS configurations).
    await expect(
      page.locator(`${OVERLAY_SELECTOR} svg path`).first(),
      "Chart SVG should contain at least one <path> element (the glucose trace)",
    ).toBeAttached({ timeout: 8_000 });
  });
});
