// End-to-end visual coverage for the /insights swipe pager (Task #331).
//
// Why this test exists:
//   The Insights page recently grew a cockpit-style position indicator
//   (Task #329) and a slot-trimming pass on the swipe pager — a purely
//   visual change with no current snapshot coverage. A lightweight
//   Playwright pixel test prevents accidental regressions when other
//   agents iterate on insight cards (wrong color, misaligned KPI,
//   clipped sparkline, broken FlipCard chrome).
//
// What we cover:
//   * Login as the seeded Playwright test user
//   * Reset preferences + seed a small bundle of meals so the page
//     mounts the SortableCardGrid + InsightsSwipePager rather than
//     the zero-data empty state
//   * For each card in the pager, click its cockpit tab to bring it
//     into focus, wait for the pager height transition to settle,
//     and snapshot the active slot at 393×852 (iPhone 15 Pro logical
//     viewport — matches the marketing mockup phone size already used
//     by tests/e2e/marketing-mockup.spec.ts)
//
// Determinism comes from playwright.config.ts's `toHaveScreenshot`
// defaults (animations disabled, css scale, threshold 0.05 for
// per-pixel YIQ tolerance, 1% maxDiffPixelRatio for sub-pixel
// anti-aliasing) plus a `prepareForSnapshot` step that waits for
// document.fonts.ready and clears any leftover focus / hover state.

import { expect, test, type Page, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "insights-visual spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resetPreferences(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_preferences")
    .delete()
    .eq("user_id", userId);
  if (error && !/does not exist|could not find the table/i.test(error.message)) {
    throw new Error(`user_preferences clear failed: ${error.message}`);
  }
}

/**
 * Seed a small, deterministic bundle of finalised meals so /insights
 * mounts the pager rather than the zero-data empty pane. We use the
 * same shape as tests/e2e/insights-card-reorder.spec.ts so the seeded
 * rows survive the lifecycle "final" gate. We deliberately spread the
 * meals across the last 4 days with GOOD outcomes — that's enough for
 * the time-in-range / GMI / outcome-distribution cards to render real
 * content, while small enough that the "not enough data" cards
 * (variability, patterns, workout) hit their stable empty states.
 */
// Fixed wall-clock anchor for both the seeded meal timestamps and the
// browser clock (installed via page.clock.install below). Pinning to a
// known instant — instead of `Date.now()` — keeps card content
// (time-of-day buckets, 7-day window boundaries, "X days ago" labels)
// pixel-stable across runs regardless of the host's date/timezone.
// Chosen as midday UTC on a Wednesday so the 7-day window comfortably
// straddles all four seed days within the same ISO week.
const FIXED_NOW_MS = Date.parse("2026-05-13T12:00:00.000Z");

async function seedMealsForInsights(userId: string) {
  const admin = getAdminClient();
  const del = await admin.from("meals").delete().eq("user_id", userId);
  if (del.error) throw new Error(`meals reset failed: ${del.error.message}`);

  const DAY_MS = 86_400_000;
  const meals = [0, 1, 2, 3].map((i) => {
    const mealMs = FIXED_NOW_MS - (i + 1) * DAY_MS;
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `insights-visual-seed-${i}`,
      parsed_json: [],
      glucose_before: 100,
      bg_2h: 110,
      bg_2h_at: new Date(bg2hMs).toISOString(),
      glucose_after: 110,
      evaluation: "GOOD",
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 50,
      insulin_units: 4,
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });
  const ins = await admin.from("meals").insert(meals);
  if (ins.error) throw new Error(`meals seed failed: ${ins.error.message}`);
}

async function clearMeals(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("user_id", userId);
  if (error) throw new Error(`meals clear failed: ${error.message}`);
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

/** Wait for fonts + clear focus/hover, mirroring the marketing
 *  mockup spec so per-glyph anti-aliasing and stray focus rings
 *  don't introduce per-run pixel jitter. */
async function prepareForSnapshot(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
  });
}

