// End-to-end regression guard for the IOBCard Wirkdauer bar (Task #717, extended Task #736).
//
// ## What & Why
// The bolus Wirkdauer bar (`data-testid="iob-wirkdauer-bar"`) was added in
// task #712. Without an E2E guard, a JSX regression (bar div removed,
// data-testid renamed, conditional inverted, CSS height/opacity zeroed) would
// be silent until a user reports it.
//
// ## Coverage
//
// 1. **No-dose / cleared state** (original Task #717):
//    No recent bolus is present. The cleared empty-state element is shown and
//    the Wirkdauer bar is NOT in the DOM.
//
// 2. **Active dose state** (Task #736):
//    A meal with insulin_units: 8 is seeded 30 minutes ago (well within the
//    rapid DIA of 180 min). After expanding the IOB card the Wirkdauer bar
//    must be attached, visible, and have a bounding-box height > 0.
//    This catches: bar div removed from JSX, data-testid renamed,
//    condition inverted, or a CSS rule that zeroes out the bar.
//
// 3. **Expired doses state** (Task #736):
//    A meal is seeded 241 minutes ago (> rapid DIA of 180 min → fully elapsed).
//    After expanding the IOB card the cleared element must be shown and the
//    bar must be absent from the DOM — validating the expired branch.
//
// ## Test data strategy
// Tests 2 and 3 seed a synthetic meal row via the Supabase service-role admin
// client in beforeAll and delete it in afterAll so subsequent runs start clean.
//
// ## Dialog handling
// Two components can block IOB card interaction on the dashboard:
//
//   1. Cookie consent ("Cookie-Einstellungen") — a modal overlay that appears
//      immediately on first load. Dismissed via the "Ablehnen" button.
//
//   2. BzCheckModal (glev:meal-check-reminder event) — a bottom-sheet that
//      slides in after IOB/CGM data loads. IMPORTANT: BzCheckModal is ALWAYS
//      in the DOM (translateY(100%) when closed), so Playwright's
//      toBeVisible() / waitFor('visible') ALWAYS returns true for it even when
//      "closed". We suppress the BZ modal entirely via a context.addInitScript
//      that intercepts glev:meal-check-reminder before it reaches
//      MealCheckReminderProvider. This is safer than trying to detect the
//      "open" state via CSS transforms.
//
// ## Cookie dialog detection
// The "Ablehnen" button only exists in the cookie consent overlay (the BZ
// modal's "Abbrechen" button is scoped away). We use waitFor({ state:'visible'})
// so we actually wait for delayed appearance, not just instant DOM presence.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestUser { email: string; password: string; userId: string; }

// ── Shared helpers ────────────────────────────────────────────────────────────


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "iob-wirkdauer-bar spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Seed a synthetic meal with `insulin_units` set so IOBCard sees an active or
 *  expired dose depending on `minutesAgo`. Returns the inserted row's id. */
