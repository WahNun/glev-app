// End-to-end coverage for the Insights card reorder flow (Task #327).
//
// Why this exists:
//   The Insights page uses the same `useCardOrder("insights", …)` hook
//   (lib/cardOrder.ts) that drives the dashboard cluster reorder, but
//   with a different DnD wrapper (SortableCardGrid, iOS-home-screen
//   long-press model) and a separate `insights_card_order` persistence
//   key on user_preferences. Task #323 covered the dashboard side; this
//   spec is the matching guard for Insights so a regression in the
//   default order, the long-press → drag interaction, or the
//   `insights_card_order` GET/POST round-trip is caught before the
//   user sees it.
//
// What this asserts (and why each piece matters):
//   * Default order on a fresh user: the first three cards top-to-bottom
//     are time-in-range → gmi-a1c → glucose-trend, mirroring
//     `INSIGHTS_DEFAULT_ORDER` in app/(protected)/insights/page.tsx.
//     Flipping that constant silently would re-arrange the user's first
//     screen.
//   * Long-pressing the second card and dragging it above the first
//     reorders the two visible cards in-memory (SortableCardGrid's
//     500ms activation delay + dnd-kit arrayMove path).
//   * After a hard reload the new order persists — this exercises the
//     `/api/preferences` POST with `insights_card_order` and the
//     subsequent GET on the next mount.
//
// We deliberately drive through the real login flow rather than
// seeding cookies so the test catches regressions between login →
// middleware → /insights mount → useCardOrder GET → long-press drag
// → POST → next-load GET.

