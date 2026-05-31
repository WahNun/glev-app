// E2E coverage for the IntersectionObserver-based infinite scroll on /entries.
//
// Why this exists:
//   The sentinel div + IntersectionObserver wiring is pure client-side
//   behaviour with no server-visible signal: if the sentinel element is
//   accidentally removed, the observer callback is dropped, or `hasMoreMeals`
//   stops flipping to `true`, users silently stop seeing older entries with
//   zero error messages. This spec catches such regressions before they ship.
//
// How the page works:
//   The entries page loads the most recent 30 days of meals on mount
//   (MEALS_INITIAL_DAYS = 30, limit: Infinity). After that initial fetch it
//   sets `hasMoreMeals = (meals.length > 0)`, which renders a 1px sentinel
//   div at the bottom of the list. An IntersectionObserver (rootMargin: 200px)
//   watches the sentinel; when it enters the viewport the page calls
//   `loadMoreMeals()`, which fetches meals older than `oldestMealCreatedAt`.
//   Once the batch returns fewer than MEALS_PAGE_SIZE (50) rows the page sets
//   `hasMoreMeals = false` and renders the "Alle Einträge geladen" footer.
//   A spinner (aria-label = "Wird geladen…") is shown while the fetch runs.
//
// Seeding strategy:
//   We seed two groups of meals for the test user:
//     • RECENT_COUNT (25) meals dated 1–25 days ago → returned by the initial
//       30-day fetch, making hasMoreMeals=true and the sentinel visible.
//       25 rows × ~70 px ≈ 1 750 px — well below the 720 px viewport so the
//       sentinel cannot auto-trigger at mount time, even with rootMargin=200px.
//     • OLD_COUNT (10) meals dated 40–49 days ago → only reachable via the
//       load-more fetch once the user scrolls to the bottom.
//       10 < MEALS_PAGE_SIZE (50) → `hasMoreMeals` becomes false → footer.
//   Total: 35 meals. Cleanup runs in afterAll to avoid pollution.
//
// What is asserted:
//   1. Translation-key guard: de.json must have history.no_more_entries and
//      history.load_more_loading; fails immediately if keys are renamed.
//   2. Initial render: at least RECENT_COUNT `.entry-row` elements are
//      visible once the page settles (recent batch loaded correctly).
//   3. Spinner: a MutationObserver injected into the page before scrolling
//      records whether the loading spinner ever appeared in the DOM. After
//      the footer is visible we assert the spinner was seen at least once.
//   4. Row-count growth: after scrolling, `.entry-row` count exceeds the
//      initial count — the second page loaded automatically, no button tapped.
//   5. Minimum total: count ≥ RECENT_COUNT + OLD_COUNT (all seeds visible).
//   6. Footer: "Alle Einträge geladen" is visible, confirming hasMoreMeals
//      flipped to false and the sentinel was correctly torn down.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

// ---------------------------------------------------------------------------
// Translation-key guard — fails fast if the spec's i18n keys disappear.
// ---------------------------------------------------------------------------

const DE_MESSAGES = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "messages/de.json"),
    "utf8",
  ),
) as Record<string, Record<string, string>>;

const REQUIRED_DE_KEYS: Array<[namespace: string, key: string]> = [
  ["history", "no_more_entries"],
  ["history", "load_more_loading"],
];

