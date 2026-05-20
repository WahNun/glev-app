// End-to-end coverage for footer clearance on every main screen.
//
// Why this exists:
//   Task #382 raised the web footer's bottom padding floor from 4 px to
//   16 px (via --nav-bottom-safe). --nav-bottom-total grew by ~12 px on
//   web, and .glev-main's bottom scroll padding is derived from that
//   variable (`calc(var(--nav-bottom-total) + 8px)` in Layout.tsx).
//   If any screen forgets to use that padding — or overrides it with an
//   inline style that's too small — its last card or CTA button will sit
//   partially or fully hidden behind the fixed bottom nav bar.
//
// What this asserts:
//   1. After scrolling .glev-main to its very bottom, no interactive element
//      INSIDE the main scroll area has its bottom edge below the top edge of
//      the fixed nav bar. We check five screens: Dashboard, Entries, Engine,
//      Insights, Settings.
//   2. The --nav-bottom-total CSS variable matches the rendered nav bar
//      height within ±2 px (single-source-of-truth sanity check).
//
// Implementation notes:
//   * 390×844 mobile viewport + hasTouch so the @media (max-width: 768px)
//     rule in Layout.tsx fires and the bottom nav is actually rendered.
//   * We scroll via JS on the .glev-main element (the real scroll container
//     on mobile — the document itself is position:fixed on mobile to prevent
//     WKWebView rubber-band bounce).
//   * Interactive element lookup is scoped to DESCENDANTS of .glev-main
//     so the nav bar's own buttons are never counted.
//   * All five routes are pre-warmed once before assertions so Next.js
//     dev-mode compilation time doesn't inflate per-screen check times.
//   * Both assertions share a single login session (one context.clearCookies
//     + login) to avoid the 60 s login overhead per test.

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

const SCREENS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Entries",   path: "/entries"   },
  { name: "Engine",    path: "/engine"    },
  { name: "Insights",  path: "/insights"  },
  { name: "Settings",  path: "/settings"  },
];

// Scroll .glev-main to its very bottom and return the number of
// interactive elements INSIDE .glev-main whose bottom edge bleeds below
// the nav bar top. Scoping to .glev-main descendants is critical — the
// nav bar itself contains buttons and those should not be counted.
async function countElementsBehindNav(page: Page): Promise<{
  overlapCount: number;
  navTop: number;
  scrolledToBottom: boolean;
  clippedLabels: string[];
}> {
  // Scroll the mobile scroll container to the very bottom.
  const scrolledToBottom = await page.locator(".glev-main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 2;
  });

  // Give the browser a moment to repaint after the scroll.
  await page.waitForTimeout(200);

  // Get the nav bar's top edge in viewport coordinates.
  const nav = page.locator("nav.glev-mobile-nav");
  const navBox = await nav.boundingBox();
  if (!navBox) {
    throw new Error("nav.glev-mobile-nav not found or not visible");
  }
  const navTop = navBox.y;

  // Count interactive elements INSIDE .glev-main whose bottom edge is
  // below the nav top. Only elements currently visible in the viewport
  // (height > 0, bottom > 0) are considered — off-screen elements don't
  // false-positive. We also collect short labels for error messages.
  const { overlapCount, clippedLabels } = await page.evaluate((navTopPx) => {
    const main = document.querySelector(".glev-main");
    if (!main) return { overlapCount: 0, clippedLabels: [] };

    const candidates = main.querySelectorAll<Element>([
      "button",
      'a[href]',
      'input:not([type="hidden"])',
      "select",
      "textarea",
      '[role="button"]',
    ].join(","));

    let overlapCount = 0;
    const clippedLabels: string[] = [];

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Skip invisible or fully above-viewport elements.
      if (rect.height === 0 || rect.width === 0) continue;
      if (rect.bottom <= 0) continue;
      // Flag any element whose bottom edge is below the nav top edge.
      // +1 px tolerance covers sub-pixel rounding differences.
      if (rect.bottom > navTopPx + 1) {
        overlapCount++;
        const label =
          (el as HTMLElement).textContent?.trim().slice(0, 40) ||
          el.getAttribute("aria-label") ||
          el.tagName.toLowerCase();
        clippedLabels.push(`"${label}" (bottom=${Math.round(rect.bottom)}px)`);
      }
    }
    return { overlapCount, clippedLabels };
  }, navTop);

  return { overlapCount, navTop, scrolledToBottom, clippedLabels };
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: false, // keep mouse-style click() semantics for login form
});

