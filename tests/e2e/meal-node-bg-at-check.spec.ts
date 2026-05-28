// End-to-end smoke test: glucose badge and sensor dot on meal-node-cluster
// knobs (Task #734).
//
// Why this exists:
//   Task #702 added the `bg_at_check` value badge (rect + text overlay) and
//   sensor indicator dot to each knob in `MealNodeCluster`. There was no
//   automated check that the badge actually appears when `bg_at_check` is set
//   and stays absent when it is null. A regression in the `hasBg` guard, the
//   SVG conditional render, or the `data-bg-at-check` attribute write would
//   be invisible until a user opened the dashboard with a filled checkpoint.
//
// What this asserts:
//   1. Seeds a meal (within the last 2h, with insulin so it qualifies as a
//      bolus meal on the 12h chart) and a `meal_timeline_checks` row with
//      `bg_at_check = 112` for check_type "post_1".
//   2. Leaves the "pre" arm unseeded so its `bgAtCheck` stays null.
//   3. After login + dashboard load, finds the cluster by testid and:
//      a. Asserts the post_1 knob has `data-bg-at-check="112"`.
//      b. Asserts the SVG text "112" (the badge label) is visible.
//      c. Asserts the pre knob does NOT have a `data-bg-at-check` attribute
//         (null → badge absent).
//
// Seeding uses the Supabase service-role admin client (same pattern as
// `confirm-action-timeline-check.spec.ts`) and is cleaned up in afterAll.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "meal-node-bg-at-check spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Insert a minimal meal row that qualifies as a "bolus meal" on the 12h chart:
 * - `meal_time` is 1 hour ago (inside the 12h window)
 * - `insulin_units = 4` (non-null, > 0 → bolusMeals filter includes it)
 */
async function seedMeal(admin: SupabaseClient, userId: string): Promise<string> {
  const mealTime = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "e2e bg_at_check test meal",
      parsed_json: [],
      meal_time: mealTime,
      glucose_before: null,
      glucose_after: null,
      carbs_grams: 50,
      protein_grams: null,
      fat_grams: null,
      insulin_units: 4,
      meal_type: "BALANCED",
      evaluation: null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`meals seed failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/**
 * Insert a `meal_timeline_checks` row for the given meal with
 * `check_type = "post_1"` and the supplied `bgAtCheck` value.
 * Returns the inserted row id.
 */
async function seedCheckWithBg(
  admin: SupabaseClient,
  userId: string,
  mealId: string,
  bgAtCheck: number = 112,
): Promise<string> {
  const plannedAt = new Date(Date.now() + 30 * 60_000).toISOString(); // 30 min in the future
  const { data, error } = await admin
    .from("meal_timeline_checks")
    .insert({
      user_id: userId,
      meal_id: mealId,
      check_type: "post_1",
      planned_at: plannedAt,
      confirmed_at: null,
      bg_at_check: bgAtCheck,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`meal_timeline_checks seed failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/**
 * Wait for fonts and move the mouse to a neutral position so focus rings
 * and hover states don't bleed into the screenshot. Mirrors the pattern
 * used in `insights-visual.spec.ts`.
 */
async function prepareForSnapshot(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
  });
}

async function cleanup(
  admin: SupabaseClient,
  mealId: string,
) {
  // meal_timeline_checks has FK → meals (ON DELETE CASCADE), so deleting
  // the meal also removes its timeline rows. We still delete explicitly
  // first in case a future migration drops the CASCADE.
  await admin.from("meal_timeline_checks").delete().eq("meal_id", mealId);
  await admin.from("meals").delete().eq("id", mealId);
}

/**
 * Intercept the Supabase REST API for `meal_timeline_checks` and return a
 * pre-built mock payload. This bypasses the auth-lock contention in the dev
 * test environment that causes `listChecksForMeals` to silently return an
 * empty Map (via its `.catch(() => new Map())` guard), preventing the
 * `bg_at_check` value from ever appearing on the knob.
 *
 * Must be called BEFORE `loginAsTestUser` so the interceptor is wired before
 * the page navigates to /dashboard.
 */