test("messages/de.json contains all infinite-scroll translation keys", () => {
  for (const [ns, key] of REQUIRED_DE_KEYS) {
    expect(
      DE_MESSAGES[ns]?.[key],
      `messages/de.json is missing "${ns}.${key}"`,
    ).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Constants — keep in sync with the seeding strategy in the file header.
// ---------------------------------------------------------------------------

/** Meals seeded within the last 30 days (caught by the initial fetch). */
const RECENT_COUNT = 25;
/** Meals seeded 40–49 days ago (only reachable via load-more scroll). */
const OLD_COUNT = 10;

// ---------------------------------------------------------------------------
// Supabase admin helper
// ---------------------------------------------------------------------------

function getAdminClient() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "entries-infinite-scroll spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Remove all meals for the test user so counts are exact. */
async function resetUserMeals(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("user_id", userId);
  if (error) throw new Error(`meals delete: ${error.message}`);
}

/**
 * Seed RECENT_COUNT meals within last 30 days and OLD_COUNT meals at 40–49
 * days ago. The old batch uses keyset pagination's `before` cursor so it is
 * only fetched after the sentinel triggers — not on initial mount.
 */
async function seedScrollMeals(userId: string) {
  const admin = getAdminClient();
  const now = Date.now();

  const recentMeals = Array.from({ length: RECENT_COUNT }, (_, i) => {
    // 1 day apart starting 1 day ago: 1d, 2d, …, 25d ago.
    const ms = now - (1 + i) * 86_400_000;
    return buildMeal(userId, ms, `scroll-test-recent-${i}`);
  });

  const oldMeals = Array.from({ length: OLD_COUNT }, (_, i) => {
    // 1 day apart starting 40 days ago: 40d, 41d, …, 49d ago.
    const ms = now - (40 + i) * 86_400_000;
    return buildMeal(userId, ms, `scroll-test-old-${i}`);
  });

  const { error } = await admin
    .from("meals")
    .insert([...recentMeals, ...oldMeals]);
  if (error) throw new Error(`meals insert: ${error.message}`);
}

function buildMeal(userId: string, timestampMs: number, label: string) {
  const iso = new Date(timestampMs).toISOString();
  return {
    user_id: userId,
    input_text: label,
    parsed_json: [],
    glucose_before: 110,
    carbs_grams: 40,
    insulin_units: 4,
    meal_type: "BALANCED",
    evaluation: "GOOD",
    meal_time: iso,
    created_at: iso,
  };
}

// ---------------------------------------------------------------------------
// Login / locale helpers (mirrors the pattern used across the suite)
// ---------------------------------------------------------------------------

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

/** Pre-seed NEXT_LOCALE=de so all label assertions match German strings. */
async function setLocaleCookieDe(context: BrowserContext) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: "NEXT_LOCALE",
      value: "de",
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

// ---------------------------------------------------------------------------
// Spinner-tracking helper
//
// Because the loading spinner only exists in the DOM while the network
// round-trip is in flight (typically <500 ms), a naive `isVisible()` poll
// can easily race past it. Instead we inject a MutationObserver *before*
// scrolling that sets a page-global flag the first time the spinner element
// appears. After the footer arrives we read the flag — no race condition.
// ---------------------------------------------------------------------------

const SPINNER_ARIA_LABEL = DE_MESSAGES["history"]["load_more_loading"];

async function installSpinnerTracker(page: Page) {
  await page.evaluate((ariaLabel: string) => {
    (window as unknown as Record<string, unknown>).__spinnerSeen = false;
    const obs = new MutationObserver(() => {
      if (document.querySelector(`[aria-label="${ariaLabel}"]`)) {
        (window as unknown as Record<string, unknown>).__spinnerSeen = true;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    (window as unknown as Record<string, unknown>).__spinnerObserver = obs;
  }, SPINNER_ARIA_LABEL);
}

async function wasSpinnerSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    (w.__spinnerObserver as MutationObserver | undefined)?.disconnect();
    return w.__spinnerSeen as boolean;
  });
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("Entries → infinite scroll", () => {
  let testUserId: string;

  test.beforeAll(async () => {
    testUserId = loadTestUserByIndex(test.info().workerIndex).userId;
    await resetUserMeals(testUserId);
    await seedScrollMeals(testUserId);
  });

  test.afterAll(async () => {
    await resetUserMeals(testUserId);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await setLocaleCookieDe(context);
  });

  test(
    "scrolling to the bottom loads older entries automatically, " +
      "shows the loading spinner, and displays the end-of-list footer " +
      "once all pages are exhausted",
    async ({ page }) => {
      await loginAsTestUser(page, test.info().workerIndex);

      // Navigate to /entries. Clear filters so none of our seeded rows
      // are hidden by a leftover session-storage filter state.
      await page.goto("/entries");
      await page.evaluate(() =>
        sessionStorage.removeItem("glev:entries-filters"),
      );
      await page.reload();

      // ── 1. Initial state: recent meals rendered ──────────────────────────
      // Wait for the page to finish its initial data fetch. We detect "done"
      // by waiting for at least one `.entry-row` to appear.
      await expect(page.locator(".entry-row").first()).toBeVisible({
        timeout: 30_000,
      });

      // Give the full-fetch result (which replaces the fast-5 placeholder)
      // time to settle before we count — otherwise we'd capture an
      // intermediate value and compare it against the wrong baseline.
      await page.waitForTimeout(1_500);

      const initialRowCount = await page.locator(".entry-row").count();
      expect(
        initialRowCount,
        `Expected at least ${RECENT_COUNT} entry rows on initial load`,
      ).toBeGreaterThanOrEqual(RECENT_COUNT);

      // ── 2. Install spinner tracker before any scrolling ──────────────────
      // The MutationObserver records whether the spinner element ever appears
      // in the DOM during the load-more network round-trip. Must be done
      // BEFORE we trigger scrolling so we don't race past the brief flash.
      await installSpinnerTracker(page);

      // ── 3. Scroll to the bottom — sentinel enters viewport ───────────────
      // With RECENT_COUNT (25) rows at ~70 px each ≈ 1 750 px of content,
      // the 1px sentinel is well off-screen at the 720px default viewport.
      // scrollTo(body.scrollHeight) brings the sentinel into view, which
      // triggers the IntersectionObserver callback → `loadMoreMeals()` runs.
      const footerText = DE_MESSAGES["history"]["no_more_entries"];
      const footer = page.getByText(footerText, { exact: true });

      // Scroll in incremental steps until the "Alle Einträge geladen" footer
      // appears. The loop cap (30 iterations × 500 ms ≈ 15 s) is generous
      // enough for the network round-trip while still failing fast when the
      // observer wiring is broken.
      let footerVisible = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await page.evaluate(() =>
          window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
        );
        await page.waitForTimeout(500);

        footerVisible = await footer.isVisible();
        if (footerVisible) break;
      }

      // ── 4. Spinner was seen at least once during load-more ───────────────
      const spinnerSeen = await wasSpinnerSeen(page);
      expect(
        spinnerSeen,
        `The loading spinner ("${SPINNER_ARIA_LABEL}") must appear at least once ` +
          "during the load-more fetch — if it never appears the observer wiring " +
          "may be broken or loadMoreMeals() was never called",
      ).toBe(true);

      // ── 5. More rows appeared (second page loaded) ───────────────────────
      const finalRowCount = await page.locator(".entry-row").count();
      expect(
        finalRowCount,
        "Row count must grow after scrolling — the second page was not loaded",
      ).toBeGreaterThan(initialRowCount);

      // The total must cover at least both seeded batches combined.
      expect(
        finalRowCount,
        `Expected ≥ ${RECENT_COUNT + OLD_COUNT} rows total after scroll`,
      ).toBeGreaterThanOrEqual(RECENT_COUNT + OLD_COUNT);

      // ── 6. "Alle Einträge geladen" footer is visible ─────────────────────
      // This footer renders only when `!hasMoreMeals && meals.length > 0`.
      // Because OLD_COUNT (10) < MEALS_PAGE_SIZE (50) the page sets
      // `hasMoreMeals = false` after the first load-more response — no
      // further pages are expected.
      expect(
        footerVisible,
        `"${footerText}" footer must appear once all pages are exhausted`,
      ).toBe(true);
    },
  );
});