/** The pager wrapper applies a 220ms height transition when the
 *  active card changes. Wait long enough for that to land before
 *  snapshotting; without this the next card occasionally captures
 *  mid-resize and the screenshot height drifts by a few px. */
async function waitForPagerSettle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

test.use({
  // iPhone 15 Pro logical viewport — matches the marketing mockup
  // phone size and the 393×852 target called out in the task.
  viewport: { width: 393, height: 852 },
  // Pin the German locale (same rationale as marketing-mockup.spec.ts):
  // the Insights copy is locale-resolved by next-intl, so the default
  // Playwright en-US locale would invalidate every snapshot when the
  // suite runs on a developer machine vs. CI.
  locale: "de-DE",
  // Pin the browser timezone too — many Insights cards bucket meals by
  // local day / hour (time-of-day, weekday patterns, 7-day window
  // boundaries). Without a fixed TZ the seeded meals would slide into
  // a different bucket on a host in a different zone (e.g. CI in UTC
  // vs. a dev laptop in Europe/Berlin) and produce false-positive
  // pixel diffs unrelated to a real regression.
  timezoneId: "Europe/Berlin",
});

test.describe("Insights swipe pager — per-card pixel snapshots", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetPreferences(testUser.userId);
    await seedMealsForInsights(testUser.userId);
  });

  test.afterAll(async () => {
    // Leave the seeded user back at defaults so unrelated specs that
    // read /insights or /dashboard don't see leftover seed rows.
    await resetPreferences(testUser.userId);
    await clearMeals(testUser.userId);
  });

  test("snapshots every card in the pager at 393×852", async ({ page }) => {
    // Freeze the browser clock to the same instant the seed timestamps
    // are computed from. Without this, every card that calls `Date.now()`
    // (TIR window, GMI lookback, "X days ago" labels, time-of-day
    // bucketing) would render against the host's wall clock and produce
    // false-positive pixel diffs on every run. `install` must happen
    // before navigation so the first render of /insights sees the fixed
    // time too.
    await page.clock.install({ time: new Date(FIXED_NOW_MS) });

    await loginAsTestUser(page, test.info().workerIndex);
    await page.goto("/insights");

    // The cockpit indicator only mounts once the pager has at least
    // 2 cards — i.e. the page is past the zero-data empty state and
    // useCardOrder's GET has resolved. Anchor on it as the "pager is
    // ready" signal instead of racing the first card render.
    const cockpit = page.locator('[role="tablist"]').first();
    await expect(cockpit).toBeVisible({ timeout: 60_000 });

    // Scope card-slot selection to the pager's scroller (the parent of
    // the cockpit tablist) so any future use of `data-card-id` outside
    // the pager (e.g. SortableCardGrid cells if /insights ever shows
    // both at once) can't shift the index lookup. The pager and the
    // cockpit share the same wrapper, so locating from the cockpit's
    // ancestor is the most direct anchor.
    const pagerRoot = cockpit.locator("xpath=..");
    const slots = pagerRoot.locator('[data-card-id]');

    const tabs = cockpit.locator('[role="tab"]');
    const total = await tabs.count();
    expect(total).toBeGreaterThan(0);

    // Iterate each card slot. We read the active slot's data-card-id
    // (added to the swipe pager wrapper specifically so this test can
    // name snapshots by stable card id rather than by index — index
    // would silently re-bind if INSIGHTS_DEFAULT_ORDER changes).
    for (let i = 0; i < total; i++) {
      await tabs.nth(i).click();
      await waitForPagerSettle(page);

      const slot = slots.nth(i);
      await expect(slot).toBeVisible();
      const cardId = await slot.getAttribute("data-card-id");
      expect(cardId, `slot ${i} is missing data-card-id`).not.toBeNull();

      await prepareForSnapshot(page);
      await expect(slot).toHaveScreenshot(`insights-card-${cardId}.png`);
    }
  });
});