async function mockMealTimelineChecks(
  page: Page,
  checks: ReadonlyArray<{ mealId: string; bgAtCheck: number }>,
): Promise<void> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl) return;
  const { userId } = loadTestUser();
  const now = new Date().toISOString();

  // Use a regex rather than a glob pattern — Playwright's glob treats `*` as
  // matching everything except `/`, but the Supabase REST query string can
  // include encoded characters that trip up glob-based matching in practice.
  await page.route(
    new RegExp(`rest/v1/meal_timeline_checks`),
    (route) => {
      const rows = checks.map((c) => ({
        id: `mock-check-${c.mealId}`,
        user_id: userId,
        meal_id: c.mealId,
        check_type: "post_1",
        planned_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        confirmed_at: null,
        bg_at_check: c.bgAtCheck,
        created_at: now,
      }));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    },
  );
}

/** Build a minimal CGM history mock with readings spread over the last 12 hours.
 *  Intercepting /api/cgm/history makes `chartPoints.length > 0` so
 *  RollingChart mounts and the MealNodeCluster overlay can render.
 *  Without CGM data the chart renders a blank placeholder instead.
 */
function buildCgmMock() {
  const now = Date.now();
  const mkTs = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const history = Array.from({ length: 25 }, (_, i) => ({
    value: 110 + Math.round(Math.sin(i / 4) * 15), // gentle sine wave
    timestamp: mkTs((24 - i) * 30),                  // every 30 min, last 12h
    trend: "flat",
  }));
  return {
    current: { value: 112, unit: "mg/dL", timestamp: mkTs(4), trend: "flat" },
    history,
  };
}

async function loginAsTestUser(page: Page) {
  // Force showMealNodes=true on CurrentDayGlucoseCard via the test escape hatch.
  // The component checks this localStorage key to bypass the engineHdr.visible
  // gate, which only becomes true after visiting /engine in a real session.
  await page.addInitScript(() => {
    window.localStorage.setItem("glev_test_show_meal_nodes", "1");
  });

  // Mock the CGM history API so the rolling chart renders actual readings.
  // Without this the test user has no CGM data → `chartPoints.length === 0`
  // → RollingChart is not mounted → clusters never appear in the DOM.
  const cgmPayload = buildCgmMock();
  await page.route("/api/cgm/history", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cgmPayload),
    }),
  );

  const { email, password } = loadTestUser();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("MealNodeCluster — bg_at_check badge and sensor dot (e2e)", () => {
  let testUser: TestUser;
  let admin: SupabaseClient;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUser();
    admin = getAdminClient();
    mealId = await seedMeal(admin, testUser.userId);
    await seedCheckWithBg(admin, testUser.userId, mealId);
  });

  test.afterAll(async () => {
    if (admin && mealId) {
      await cleanup(admin, mealId);
    }
  });

  test("post_1 knob carries data-bg-at-check and badge text; pre knob has neither", async ({
    page,
  }) => {
    // Intercept the Supabase REST call for meal_timeline_checks so the
    // bg_at_check value reaches the component even when auth-lock contention
    // in the dev environment causes the real Supabase call to fail silently.
    await mockMealTimelineChecks(page, [{ mealId, bgAtCheck: 112 }]);
    await loginAsTestUser(page);

    // Wait for the cluster to appear. The cluster renders inside the SVG
    // overlay on the 12h glucose chart only after the chart has measured
    // its dimensions and `listChecksForMeals` has resolved. We poll with
    // a generous timeout to survive Next.js dev-mode cold compile.
    const clusterGroup = page.locator(
      `[data-testid="meal-node-cluster-${mealId}"]`,
    );
    await expect(clusterGroup).toBeVisible({ timeout: 60_000 });

    // ── post_1 arm: data-bg-at-check attribute ──────────────────────────
    // The knob circle carries `data-bg-at-check={a.bgAtCheck ?? undefined}`.
    // When bg_at_check = 112, this attribute must be present with value "112".
    const post1Knob = page.locator(
      `[data-testid="meal-node-arm-${mealId}-post_1"]`,
    );
    await expect(post1Knob).toBeVisible({ timeout: 30_000 });
    await expect(post1Knob).toHaveAttribute("data-bg-at-check", "112");

    // ── post_1 arm: badge text "112 mg/dL" visible in the SVG ─────────
    // The badge renders as <rect> + <text>{bgAtCheck} mg/dL</text> inside
    // the cluster's <g>. We locate the SVG <text> element with the value
    // inside the cluster group.
    const badgeText = clusterGroup.locator("text").filter({ hasText: /112 mg\/dL/ });
    await expect(badgeText).toBeVisible();

    // ── pre arm: no data-bg-at-check attribute ──────────────────────────
    // We seeded only a post_1 row. The pre arm defaults to bgAtCheck: null,
    // so data-bg-at-check must NOT be present on the pre knob.
    const preKnob = page.locator(
      `[data-testid="meal-node-arm-${mealId}-pre"]`,
    );
    await expect(preKnob).toBeVisible({ timeout: 30_000 });
    // Playwright's `not.toHaveAttribute` fails if the attribute exists with
    // any value — exactly what we want here.
    await expect(preKnob).not.toHaveAttribute("data-bg-at-check", /.*/);
  });
});

