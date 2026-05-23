// Regression guard for LandscapeGlucoseOverlay (Task #641).
//
// Why this test exists:
//   The LandscapeGlucoseOverlay was silently broken because the deprecated
//   `orientationchange` event stopped firing in modern browsers/WebViews and
//   there was no automated check to catch it. Task #640 fixed the detection
//   by also listening to `resize` and `screen.orientation.change`. This spec
//   guards against future regressions where the orientation/resize listener
//   is accidentally removed or the landscape condition (w > h && h <= 600)
//   changes.
//
// What this asserts:
//   1. Portrait viewport (375×812): the overlay is NOT in the DOM —
//      `aria-label="Live-Glukose Querformat"` must be absent.
//   2. Landscape viewport (844×390): Playwright's `setViewportSize` fires
//      a real `resize` event in the browser. The overlay must become visible
//      within the expect timeout.
//   3. Back to portrait (375×812): the overlay disappears again.
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
// The test does NOT assert CGM data content — CGM fetching is network-gated
// and not available in the test environment. Only the presence/absence of
// the overlay wrapper div is checked.

import { expect, test } from "@playwright/test";

const OVERLAY_SELECTOR = '[aria-label="Live-Glukose Querformat"]';

const PORTRAIT  = { width: 375, height: 812 };
const LANDSCAPE = { width: 844, height: 390 };

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
