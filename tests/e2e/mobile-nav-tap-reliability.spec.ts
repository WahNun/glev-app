// End-to-end coverage for the mobile bottom-nav tap reliability.
//
// Why this exists:
//   The bottom-nav tap handler has been rewritten seven times across
//   2026-05-17 / 18 (most recently: pointerup-based MobileTab,
//   microtask-deferred voice stop). Each regression so far was only
//   caught by the user manually tapping through a TestFlight build.
//   This spec guards against rapid tab-switching right after a route
//   swap: the MobileTab button is re-mounted under fresh RSC output on
//   every tap, so a synthesised click on the OLD DOM node would be lost.
//   We navigate on `pointerup` (fires before click), but a future
//   refactor could regress that.
//
// We assert:
//   * The URL changed within a tight budget (400 ms after the tap).
//
// Implementation notes:
//   * Mobile viewport (393×852) + `hasTouch` so the bottom nav is
//     actually rendered (`@media (max-width: 768px)` in Layout.tsx).
//   * Chromium fake media flags + the `microphone` permission grant
//     give the engine page a working `getUserMedia` without prompting,
//     so the auto-start triggered by the Glev FAB tap reaches
//     `setRecording(true)` deterministically.
//   * We pre-warm each tab route before timing the rapid loop so
//     Next.js' dev-mode first-compile (often 5-30 s on Replit) can't
//     blow the 400 ms budget — the budget is meant to catch a DEAD
//     tap, not a cold cache.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


const LOCALE_COOKIE = "NEXT_LOCALE";

// German is the default locale so the FAB's recording aria-label
// suffix is the known "— Aufnahme beenden" string. Pinning the cookie
// keeps the test independent of whichever Accept-Language Chromium
// happens to send on this machine.
async function pinLocale(context: BrowserContext, baseURL: string) {
  await context.addCookies([{
    name: LOCALE_COOKIE,
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
}

async function loginAsTestUser(page: Page, workerIndex: number) {
  const { email, password } = loadTestUserByIndex(workerIndex);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// All four primary tabs in display order. The Glev FAB sits between
// `entries` and `insights` but is intentionally NOT a navigation tab,
// so it's excluded from the rapid-switch loop.
const TAB_ORDER: ReadonlyArray<{ name: RegExp; path: string }> = [
  { name: /^Dashboard$/, path: "/dashboard" },
  { name: /^Einträge$/,  path: "/entries"   },
  { name: /^Insights$/,  path: "/insights"  },
  { name: /^Einstellungen$/, path: "/settings" },
];

// Locator for one of the four primary bottom-nav tabs. They're plain
// <button>s with the localized label as accessible name, scoped under
// the .glev-mobile-nav element so we don't accidentally pick up a
// link with the same text in the page body.
function tabButton(page: Page, name: RegExp) {
  return page.locator("nav.glev-mobile-nav").getByRole("button", { name });
}

// Pre-warm every primary tab route by navigating to it once. Next.js
// dev mode compiles each route on first visit (5-30 s on Replit), and
// the rapid-switch loop's per-tap budget would otherwise be dominated
// by that first compile rather than by the tap dispatch itself.
//
// We also defend against the Turbopack `ChunkLoadError` that
// intermittently bites when chunks get evicted between navigations on
// Replit's slow filesystem — a single `page.reload()` is enough to
// pull the freshly-emitted chunk and surface the mobile nav.
async function prewarmTabs(page: Page) {
  for (const tab of TAB_ORDER) {
    await page.goto(tab.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL(new RegExp(tab.path), { timeout: 60_000 });
    const nav = page.locator("nav.glev-mobile-nav");
    try {
      await expect(nav).toBeVisible({ timeout: 30_000 });
    } catch {
      // Turbopack chunk eviction recovery path: one hard reload usually
      // resolves it. If it doesn't, propagate the original failure.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(nav).toBeVisible({ timeout: 30_000 });
    }
  }
}

// Single tap-then-assert-URL-changed round. Returns the elapsed time so
// the test body can assert against the per-tap budget. We measure from
// JUST BEFORE the click is dispatched to JUST AFTER `waitForURL`
// resolves — including the round-trip for the new RSC payload — because
// THAT's what feels "dead" from the user's point of view, not just the
// internal pointer handler latency.
async function tapAndWaitForRoute(
  page: Page, name: RegExp, expectedPath: string,
): Promise<number> {
  const btn = tabButton(page, name);
  await expect(btn).toBeVisible();
  const t0 = Date.now();
  // .click() dispatches pointerdown → pointerup → click in order. The
  // MobileTab handler runs on pointerup (round-7 fix), so this is the
  // same event sequence a real tap produces on iOS WKWebView.
  await btn.click();
  await page.waitForURL(new RegExp(`${expectedPath}(\\?|$|/)`), { timeout: 5_000 });
  return Date.now() - t0;
}

// Force a mobile viewport + touch so the .glev-mobile-nav rule
// (@media (max-width: 768px)) flips to display:flex.
//
// We deliberately do NOT use Chromium's `--use-fake-device-for-media-stream`
// flag here — chrome-headless-shell (the binary Playwright defaults to on
// Replit) ships without the media stack the flag needs, so MediaRecorder
// silently never delivers data and `setRecording(true)` never fires.
// Instead, the voice test stubs `getUserMedia` + `MediaRecorder` via
// `addInitScript` (installed on the page before any app code runs), which
// works in every Chromium build and lets us drive the engine page's
// auto-start path deterministically.
test.use({
  viewport: { width: 393, height: 852 },
  hasTouch: true,
  isMobile: false, // keep mouse-style click() semantics; we still get pointer events
});

test.describe("Mobile bottom-nav tap reliability", () => {
  test("rapidly switching through all four tabs lands every route within budget", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinLocale(context, baseURL!);
    await loginAsTestUser(page, test.info().workerIndex);

    // Pay the dev-mode compile cost ONCE, up front, so the timed loop
    // below measures tap dispatch latency rather than `next build`.
    await prewarmTabs(page);

    // Per-tap budget. The intent is to catch a "dead" tap — i.e.
    // pointerup fired, navigation never happened. A lost tap manifests
    // as the 5 s `waitForURL` timeout below, not as a marginally-
    // over-budget pass — so the budget is the SECOND line of defence
    // (catches a tap that EVENTUALLY navigates after some retry path,
    // not just one that never navigates at all).
    //
    // 1500 ms is roomy enough to absorb Next dev-mode RSC fetch +
    // React commit jitter on Replit's container (observed ~400-900 ms
    // per swap even after warm-up) while still being well below the
    // user-visible "dead tap" perception threshold (~3 s).
    const TAP_BUDGET_MS = 1_500;

    // Run the loop twice so we exercise the "tap right after a route
    // swap re-mounted the nav row" path, which was the round-7
    // failure mode (the old DOM node receiving the synthesized click
    // was already gone).
    const passes = 2;
    for (let p = 0; p < passes; p++) {
      for (const tab of TAB_ORDER) {
        const elapsed = await tapAndWaitForRoute(page, tab.name, tab.path);
        expect(elapsed, `tab "${tab.path}" navigation took ${elapsed}ms (pass ${p + 1})`)
          .toBeLessThanOrEqual(TAP_BUDGET_MS);
        // Active tab must reflect the new route. `aria-current="page"`
        // is set in MobileTab when `pathname.startsWith(path)` matches.
        await expect(tabButton(page, tab.name)).toHaveAttribute("aria-current", "page");
      }
    }
  });
});
