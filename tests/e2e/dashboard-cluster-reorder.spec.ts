// End-to-end coverage for the dashboard cluster reorder flow (Task #320 → #323 → #639).
//
// Why this exists:
//   Task #320 re-introduced drag-to-reorder for the dashboard
//   clusters using the existing `useCardOrder("dashboard", …)` hook
//   + a per-cluster grip handle in the section header. Task #329
//   subsequently collapsed the layout from five clusters down to
//   four (Glucose, Metabolic, Control, Recents) — Metabolic merges
//   the old "macros" + "rates" sections and Control replaces
//   "score-trend". Task #639 added the "Insulin & IOB" cluster
//   between Control and Recents, making it five clusters again.
//   This spec now covers all five.
//   The persistence path goes:
//     grip drag → dnd-kit arrayMove → setOrder(...) → POST
//     /api/preferences → upsert into `user_preferences` → on next
//     load GET /api/preferences seeds the order before render.
//   A regression in any of those layers (handle aria-label changes
//   and stops being found, debounce timer never fires, POST body
//   shape drifts, default order ID list silently re-shuffled) would
//   only be caught visually today. This spec drives the real flow
//   end-to-end so each piece is guarded.
//
// What this asserts (and why each piece matters):
//   * Default order on a fresh user: Glucose → Metabolic → Control →
//     Insulin → Recents. This pins both the
//     `DASHBOARD_CLUSTER_DEFAULT_ORDER` constant and the cluster
//     declaration order — flipping either silently would land users
//     on a different first screen and we'd never know.
//   * Dragging the Metabolic grip above the Glucose grip reorders
//     the two visible sections (in-memory state proven by reading
//     the section positions immediately after the drag).
//   * After a hard reload, the new order persists — this is the
//     part that actually depends on the network round-trip
//     (`/api/preferences` POST + GET) and the `user_preferences`
//     row being written + read back correctly. An in-memory only
//     bug (e.g. the POST silently dropping the dashboard key, or
//     the GET soft-falling to defaults) would fail here.
//
// We deliberately drive the picker through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → dashboard mount → useCardOrder GET →
// dnd-kit drag → POST → next-load GET.

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
      "dashboard-cluster-reorder spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Drop the user's `user_preferences` row so the dashboard mounts with
 * the built-in default cluster order. We tolerate "table missing"
 * because the GET handler does the same soft-fall, and otherwise
 * surface the error so a real failure is observable.
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

// Locale-agnostic cluster title regexes — the default app locale is
// "de" but Playwright's Chromium reports an English Accept-Language
// header, so either translation can win at runtime depending on the
// environment. Each regex matches the exact `aria-label` we set on
// the cluster `<section>` (see `DashboardCluster` in
// `app/(protected)/dashboard/page.tsx`).
const CLUSTER_LABELS: Array<{ id: string; re: RegExp }> = [
  { id: "glucose",   re: /^(Glucose|Glukose)$/ },
  { id: "metabolic", re: /^(Metabolic response|Metabolische Antwort)$/ },
  { id: "control",   re: /^(Control|Kontrolle)$/ },
  { id: "insulin",   re: /^Insulin & IOB$/ },
  { id: "recents",   re: /^(Recents|Zuletzt)$/ },
];

const GRIP_ARIA = /^(Drag to reorder section|Zum Umsortieren ziehen)$/;

/**
 * Return the cluster IDs in their current visible order, computed from
 * the y-coordinates of the section bounding boxes. We sort by `y`
 * rather than DOM order because dnd-kit applies a CSS transform
 * during/after a drag — the DOM order updates only after the parent
 * state propagates, so reading from boxes is the most direct
 * "what the user sees" signal.
 */
async function getClusterOrder(page: Page): Promise<string[]> {
  const items: Array<{ id: string; y: number }> = [];
  for (const { id, re } of CLUSTER_LABELS) {
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { level: 2, name: re }),
    });
    await expect(section).toBeVisible();
    const box = await section.boundingBox();
    if (!box) throw new Error(`cluster ${id} has no bounding box`);
    items.push({ id, y: box.y });
  }
  items.sort((a, b) => a.y - b.y);
  return items.map(i => i.id);
}