test.describe("Footer clearance — content must not hide behind bottom nav", () => {
  // Shared login: clear cookies once, login once, then reuse the session
  // for all checks in this describe block.
  test.beforeEach(async ({ context, baseURL }) => {
    await context.clearCookies();
    await context.addCookies([{
      name: "NEXT_LOCALE",
      value: "de",
      url: baseURL!,
      sameSite: "Lax",
    }]);
  });

  test("each main screen scrolls to bottom without clipping content behind the nav", async ({ page }) => {
    await loginAsTestUser(page);

    // Pre-warm all five routes so Next.js dev-mode compilation happens
    // before the timed assertions below.
    for (const screen of SCREENS) {
      await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForURL(new RegExp(screen.path), { timeout: 60_000 });
      const nav = page.locator("nav.glev-mobile-nav");
      try {
        await expect(nav).toBeVisible({ timeout: 30_000 });
      } catch {
        // Turbopack chunk eviction recovery — one reload is usually enough.
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
        await expect(nav).toBeVisible({ timeout: 30_000 });
      }
    }

    // Assert clearance on each screen.
    for (const screen of SCREENS) {
      await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForURL(new RegExp(screen.path), { timeout: 60_000 });
      await expect(page.locator(".glev-main")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("nav.glev-mobile-nav")).toBeVisible({ timeout: 15_000 });

      // Give dynamic content (seeded data, charts, async RSC) a moment.
      await page.waitForTimeout(600);

      const { overlapCount, navTop, scrolledToBottom, clippedLabels } =
        await countElementsBehindNav(page);

      expect(
        overlapCount,
        `[${screen.name}] ${overlapCount} element(s) hidden behind nav (navTop=${navTop}px, scrolledToBottom=${scrolledToBottom}): ${clippedLabels.join(", ")}`,
      ).toBe(0);
    }
  });

  test(".glev-main padding-bottom meets the --nav-bottom-total + 8px floor on every screen", async ({ page }) => {
    await loginAsTestUser(page);

    for (const screen of SCREENS) {
      await page.goto(screen.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForURL(new RegExp(screen.path), { timeout: 60_000 });
      await expect(page.locator(".glev-main")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("nav.glev-mobile-nav")).toBeVisible({ timeout: 15_000 });

      // Allow dynamic content / CSS variables to settle.
      await page.waitForTimeout(300);

      const { paddingBottomPx, navBottomTotalPx, meetsFloor } = await page.evaluate(() => {
        // Resolve --nav-bottom-total to a plain pixel number using a probe
        // element (the same technique used by the CSS-variable sanity test).
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;visibility:hidden;height:var(--nav-bottom-total)";
        document.body.appendChild(probe);
        const navBottomTotalPx = parseFloat(getComputedStyle(probe).height);
        document.body.removeChild(probe);

        // Read the COMPUTED padding-bottom of .glev-main so inline-style
        // overrides (e.g. `padding-bottom: 10px !important` injected by a
        // page-level <style> block) are reflected in the value we check.
        const main = document.querySelector(".glev-main") as HTMLElement | null;
        const paddingBottomPx = main
          ? parseFloat(getComputedStyle(main).paddingBottom)
          : 0;

        // Floor: nav height + 8 px buffer (matches Layout.tsx definition).
        const floor = navBottomTotalPx + 8;
        // 1 px tolerance for sub-pixel rounding.
        return { paddingBottomPx, navBottomTotalPx, meetsFloor: paddingBottomPx >= floor - 1 };
      });

      expect(
        meetsFloor,
        `[${screen.name}] .glev-main padding-bottom (${paddingBottomPx}px) is below the required floor of --nav-bottom-total (${navBottomTotalPx}px) + 8px = ${navBottomTotalPx + 8}px. A page-level style override may be zeroing out footer clearance.`,
      ).toBe(true);
    }
  });

  test("--nav-bottom-total CSS variable matches the rendered nav bar height", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.locator("nav.glev-mobile-nav")).toBeVisible({ timeout: 30_000 });

    // Read the --nav-bottom-total CSS variable resolved pixel value.
    // getPropertyValue on a custom property returns the literal CSS text
    // (e.g. "calc(56px + 4px + 16px)") which parseFloat can't handle.
    // Instead we create a throw-away element, set its height to the
    // variable, and read the resolved computed height — guaranteed to
    // be a plain pixel number.
    const cssNavTotal = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;height:var(--nav-bottom-total)";
      document.body.appendChild(probe);
      const px = parseFloat(getComputedStyle(probe).height);
      document.body.removeChild(probe);
      return px;
    });

    // Read the actual rendered height of the nav bar element.
    const navBox = await page.locator("nav.glev-mobile-nav").boundingBox();
    expect(navBox).not.toBeNull();
    const renderedNavHeight = navBox!.height;

    // Allow ±2 px for sub-pixel rounding across different platforms.
    expect(
      Math.abs(renderedNavHeight - cssNavTotal),
      `--nav-bottom-total (${cssNavTotal}px) should match rendered nav height (${renderedNavHeight}px)`,
    ).toBeLessThanOrEqual(2);
  });
});