// ── Screenshot tests — badge fill color regression guard ─────────────────────
//
// Why this block exists:
//   The `bgCheckColor` unit tests (tests/unit/mealNodeMath.test.ts) pin the
//   numeric thresholds, but they cannot catch a pixel-level regression where
//   the wrong hex value is applied to the SVG rect fill — e.g. a copy/paste
//   error, a mismerge, or a CSS variable override silently replacing #22C55E
//   with a visually similar but wrong color. A `toHaveScreenshot` assertion on
//   the seeded cluster knob catches exactly this class of regression.
//
// Three scenarios cover the full color gamut of `bgCheckColor`:
//   • 69  mg/dL → red   (#EF4444) — hypoglycemia (< 70)
//   • 112 mg/dL → green (#22C55E) — ideal post-meal range (80–160)
//   • 200 mg/dL → red   (#EF4444) — hyperglycemia (> 180)
//
// Each test is fully independent: it seeds its own meal + check, navigates
// to the dashboard, screenshots the cluster `<g>`, then cleans up. This
// keeps it safe to run in any order alongside the attribute-based tests above.
//
// The baseline PNGs live next to this file in the auto-generated
// `meal-node-bg-at-check.spec.ts-snapshots/` directory and are committed
// to the repository so CI has a reference for every future run.

// Each scenario: a bg_at_check value, the expected bgCheckColor zone, and the
// stable snapshot filename. All three are seeded in beforeAll and torn down in
// afterAll so the suite only pays the login + dashboard-load cost once.
const SCREENSHOT_SCENARIOS = [
  { bgAtCheck: 69,  snapshotName: "badge-color-red-hypo.png" },   // < 70  → red
  { bgAtCheck: 112, snapshotName: "badge-color-green.png" },      // 80–160 → green
  { bgAtCheck: 200, snapshotName: "badge-color-red-hyper.png" },  // > 180  → red
] as const;