/**
 * Drive a dnd-kit pointer drag from `source` to `target`. The
 * PointerSensor on the dashboard uses
 *   activationConstraint: { delay: 280, tolerance: 5 }
 * so we have to (a) press, (b) hold past the 280ms delay without
 * moving more than 5px, (c) then move past the target. Doing
 * `page.dragTo()` skips the hold and never activates the drag.
 *
 * We also nudge slightly past the target's top edge so dnd-kit's
 * closestCenter collision detection picks the target cluster, then
 * release.
 */
async function dragClusterAbove(source: Locator, target: Locator) {
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error("drag source/target not laid out");

  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const tx = tBox.x + tBox.width / 2;
  // Aim well above the target's top edge so the moving item's
  // centre clears the target's centre, which is what
  // closestCenter compares against.
  const ty = tBox.y - tBox.height;

  const page = source.page();
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Hold past the 280ms activation delay without exceeding the 5px
  // tolerance so the sensor arms.
  await page.waitForTimeout(350);
  // First post-arm move kicks the drag into "active" state; subsequent
  // moves do the actual translation. Use `steps` so dnd-kit's
  // measuring loop sees intermediate positions and updates the
  // collision target progressively.
  await page.mouse.move(sx, sy - 8, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 20 });
  // Brief settle before release so the drop animation starts from
  // the right collision target.
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

test.describe("Dashboard cluster reorder", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetPreferences(testUser.userId);
  });

  test.afterAll(async () => {
    // Leave the test user back at defaults so unrelated specs that
    // read /dashboard aren't surprised by a reordered layout.
    await resetPreferences(testUser.userId);
  });

  test("default order is spec'd and a drag persists across reload", async ({ page }) => {
    await loginAsTestUser(page);

    // Wait for at least one grip handle to render — that's the
    // signal the cluster list has mounted and useCardOrder has
    // resolved (loaded === true happens in the same render tick
    // as the cluster headers either way; the section is rendered
    // unconditionally so this is purely a "page hydrated" gate).
    const grips = page.getByRole("button", { name: GRIP_ARIA });
    await expect(grips).toHaveCount(5);

    // ---- DEFAULT ORDER -----------------------------------------
    expect(await getClusterOrder(page)).toEqual([
      "glucose", "metabolic", "control", "insulin", "recents",
    ]);

    // ---- DRAG METABOLIC ABOVE GLUCOSE --------------------------
    // Wait for the debounced POST that follows the drag so we know
    // the new order has been persisted before the reload races
    // against the useCardOrder GET on the next page load. The hook
    // debounces by 250ms, so a `waitForResponse` is more robust
    // than a fixed sleep.
    const savePost = page.waitForResponse(
      r => r.url().includes("/api/preferences") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    );

    // Re-resolve grips after each interaction so locators stay
    // current even if dnd-kit re-mounts items. The "current grip
    // order" mirrors the cluster order, so grips.nth(1) is the
    // Metabolic grip and grips.nth(0) is the Glucose grip.
    await dragClusterAbove(grips.nth(1), grips.nth(0));

    // In-memory state: Metabolic is now first.
    await expect.poll(
      () => getClusterOrder(page),
      { timeout: 10_000 },
    ).toEqual(["metabolic", "glucose", "control", "insulin", "recents"]);

    await savePost;

    // ---- PERSISTENCE ACROSS RELOAD -----------------------------
    // The dashboard renders clusters with the default order on first
    // paint, then `useCardOrder`'s GET resolves and the saved order
    // is applied. We poll the visible order rather than asserting
    // once so the check waits past that re-render rather than racing
    // it.
    await page.reload();
    await expect(page.getByRole("button", { name: GRIP_ARIA })).toHaveCount(5);
    await expect.poll(
      () => getClusterOrder(page),
      { timeout: 10_000 },
    ).toEqual(["metabolic", "glucose", "control", "insulin", "recents"]);
  });
});