import { expect, test, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "insights-card-reorder spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Drop the user's `user_preferences` row so /insights mounts with the
 * built-in default card order. Mirror the dashboard spec's
 * "tolerate missing table" stance — the GET handler soft-falls for the
 * same reason — and surface real errors so a regression is observable.
 */
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
 * /insights short-circuits to a single empty-state pane when the user
 * has zero meals (see the `if (total === 0)` early return in
 * app/(protected)/insights/page.tsx). The sortable grid is only mounted
 * for users with at least one meal, so we seed a handful of recent
 * GOOD-outcome rows before driving the reorder. Mirrors the seeding
 * pattern in tests/e2e/icr-source-split.spec.ts so the rows survive
 * the lifecycle "final" gate without depending on the +3h CGM curve.
 */
async function seedMealsForInsights(userId: string) {
  const admin = getAdminClient();
  // Clear any pre-existing meals for this user so the seed count is
  // deterministic across re-runs and unrelated tests don't poison the
  // window.
  const del = await admin.from("meals").delete().eq("user_id", userId);
  if (del.error) throw new Error(`meals reset failed: ${del.error.message}`);

  const DAY_MS = 86_400_000;
  const meals = [0, 1, 2, 3].map((i) => {
    const mealMs = Date.now() - (i + 1) * DAY_MS;
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `insights-reorder-seed-${i}`,
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

// The first three Insights cards per INSIGHTS_DEFAULT_ORDER. We pin
// these (not all 17) because they're the ones the user actually sees
// above the fold and the ones we drag in the test — keeping the spec
// tight to what it asserts. Adding/removing cards later in the list
// shouldn't churn this test.
const TOP_CARDS = ["time-in-range", "gmi-a1c", "glucose-trend"] as const;

/**
 * Locate a SortableCardGrid cell by the `data-card-id` attribute we
 * stamp on every cell wrapper in components/SortableCardGrid.tsx. This
 * is the only stable, locale-independent identifier — card labels are
 * translated and the visible IDs change with `useTranslations`, so
 * relying on heading text would make this spec flake based on the
 * runtime Accept-Language header.
 */
function cell(page: Page, id: string): Locator {
  return page.locator(`[data-card-id="${id}"]`);
}

/**
 * Return the cell IDs in their current visible order, computed from
 * the y-coordinates of their bounding boxes (same approach as the
 * dashboard reorder spec). dnd-kit applies a CSS transform during a
 * drag and the DOM order updates only after parent state propagates,
 * so reading from boxes is the most direct "what the user sees"
 * signal.
 */
async function getCardOrder(page: Page, ids: readonly string[]): Promise<string[]> {
  const items: Array<{ id: string; y: number }> = [];
  for (const id of ids) {
    const el = cell(page, id);
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    if (!box) throw new Error(`card ${id} has no bounding box`);
    items.push({ id, y: box.y });
  }
  items.sort((a, b) => a.y - b.y);
  return items.map(i => i.id);
}

/**
 * Drive a SortableCardGrid long-press drag from `source` to `target`.
 * The PointerSensor uses
 *   activationConstraint: { delay: 500, tolerance: 5 }
 * (see components/SortableCardGrid.tsx) so we have to (a) press,
 * (b) hold past the 500ms delay without moving more than 5px,
 * (c) then move past the target. `page.dragTo()` skips the hold and
 * never activates the drag.
 *
 * We aim well above the target's top edge so the moving item's centre
 * clears the target's centre, which is what dnd-kit's closestCenter
 * collision detection compares against.
 */
async function dragCardAbove(source: Locator, target: Locator) {
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error("drag source/target not laid out");

  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y - tBox.height;

  const page = source.page();
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Hold past the 500ms activation delay without exceeding the 5px
  // tolerance so the sensor arms.
  await page.waitForTimeout(600);
  // First post-arm move kicks the drag into "active" state; subsequent
  // moves do the actual translation. `steps` lets dnd-kit's measuring
  // loop see intermediate positions and update the collision target.
  await page.mouse.move(sx, sy - 8, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
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

test.describe("Insights card reorder", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetPreferences(testUser.userId);
    await seedMealsForInsights(testUser.userId);
  });

  test.afterAll(async () => {
    // Leave the test user back at defaults so unrelated specs that
    // read /insights aren't surprised by a reordered layout or by
    // leftover seed meals.
    await resetPreferences(testUser.userId);
    await clearMeals(testUser.userId);
  });

  test("default order is spec'd and a drag persists across reload", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/insights");

    // Wait for the top-of-list card to render — proves the SortableCardGrid
    // has mounted and useCardOrder's GET has resolved (the items render
    // unconditionally once `loading` is false; meals seeded by the
    // dashboard's data-seed path are already present from earlier specs
    // / from prior runs of this same test).
    await expect(cell(page, "time-in-range")).toBeVisible({ timeout: 30_000 });
    for (const id of TOP_CARDS) {
      await expect(cell(page, id)).toBeVisible();
    }

    // ---- DEFAULT ORDER -----------------------------------------
    expect(await getCardOrder(page, TOP_CARDS)).toEqual([
      "time-in-range", "gmi-a1c", "glucose-trend",
    ]);

    // ---- DRAG GMI/A1C ABOVE TIME-IN-RANGE -----------------------
    // Wait for the debounced POST that follows the drag so we know
    // the new order has been persisted before the reload races
    // against the useCardOrder GET on the next page load. The hook
    // debounces by 250ms, so a `waitForResponse` is more robust
    // than a fixed sleep.
    const savePost = page.waitForResponse(
      r => r.url().includes("/api/preferences")
        && r.request().method() === "POST"
        && r.ok(),
      { timeout: 20_000 },
    );

    await dragCardAbove(cell(page, "gmi-a1c"), cell(page, "time-in-range"));

    // In-memory state: gmi-a1c is now above time-in-range.
    await expect.poll(
      () => getCardOrder(page, TOP_CARDS),
      { timeout: 10_000 },
    ).toEqual(["gmi-a1c", "time-in-range", "glucose-trend"]);

    // SortableCardGrid only flushes the new order on `exitEditMode`
    // (a document-level pointerdown outside any card OR an Escape
    // keypress — see the keydown branch in
    // components/SortableCardGrid.tsx). The drag itself updates
    // `working` state but does NOT call `onOrderChange`, so without
    // this no POST is ever issued. We use Escape rather than a
    // coordinate-based click because it's a deterministic, layout-
    // independent way to trigger the exit handler and won't go stale
    // if the shell chrome ever shifts.
    await page.keyboard.press("Escape");

    // Verify the POST actually went out AND carried `insights_card_order`
    // (not `dashboard_card_order` — the two share a route and a bug
    // in lib/cardOrder.ts that wrote the wrong key would otherwise
    // pass an in-memory-only check).
    const resp = await savePost;
    const body = resp.request().postDataJSON() as { insights_card_order?: string[] };
    expect(Array.isArray(body.insights_card_order)).toBe(true);
    expect(body.insights_card_order?.slice(0, 3)).toEqual([
      "gmi-a1c", "time-in-range", "glucose-trend",
    ]);

    // ---- PERSISTENCE ACROSS RELOAD -----------------------------
    // /insights renders cards with the default order on first paint,
    // then `useCardOrder`'s GET resolves and the saved order is
    // applied. Poll the visible order rather than asserting once so
    // the check waits past that re-render rather than racing it.
    await page.reload();
    await expect(cell(page, "time-in-range")).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => getCardOrder(page, TOP_CARDS),
      { timeout: 10_000 },
    ).toEqual(["gmi-a1c", "time-in-range", "glucose-trend"]);
  });
});