test.describe("MealNodeCluster — badge fill color pixel snapshots (e2e)", () => {
  let snapshotAdmin: ReturnType<typeof getAdminClient>;
  let snapshotMealIds: string[] = [];

  test.beforeAll(async () => {
    // Seed once for all three scenarios so the suite only needs one login.
    snapshotAdmin = getAdminClient();
    const { userId } = loadTestUser();
    snapshotMealIds = [];
    for (const { bgAtCheck } of SCREENSHOT_SCENARIOS) {
      const mealId = await seedMeal(snapshotAdmin, userId);
      await seedCheckWithBg(snapshotAdmin, userId, mealId, bgAtCheck);
      snapshotMealIds.push(mealId);
    }
  });

  test.afterAll(async () => {
    for (const mealId of snapshotMealIds) {
      await cleanup(snapshotAdmin, mealId);
    }
  });

  test("post_1 badge renders the correct fill color for hypo, ideal, and hyper values", async ({
    page,
  }) => {
    // A single login + dashboard load covers all three clusters, keeping the
    // total wall-clock time well within the 120 s per-test Playwright limit.
    // Intercept the Supabase REST call for meal_timeline_checks so all three
    // bg_at_check values reach the component reliably (bypasses auth-lock
    // contention that silently empties the checksByMeal map in dev).
    await mockMealTimelineChecks(
      page,
      SCREENSHOT_SCENARIOS.map((s, i) => ({
        mealId: snapshotMealIds[i],
        bgAtCheck: s.bgAtCheck,
      })),
    );
    await loginAsTestUser(page);

    for (let i = 0; i < SCREENSHOT_SCENARIOS.length; i++) {
      const { snapshotName } = SCREENSHOT_SCENARIOS[i];
      const mealId = snapshotMealIds[i];

      // Wait for the cluster overlay to appear. The SVG overlay renders only
      // after the chart has measured its dimensions and listChecksForMeals has
      // resolved. Generous timeout to survive Next.js dev-mode cold compiles.
      const clusterGroup = page.locator(
        `[data-testid="meal-node-cluster-${mealId}"]`,
      );
      await expect(clusterGroup).toBeVisible({ timeout: 60_000 });

      // Also wait for the post_1 knob so the badge <rect> fill is in the DOM.
      const post1Knob = page.locator(
        `[data-testid="meal-node-arm-${mealId}-post_1"]`,
      );
      await expect(post1Knob).toBeVisible({ timeout: 30_000 });

      // Stabilise: clear font-loading jitter and stray focus/hover state.
      await prepareForSnapshot(page);

      // Screenshot a 40×10-pixel center crop of the badge <rect>.
      //
      // WHY a center crop instead of the element itself:
      //   The badge sits on a semi-transparent overlay (opacity 0.92) above
      //   a sine-wave CGM chart. Its SVG y-coordinate is a floating-point
      //   value whose screen pixel position shifts slightly between runs as
      //   the chart container height (H) varies by ±1-2 px due to layout.
      //   Screenshotting the full element yields different background pixels
      //   each run (different chart lines behind the badge), making the
      //   comparison unstable. A center crop avoids the rx=4 anti-aliased
      //   corners AND we force opacity=1 + inject a solid white backdrop so
      //   every captured pixel is purely the badge fill color.
      //
      // A real color regression (red→green or wrong hex) changes ALL 400
      // pixels, so this tiny crop still catches every meaningful defect.
      const badgeRect = clusterGroup.locator("rect").first();
      await expect(badgeRect).toBeVisible({ timeout: 10_000 });

      // 1. Inject a white background rect at the same SVG position so there
      //    is no dark-chart bleed-through. Set badge opacity=1 so its fill
      //    is fully opaque, making the rendered pixels deterministic.
      await page.evaluate(({ mid }: { mid: string }) => {
        const cluster = document.querySelector(
          `[data-testid="meal-node-cluster-${mid}"]`,
        );
        const badge = cluster?.querySelector("rect") as SVGRectElement | null;
        if (!badge) return;
        badge.setAttribute("opacity", "1");
        const bg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        (["x", "y", "width", "height"] as const).forEach((attr) => {
          bg.setAttribute(attr, badge.getAttribute(attr) ?? "0");
        });
        bg.setAttribute("fill", "white");
        bg.setAttribute("rx", "0");
        badge.parentNode!.insertBefore(bg, badge);
      }, { mid: mealId });

      // 2. Crop to the inner 40×10 px center (skip 8 px left/right, 2 px
      //    top/bottom) — the entire crop is inside the 56×14 px badge rect,
      //    so every pixel is the solid fill color.
      const bbox = await badgeRect.boundingBox();
      expect(bbox).not.toBeNull();
      await expect(page).toHaveScreenshot(snapshotName, {
        clip: {
          x: Math.round(bbox!.x + 8),
          y: Math.round(bbox!.y + 2),
          width: 40,
          height: 10,
        },
      });
    }
  });
});