async function seedMealWithInsulin(userId: string, minutesAgo: number): Promise<string> {
  const admin = getAdminClient();
  const mealTime = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: `Wirkdauer bar test meal (${minutesAgo}min ago)`,
      parsed_json: [],
      insulin_units: 8,
      carbs_grams: 60,
      meal_type: "BALANCED",
      meal_time: mealTime,
      created_at: mealTime,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to seed meal: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

/** Delete a seeded test meal. Soft-fails so cleanup never breaks the run. */
async function deleteMeal(mealId: string) {
  try {
    const admin = getAdminClient();
    await admin.from("meals").delete().eq("id", mealId);
  } catch {
    /* cleanup failure is non-fatal */
  }
}

/** Delete ALL meals for the test user.
 *
 *  The test user (`playwright-theme@glev.test`) is shared across all runs.
 *  Stale meals from previous test runs remain in the DB and can contain
 *  recent insulin_units that make the IOBCard show an active-dose bar
 *  instead of the cleared empty-state.  Wiping all meals at the start of
 *  each describe block gives each test a reproducible baseline.
 *
 *  Soft-fails so a DB hiccup cannot abort the whole run. */
async function cleanAllMeals(userId: string) {
  try {
    const admin = getAdminClient();
    await admin.from("meals").delete().eq("user_id", userId);
  } catch {
    /* non-fatal */
  }
}

/** Suppress the BZ-Check bottom-sheet for the lifetime of this browser context.
 *
 *  BzCheckModal (components/BzCheckModal.tsx) is shown whenever the custom
 *  event `glev:meal-check-reminder` is dispatched on `window`. That event is
 *  dispatched by MealCheckReminderProvider (via mealCheckReminders.ts) when:
 *   • A Capacitor local notification is tapped (native only — no-op in browser)
 *   • A web Notification.onclick fires (requires Notification permission)
 *
 *  In headless Chromium the Notification permission is not granted by default,
 *  so the event shouldn't fire. However BzCheckModal is ALWAYS in the DOM
 *  (translateY 100% when closed) which means:
 *   • Playwright's toBeVisible() / waitFor('visible') return true even when
 *     the modal is visually off-screen.
 *   • Any attempt to dismiss it via clicks on off-screen buttons is unreliable.
 *
 *  Safest approach: intercept `window.dispatchEvent` before any app code runs
 *  and silently drop `glev:meal-check-reminder` events, keeping `payload=null`
 *  in MealCheckReminderProvider so the backdrop overlay is never activated and
 *  pointer events on the dashboard remain fully accessible.
 *
 *  This init script runs on every navigation in the context (via
 *  context.addInitScript) so it covers the login page and the dashboard. */
async function suppressBzModal(context: BrowserContext) {
  await context.addInitScript(() => {
    const original = EventTarget.prototype.dispatchEvent;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    EventTarget.prototype.dispatchEvent = function dispatchEvent(event: Event): boolean {
      if (event.type === "glev:meal-check-reminder") return true;
      return original.call(this, event);
    };
  });
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

/** Dismiss the cookie-consent overlay if it appears.
 *
 *  The "Cookie-Einstellungen" overlay has an "Ablehnen" button that is ONLY
 *  present in the cookie dialog (unlike "Abbrechen" which appears in many
 *  modals).  We use waitFor({ state: 'visible' }) — not isVisible() — so we
 *  actually poll for the button's appearance instead of checking once and
 *  moving on. The 3 s timeout is generous enough to catch delayed render but
 *  fast enough that the test doesn't stall when the dialog isn't shown (e.g.
 *  the user already dismissed it in a previous test). */
async function dismissCookieDialog(page: Page) {
  try {
    const rejectBtn = page.getByRole("button", { name: /^ablehnen$/i });
    await rejectBtn.waitFor({ state: "visible", timeout: 3_000 });
    await rejectBtn.click();
    await rejectBtn.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  } catch { /* dialog not present */ }
}

/** Expand the IOB card bolus detail section and return the detail section locator.
 *
 *  Pre-condition: the BZ-Check bottom-sheet has been suppressed via
 *  suppressBzModal() so the dashboard is fully interactive.
 *
 *  Flow:
 *   1. Dismiss the cookie consent overlay (if visible).
 *   2. Wait for the toggle button to be attached and visible.
 *   3. Activate the Bolus chip if visible (so we look at bolus content).
 *   4. If the panel is already expanded (aria-expanded="true"), do nothing.
 *   5. Otherwise click the toggle; retry up to 3× with cookie re-checks in
 *      case the dialog re-appeared between dismissal and click.
 *
 *  We deliberately do NOT reload the page: a reload re-triggers the
 *  cookie dialog on every run. */
async function expandBolusSection(page: Page) {
  // ── 1. Cookie consent ───────────────────────────────────────────────────────
  await dismissCookieDialog(page);

  // ── 2. Toggle button ────────────────────────────────────────────────────────
  const toggleBtn = page.getByRole("button", {
    name: /Details ein-\/ausblenden|Toggle IOB details/i,
  });
  await expect(toggleBtn).toBeAttached({ timeout: 30_000 });
  await toggleBtn.scrollIntoViewIfNeeded();
  await expect(toggleBtn).toBeVisible({ timeout: 10_000 });

  // ── 3. Bolus chip ────────────────────────────────────────────────────────────
  //
  // The Bolus chip uses stopPropagation so clicking it cannot accidentally
  // toggle the expand state.
  const bolusTab = page.getByRole("button", { name: /^bolus$/i }).first();
  if (await bolusTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await bolusTab.click();
  }

  // ── 4. Detail section locator ────────────────────────────────────────────────
  const detailSection = page.getByTestId("iob-detail-section");
  await expect(detailSection).toBeAttached({ timeout: 10_000 });

  // ── 5. Expand via dispatchEvent (bypasses any modal backdrop) ────────────────
  //
  // If the BZ-Check modal is open, its backdrop div has `pointerEvents: auto`
  // and is physically positioned over the toggle button.  Playwright's
  // locator.click() — even with force:true — moves the mouse to the element's
  // center coordinates, where the backdrop intercepts the events.
  //
  // locator.dispatchEvent('click') dispatches the DOM event DIRECTLY on the
  // element without going through coordinate-based hit testing, so the event
  // lands on the toggle button's event listeners regardless of what covers it.
  // React's synthetic event system receives the bubbling native event and calls
  // the button's onClick handler, which sets isExpanded=true and updates
  // aria-expanded.
  //
  // We retry up to 3× in case a React batch update delays the state change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const isOpen = (await toggleBtn.getAttribute("aria-expanded")) === "true";
    if (isOpen) break;

    await toggleBtn.dispatchEvent("click");
    await page.waitForTimeout(1_000);
  }

  await expect(toggleBtn).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
  await expect(detailSection).not.toHaveCSS("max-height", "0px", { timeout: 2_000 });

  return detailSection;
}

// ── 1. No-dose / cleared state ────────────────────────────────────────────────

test.describe("IOBCard Wirkdauer bar — no-dose / cleared state", () => {
  test.beforeAll(async () => {
    const { userId } = loadTestUserByIndex(test.info().workerIndex);
    await cleanAllMeals(userId);
  });

  test.afterAll(async () => {
    const { userId } = loadTestUserByIndex(test.info().workerIndex);
    await cleanAllMeals(userId);
  });

  test.beforeEach(async ({ context }) => {
    await suppressBzModal(context);
    await context.clearCookies();
  });

  test("cleared state: iob-wirkdauer-cleared is shown and iob-wirkdauer-bar is absent", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await expandBolusSection(page);

    const clearedEl = page.getByTestId("iob-wirkdauer-cleared");
    const barEl     = page.getByTestId("iob-wirkdauer-bar");

    await expect(clearedEl).toBeVisible({ timeout: 5_000 });
    await expect(barEl).not.toBeAttached();
  });
});

