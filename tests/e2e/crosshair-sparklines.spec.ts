// End-to-end coverage for the crosshair interactions on the /entries page.
//
// Three sparkline components support tap/hover crosshair interactions, and this
// spec verifies all three:
//
//   1. CgmSparkline  — basal row, 6 h pre-injection CGM trend.
//      The component renders inside the expanded "6H PRE-INJECTION TREND" panel
//      only when /api/cgm/history returns valid readings. A route intercept
//      provides deterministic mock data so the test does not depend on a live
//      CGM connection. Pointer-hover triggers `useCrosshair` → `active` point →
//      CrosshairTooltip appears with the glucose value in "mg/dL".
//
//   2. GlucoseMiniSparkline — bolus row, "AT LOG / +1H / +2H" glucose trend.
//      The component renders only when ≥ 2 of {cgm_glucose_at_log,
//      glucose_after_1h, glucose_after_2h} are non-null. We seed a bolus
//      insulin_logs row with all three populated so the sparkline is guaranteed
//      to render. Hover confirms the crosshair tooltip appears.
//
//   3. GlucoseMiniSparkline — exercise row, "BEFORE / AT END / +1H" glucose
//      trend. Same pattern: seed exercise_logs with {cgm_glucose_at_log,
//      glucose_at_end, glucose_after_1h} all set → ≥ 2 points → sparkline.
//      Hover confirms crosshair.
//
// Why pointer-hover (not pointer-down) for the crosshair trigger?
//   `useCrosshair.onPointerMove` fires on mouse hover without any button held.
//   Playwright's `.hover()` dispatches a `pointermove` event with
//   pointerType="mouse", which passes the `isTouch = false` branch so the
//   crosshair stays active after the event rather than clearing on release.
//
// Selector rationale for the CrosshairTooltip:
//   The tooltip is an absolutely-positioned HTML `<div>` (inside the chart's
//   position:relative container) that appears and disappears based on whether
//   `active` is non-null. It has no stable test-id, but each tooltip line
//   renders in its own child `<div>`. The second line always contains a glucose
//   value formatted as "${Math.round(v)} mg/dL" — we assert on "mg/dL" text
//   that is a descendant of the chart container. Scoping the assertion to the
//   container avoids false-positives from other "mg/dL" text elsewhere on the
//   page (e.g. the BG AT LOG Detail cells).
//
// Row-finding strategy:
//   • Bolus row  — has a stable DOM id `entry-insulin-<uuid>` set by
//     BolusRowCard (line ~2243 in entries/page.tsx). Used directly.
//   • Basal row  — NonMealRow receives NO id from BasalRowCard. We locate it
//     by the unique collapsed secondary value `${units}u ${insulin_name}` that
//     we control via the seeded data ("11u BasalCrosshairTest").
//   • Exercise row — NonMealRow also receives no id. We locate it by the
//     unique primary value `${duration_minutes}m` we control via seed ("173m").
//
// Test data lifecycle:
//   beforeAll  — inserts rows via the service-role admin client.
//   afterAll   — deletes those rows by ID.
//   Tests never commit edits so stored values remain unchanged across retries.

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "crosshair-sparklines spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Seed values ─────────────────────────────────────────────────────────────
//
// Deliberately unusual to avoid collisions with real user data.

const BASAL_UNITS       = 11;
const BASAL_BRAND       = "BasalCrosshairTest";
const BASAL_DOSE_LABEL  = `${BASAL_UNITS}u ${BASAL_BRAND}`;

const BOLUS_UNITS       = 7;
const BOLUS_BRAND       = "BolusCrosshairTest";

const EXERCISE_DURATION = 173; // minutes — unique enough to find the row

// Three glucose readings for the bolus mini sparkline (all non-null → 3 pts).
const BOLUS_BG_AT_LOG  = 118;
const BOLUS_BG_AFTER1H = 142;
const BOLUS_BG_AFTER2H = 107;

// Three glucose readings for the exercise mini sparkline.
const EXER_BG_BEFORE  = 122;
const EXER_BG_AT_END  = 96;
const EXER_BG_AFTER1H = 111;

// Mock CGM history returned by the intercepted /api/cgm/history endpoint.
// Three readings spaced 5 minutes apart — enough for CgmSparkline to render.
function makeMockCgmHistory(logCreatedAt: Date) {
  const toMs = logCreatedAt.getTime();
  return {
    history: [
      { timestamp: new Date(toMs - 10 * 60_000).toISOString(), value: 135 },
      { timestamp: new Date(toMs -  5 * 60_000).toISOString(), value: 128 },
      { timestamp: new Date(toMs).toISOString(),                value: 121 },
    ],
  };
}

// ── Seeded row IDs (populated in beforeAll) ──────────────────────────────────

let basalLogId: string | null = null;
let bolusLogId: string | null = null;
let exerciseLogId: string | null = null;

let basalCreatedAt: Date = new Date(); // captured after insert for mock CGM ts

