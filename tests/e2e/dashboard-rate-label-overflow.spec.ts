// Regression guard for Rate Triplet card label truncation (Task #556).
//
// Why this test exists:
//   Task #554 fixed `RateTripletCard` labels being silently clipped
//   ("GOOD RA…") because the label divs had `whiteSpace: "nowrap"` +
//   `overflow: "hidden"` + `textOverflow: "ellipsis"`. Those properties
//   were removed. This spec guards against them — or any other CSS
//   tweak (font-size bump, letter-spacing increase, narrower grid
//   column) — re-introducing the truncation.
//
// What this asserts:
//   * Viewport is set to 375 × 812 px (typical iPhone SE / iPhone 8
//     logical size) — the smallest common portrait viewport where
//     the 3-column triplet has the least horizontal room.
//   * All three rate-card label divs are present in the DOM.
//   * None of them is overflowing its container (scrollWidth <=
//     offsetWidth), which is the browser-level invariant broken when
//     overflow:hidden clips text.
//   * None of them contains a Unicode ellipsis character ("…" U+2026
//     or "..." three dots) — a second-layer check in case JS adds
//     a truncation suffix.
//   * The full text content of each label equals the expected string
//     (case-insensitive), confirming no characters were swallowed.
//
// Locale note: "Good Rate", "Spike Rate" and "Hypo Rate" are identical
// in both de and en translation files, so the assertions don't need a
// locale branch.

import { expect, test, type Page } from "@playwright/test";
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

// The three labels as they appear in the translation files (both locales
// use the same strings). CSS text-transform: uppercase is a visual-only
// transform — the DOM text node still holds the mixed-case value.
const RATE_LABELS = ["Good Rate", "Spike Rate", "Hypo Rate"] as const;

async function assertNoOverflow(page: Page, viewport: string) {
  await expect(page.locator(".glev-stat-card").first()).toBeVisible({
    timeout: 20_000,
  });

  for (const labelText of RATE_LABELS) {
    const labelDiv = page
      .locator(".glev-stat-card")
      .getByText(labelText, { exact: true })
      .first();

    await expect(labelDiv).toBeVisible();

    // 1. No overflow: scrollWidth must not exceed offsetWidth.
    //    When overflow:hidden + nowrap clip the text, scrollWidth > offsetWidth.
    const isOverflowing = await labelDiv.evaluate(
      (el) => el.scrollWidth > el.offsetWidth,
    );
    expect(
      isOverflowing,
      `"${labelText}" label overflows its container at ${viewport} — ` +
        `check for whiteSpace:nowrap or overflow:hidden on the label div`,
    ).toBe(false);

    // 2. No ellipsis character injected via textOverflow:ellipsis or JS.
    const text = await labelDiv.textContent() ?? "";
    expect(
      text.includes("…") || text.includes("..."),
      `"${labelText}" label text contains an ellipsis ("${text}") at ${viewport} — ` +
        `overflow truncation is active`,
    ).toBe(false);

    // 3. Full text is present (no characters swallowed).
    expect(text.trim().toLowerCase()).toBe(labelText.toLowerCase());
  }
}

test.describe("Rate Triplet card labels — no overflow at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("all three rate labels are fully visible without clipping", async ({ page }) => {
    await loginAsTestUser(page);
    await assertNoOverflow(page, "375×812");
  });
});

test.describe("Rate Triplet card labels — no overflow at 768 px (tablet)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("all three rate labels are fully visible without clipping", async ({ page }) => {
    await loginAsTestUser(page);
    await assertNoOverflow(page, "768×1024");
  });
});