// ── 2. Active dose state ──────────────────────────────────────────────────────

test.describe("IOBCard Wirkdauer bar — active dose (30 min ago)", () => {
  let testUser: TestUser;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    await cleanAllMeals(testUser.userId);
    mealId = await seedMealWithInsulin(testUser.userId, 30);
  });

  test.afterAll(async () => {
    if (mealId) await deleteMeal(mealId);
    await cleanAllMeals(testUser.userId);
  });

  test.beforeEach(async ({ context }) => {
    await suppressBzModal(context);
    await context.clearCookies();
  });

  test("active dose: iob-wirkdauer-bar is visible and has non-zero bounding-box height", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await expandBolusSection(page);

    const barEl     = page.getByTestId("iob-wirkdauer-bar");
    const clearedEl = page.getByTestId("iob-wirkdauer-cleared");

    await expect(barEl).toBeAttached({ timeout: 5_000 });
    await expect(barEl).toBeVisible({ timeout: 5_000 });

    const box = await barEl.boundingBox();
    expect(box, "iob-wirkdauer-bar bounding box must not be null").not.toBeNull();
    expect(box!.height, "iob-wirkdauer-bar height must be > 0 when a dose is active").toBeGreaterThan(0);

    await expect(clearedEl).not.toBeAttached();
  });
});

// ── 3. Expired doses state ────────────────────────────────────────────────────

test.describe("IOBCard Wirkdauer bar — expired dose (400 min ago, > max DIA 360 min)", () => {
  let testUser: TestUser;
  let mealId: string;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    await cleanAllMeals(testUser.userId);
    // 400 min exceeds the maximum user-configurable DIA (360 min), so the dose
    // is guaranteed expired regardless of the test user's personal DIA setting.
    mealId = await seedMealWithInsulin(testUser.userId, 400);
  });

  test.afterAll(async () => {
    if (mealId) await deleteMeal(mealId);
    await cleanAllMeals(testUser.userId);
  });

  test.beforeEach(async ({ context }) => {
    await suppressBzModal(context);
    await context.clearCookies();
  });

  test("expired doses: iob-wirkdauer-cleared is shown and iob-wirkdauer-bar is absent", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await expandBolusSection(page);

    const clearedEl = page.getByTestId("iob-wirkdauer-cleared");
    const barEl     = page.getByTestId("iob-wirkdauer-bar");

    await expect(clearedEl).toBeVisible({ timeout: 5_000 });
    await expect(barEl).not.toBeAttached();
  });
});