// ── DB helpers ───────────────────────────────────────────────────────────────

async function seedBasal(userId: string): Promise<{ id: string; createdAt: Date }> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("insulin_logs")
    .insert({
      user_id: userId,
      insulin_type: "basal",
      insulin_name: BASAL_BRAND,
      units: BASAL_UNITS,
    })
    .select("id, created_at")
    .single();
  if (error || !data) throw new Error(`basal seed failed: ${error?.message ?? "no data"}`);
  return { id: data.id as string, createdAt: new Date(data.created_at as string) };
}

async function seedBolus(userId: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("insulin_logs")
    .insert({
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: BOLUS_BRAND,
      units: BOLUS_UNITS,
      cgm_glucose_at_log:  BOLUS_BG_AT_LOG,
      glucose_after_1h: BOLUS_BG_AFTER1H,
      glucose_after_2h: BOLUS_BG_AFTER2H,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`bolus seed failed: ${error?.message ?? "no data"}`);
  return data.id as string;
}

async function seedExercise(userId: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("exercise_logs")
    .insert({
      user_id: userId,
      exercise_type: "cardio",
      duration_minutes: EXERCISE_DURATION,
      intensity: "medium",
      cgm_glucose_at_log: EXER_BG_BEFORE,
      glucose_at_end: EXER_BG_AT_END,
      glucose_after_1h: EXER_BG_AFTER1H,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`exercise seed failed: ${error?.message ?? "no data"}`);
  return data.id as string;
}

async function cleanup() {
  const admin = getAdminClient();
  try { if (basalLogId)    await admin.from("insulin_logs").delete().eq("id", basalLogId); }    catch { /* non-fatal */ }
  try { if (bolusLogId)    await admin.from("insulin_logs").delete().eq("id", bolusLogId); }    catch { /* non-fatal */ }
  try { if (exerciseLogId) await admin.from("exercise_logs").delete().eq("id", exerciseLogId); } catch { /* non-fatal */ }
}

// ── Auth helper ──────────────────────────────────────────────────────────────

async function loginAsTestUser(page: Page, workerIndex: number) {
  const { email, password } = loadTestUserByIndex(workerIndex);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 90_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// ── Navigate to /entries with a cleared filter state ─────────────────────────

async function goToEntries(page: Page) {
  await page.goto("/entries", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForURL(/\/entries/, { timeout: 30_000 });
  // Drop any persisted date-range filter so recently seeded rows are visible.
  await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForURL(/\/entries/, { timeout: 30_000 });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Entries → crosshair interactions on sparkline components (Task #381)", () => {
  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    const [basal, bolus, exercise] = await Promise.all([
      seedBasal(testUser.userId),
      seedBolus(testUser.userId),
      seedExercise(testUser.userId),
    ]);
    basalLogId    = basal.id;
    basalCreatedAt = basal.createdAt;
    bolusLogId    = bolus;
    exerciseLogId = exercise;
  });

  test.afterAll(async () => {
    await cleanup();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // ── Test 1: CgmSparkline crosshair in basal expanded row ─────────────────

  test("basal expanded row — CgmSparkline renders and shows crosshair tooltip on hover", async ({ page }) => {
    // Intercept the CGM history API so the sparkline renders in the test
    // environment regardless of whether a real CGM device is connected.
    // The intercepted response is set up before navigation so it is already
    // in place when the row expands and fires the fetch.
    const mockHistory = makeMockCgmHistory(basalCreatedAt);
    await page.route("**/api/cgm/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHistory),
      });
    });

    await loginAsTestUser(page, test.info().workerIndex);
    await goToEntries(page);

    // Locate the basal row by its unique collapsed secondary value.
    // The `.glev-mec` div is the 4-column collapsed-row grid; it contains the
    // secondary value rendered as `${units}u ${insulin_name}`.
    const collapsedRow = page.locator(".glev-mec", { hasText: BASAL_DOSE_LABEL }).first();
    await expect(collapsedRow).toBeVisible({ timeout: 30_000 });

    // Click the collapsed header to expand the row.
    await collapsedRow.click();

    // The CgmSparkline SVG is wrapped in a div and only shown once the lazy
    // fetch resolves. The intercepted route returns immediately so this should
    // settle quickly, but we give a generous timeout for CI slow starts.
    const cgmSvg = page.locator('[aria-label="CGM glucose trend"]');
    await expect(cgmSvg).toBeVisible({ timeout: 20_000 });

    // Hover over the centre of the SVG. On a mouse device, `onPointerMove`
    // fires immediately and snaps to the nearest data point, setting `active`.
    // Scroll into view first in case the sparkline is below the fold inside
    // the expanded row, then hover without `force` so Playwright's normal
    // actionability checks ensure the element is in view.
    await cgmSvg.scrollIntoViewIfNeeded();
    await cgmSvg.hover();

    // The CrosshairTooltip mounts as a sibling div inside the same
    // position:relative container as the SVG. Its second tooltip line is
    // "${value} mg/dL". We scope the locator to the chart container so we
    // do not accidentally match BG detail cells elsewhere on the page.
    const chartContainer = page.locator('[aria-label="CGM glucose trend"]').locator("..");
    await expect(
      chartContainer.locator("text=mg/dL"),
      "CrosshairTooltip should appear with glucose value after hovering over CgmSparkline",
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 2: GlucoseMiniSparkline renders in bolus row (≥ 2 readings) ─────

  test("bolus expanded row — GlucoseMiniSparkline renders when ≥ 2 glucose readings are present", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToEntries(page);

    // The bolus row has a stable DOM id set by BolusRowCard.
    const card = page.locator(`#entry-insulin-${bolusLogId}`);
    await expect(card).toBeAttached({ timeout: 30_000 });

    // The collapsed grid header — click to expand.
    const collapsedGrid = card.locator(".glev-mec");
    await expect(collapsedGrid).toBeVisible({ timeout: 10_000 });
    await collapsedGrid.click();

    // With all three glucose values seeded (AT LOG + 1H + 2H), the
    // GlucoseMiniSparkline receives 3 points and must render its SVG.
    // If the component returned null (< 2 points), this would time-out.
    const miniSvg = card.locator('[aria-label="Glucose trend"]');
    await expect(
      miniSvg,
      "GlucoseMiniSparkline SVG should be present when 3 glucose readings are stored on the bolus log",
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── Test 3: GlucoseMiniSparkline crosshair in bolus row ──────────────────

  test("bolus expanded row — GlucoseMiniSparkline crosshair tooltip appears on hover", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToEntries(page);

    const card = page.locator(`#entry-insulin-${bolusLogId}`);
    await expect(card).toBeAttached({ timeout: 30_000 });

    const collapsedGrid = card.locator(".glev-mec");
    await expect(collapsedGrid).toBeVisible({ timeout: 10_000 });
    await collapsedGrid.click();

    const miniSvg = card.locator('[aria-label="Glucose trend"]');
    await expect(miniSvg).toBeVisible({ timeout: 15_000 });

    // Scroll into view (the mini sparkline sits below several panels in the
    // expanded row and may be off-screen), then hover to trigger the crosshair.
    await miniSvg.scrollIntoViewIfNeeded();
    await miniSvg.hover();

    // CrosshairTooltip renders inside the chart container (position:relative div
    // that wraps the SVG). The second tooltip line for GlucoseMiniSparkline is
    // `${Math.round(v)} mg/dL`. We locate it relative to the container so we
    // don't match other "mg/dL" occurrences in the expanded detail cells.
    const miniContainer = miniSvg.locator("..");
    await expect(
      miniContainer.locator("text=mg/dL"),
      "CrosshairTooltip should show glucose value in mg/dL on hover over mini bolus sparkline",
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 4: GlucoseMiniSparkline renders in exercise row (≥ 2 readings) ──

  test("exercise expanded row — GlucoseMiniSparkline renders when ≥ 2 glucose readings are present", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToEntries(page);

    // Exercise rows have no stable DOM id. Locate by the unique duration string
    // in the collapsed row's primary value column ("173m").
    const durationText = `${EXERCISE_DURATION}m`;
    const collapsedRow = page.locator(".glev-mec", { hasText: durationText }).first();
    await expect(collapsedRow).toBeVisible({ timeout: 30_000 });
    await collapsedRow.click();

    // With BEFORE + AT_END + AFTER_1H all seeded, the sparkline gets 3 points
    // and must render its SVG. The SVG is inside the "GLUCOSE TRACKING" panel.
    const miniSvg = page.locator('[aria-label="Glucose trend"]').first();
    await expect(
      miniSvg,
      "GlucoseMiniSparkline SVG should be present when 3 glucose readings are stored on the exercise log",
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── Test 5: GlucoseMiniSparkline crosshair in exercise row ───────────────

  test("exercise expanded row — GlucoseMiniSparkline crosshair tooltip appears on hover", async ({ page }) => {
    await loginAsTestUser(page, test.info().workerIndex);
    await goToEntries(page);

    const durationText = `${EXERCISE_DURATION}m`;
    const collapsedRow = page.locator(".glev-mec", { hasText: durationText }).first();
    await expect(collapsedRow).toBeVisible({ timeout: 30_000 });
    await collapsedRow.click();

    const miniSvg = page.locator('[aria-label="Glucose trend"]').first();
    await expect(miniSvg).toBeVisible({ timeout: 15_000 });

    await miniSvg.scrollIntoViewIfNeeded();
    await miniSvg.hover();

    const miniContainer = miniSvg.locator("..");
    await expect(
      miniContainer.locator("text=mg/dL"),
      "CrosshairTooltip should show glucose value in mg/dL on hover over mini exercise sparkline",
    ).toBeVisible({ timeout: 10_000 });
  });
});
