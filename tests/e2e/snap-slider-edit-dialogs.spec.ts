// End-to-end coverage for SnapSlider inside the exercise and insulin
// entry edit dialogs on the /entries page.
//
// Why this exists:
//   snap-slider.spec.ts already covers the CycleForm flow-intensity slider
//   (min=1, max=5, step=1).  Two other SnapSlider instances were previously
//   untested:
//     - ExerciseEditor   ariaLabel="Dauer"  min=1  max=600  step=1
//     - InsulinEntryEditor ariaLabel="Dosis" min=0  max=50   step=0.5
//
//   Both live inside inline edit dialogs that only appear after tapping an
//   existing log row open and then clicking "Edit entry".  The step=0.5
//   decimal case and the much wider 1–600 range each have distinct snap
//   boundaries not exercised by the cycle-form test.
//
// Test lifecycle:
//   beforeAll  — service-role Supabase client inserts one exercise_logs row
//                (duration_minutes=47) and one insulin_logs row (units=8,
//                insulin_name="SnapSliderTestBolus").
//   each test  — logs in, navigates to /entries, expands the target row,
//                clicks "Edit entry", tests the SnapSlider interactions.
//   afterAll   — deletes both rows by ID.
//
//   Because the tests never click "Speichern" in the editor, the stored
//   values remain unchanged and every test re-opens the dialog at the same
//   initial slider position.
//
// Snap math for key assertions:
//   Dauer drag to 75 % of track:
//     raw = 1 + 0.75*(600-1) = 450.25 → snap(step=1) → 450
//
//   Dosis ArrowRight from 8:
//     snap(8 + 0.5) = 8.5 → aria-valuenow = "8.5"
//     A regression that forwarded step=1 instead of 0.5 would produce "9".
//
//   Dosis drag to 43.3 % of track:
//     raw = 0 + 0.433*50 = 21.65 → snap(step=0.5):
//       Math.round(21.65/0.5)*0.5 = Math.round(43.3)*0.5 = 43*0.5 = 21.5
//     Result must satisfy nowNum % 0.5 === 0 (on a valid 0.5-step boundary).
//
// Locale:
//   NEXT_LOCALE=de is pinned in beforeEach so server-rendered strings use
//   German.  The edit-button label "Edit entry" and the slider aria-labels
//   "Dauer"/"Dosis" are hardcoded in TSX (not i18n keys) and are the same
//   in both locales.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "snap-slider-edit-dialogs spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

async function pinGermanLocale(context: BrowserContext, baseURL: string) {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
}

// Distinctive values that survive a full /entries page of mixed rows.
// The exercise duration (47 min) is rendered as "47m" in the collapsed row —
// an unusual value unlikely to collide with other entries.
// The insulin name is a unique sentinel string shown as the row's primary
// value in the collapsed view.
const EXERCISE_DURATION = 47;
const INSULIN_NAME = "SnapSliderTestBolus";
const EXERCISE_INITIAL_VALUE = EXERCISE_DURATION; // aria-valuenow baseline
const INSULIN_INITIAL_VALUE = 8;                  // aria-valuenow baseline

let exerciseLogId: string | null = null;
let insulinLogId: string | null = null;

async function createTestRows(userId: string) {
  const admin = getAdminClient();

  // Exercise row — manual source so the Dauer SnapSlider is rendered
  // (Apple-Health rows lock duration and show a static div instead).
  const { data: ex, error: exErr } = await admin
    .from("exercise_logs")
    .insert({
      user_id: userId,
      exercise_type: "cardio",
      duration_minutes: EXERCISE_DURATION,
      intensity: "medium",
      notes: null,
    })
    .select("id")
    .single();
  if (exErr || !ex) {
    throw new Error(`exercise_logs insert failed: ${exErr?.message ?? "no data"}`);
  }
  exerciseLogId = ex.id as string;

  // Insulin row — bolus so the InsulinEntryEditor's Dosis slider is rendered.
  const { data: ins, error: insErr } = await admin
    .from("insulin_logs")
    .insert({
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: INSULIN_NAME,
      units: INSULIN_INITIAL_VALUE,
    })
    .select("id")
    .single();
  if (insErr || !ins) {
    throw new Error(`insulin_logs insert failed: ${insErr?.message ?? "no data"}`);
  }
  insulinLogId = ins.id as string;
}

async function deleteTestRows() {
  const admin = getAdminClient();
  if (exerciseLogId) {
    await admin.from("exercise_logs").delete().eq("id", exerciseLogId);
    exerciseLogId = null;
  }
  if (insulinLogId) {
    await admin.from("insulin_logs").delete().eq("id", insulinLogId);
    insulinLogId = null;
  }
}

// Navigate to /entries, find the collapsed NonMealRow that contains
// `matchText`, click to expand, then click the "Edit entry" button to open
// the inline editor.  Returns the visible div[role="slider"] with the given
// ariaLabel.
//
// The collapsed row header is rendered with CSS class "glev-mec" which scopes
// the locator to just the clickable header strip, avoiding false matches on
// parent wrapper divs.
async function openEditSlider(
  page: Page,
  matchText: string | RegExp,
  ariaLabel: string,
) {
  await page.goto("/entries", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForURL(/\/entries/, { timeout: 30_000 });

  // The collapsed row header has class "glev-mec".  Filter by our unique
  // text so we click the right row even when many entries exist.
  const rowHeader = page.locator(".glev-mec").filter({ hasText: matchText }).first();
  await expect(rowHeader).toBeVisible({ timeout: 60_000 });
  await rowHeader.click();

  // Row expands → "Edit entry" IosTapButton becomes visible.
  const editBtn = page.getByRole("button", { name: "Edit entry" });
  await expect(editBtn).toBeVisible({ timeout: 10_000 });
  await editBtn.click();

  // Inline editor renders the SnapSlider — the drag surface is the
  // div[role="slider"] with the matching aria-label.
  const slider = page.locator(`[role="slider"][aria-label="${ariaLabel}"]`);
  await expect(slider).toBeVisible({ timeout: 30_000 });
  return slider;
}

test.use({ actionTimeout: 15_000 });

test.describe("SnapSlider — exercise and insulin edit dialogs", () => {
  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    await createTestRows(testUser.userId);
  });

  test.afterAll(async () => {
    await deleteTestRows();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
  });

  // ── Exercise slider: Dauer (min=1, max=600, step=1) ──────────────────

  // Test 1 — drag with snap verification.
  //
  // Drag from the current thumb position (≈7.7 % for 47 min) to 75 % of
  // track width.
  //   raw  = 1 + 0.75*(600-1) = 450.25
  //   snap = Math.round((450.25-1)/1)*1 + 1 = 450
  //
  // The ExerciseEditor's onChange also Math.rounds, so both snapped and
  // non-snapped paths agree on integers. The primary regression this test
  // guards is that drag fires at all in the edit-dialog context (the editor
  // DOM is mounted later than the CycleForm, and an early regression froze
  // the Dauer slider in the dialog due to a stale pointer-capture reference).
  test("Dauer slider — drag changes value within 1–600 range", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    const slider = await openEditSlider(page, `${EXERCISE_DURATION}m`, "Dauer");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(EXERCISE_INITIAL_VALUE),
      { timeout: 5_000 },
    );

    const box = await slider.boundingBox();
    if (!box) throw new Error("Dauer slider bounding box is null — slider not rendered?");

    const midY = box.y + box.height / 2;
    // Current thumb at pct = (47-1)/(600-1) ≈ 7.7 % of track width.
    const thumbX = box.x + box.width * (EXERCISE_DURATION - 1) / (600 - 1);
    // Target: 75 % of track → raw 450.25 → snap → 450.
    const targetX = box.x + box.width * 0.75;

    await page.mouse.move(thumbX, midY);
    await page.mouse.down();
    const STEPS = 8;
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(
        thumbX + (targetX - thumbX) * (i / STEPS),
        midY,
      );
    }
    await page.mouse.up();

    await expect(slider).toHaveAttribute("aria-valuenow", "450", { timeout: 3_000 });
  });

  // Test 2 — keyboard ArrowRight / ArrowLeft (step=1).
  //
  // Each key press should change aria-valuenow by exactly 1, proving that
  // the onKeyDown handler reaches the correct commit(snap(value ± step))
  // path inside the edit-dialog context.
  test("Dauer slider — ArrowRight/Left adjust by exactly 1 min (step=1)", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    const slider = await openEditSlider(page, `${EXERCISE_DURATION}m`, "Dauer");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(EXERCISE_INITIAL_VALUE),
      { timeout: 5_000 },
    );

    await slider.focus();

    // ArrowRight: commit(snap(47 + 1)) = 48
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(EXERCISE_INITIAL_VALUE + 1),
      { timeout: 3_000 },
    );

    // ArrowLeft: commit(snap(48 - 1)) = 47
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(EXERCISE_INITIAL_VALUE),
      { timeout: 3_000 },
    );
  });

  // Test 3 — tap-to-edit: click read-out → type → Tab commits (blur path).
  //
  // Mirrors snap-slider.spec.ts test 3 for the Dauer context.  The blur
  // path (Tab) is the primary commit route on iOS WKWebView where keyboard
  // dismissal fires onBlur before any button tap.
  test("Dauer slider — tap-to-edit: click read-out, type 120, Tab commits it", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    await openEditSlider(page, `${EXERCISE_DURATION}m`, "Dauer");

    // The read-out is a <button type="button" aria-label="Dauer">.
    // getByRole("button") scopes to buttons, so it won't match the
    // div[role="slider"] that also carries aria-label="Dauer".
    const readout = page.getByRole("button", { name: "Dauer" });
    await expect(readout).toBeVisible({ timeout: 5_000 });
    await readout.click();

    const numberInput = page.locator('input[type="number"]').first();
    await expect(numberInput).toBeVisible({ timeout: 3_000 });

    await numberInput.fill("120");
    await page.keyboard.press("Tab"); // → onBlur → commitDraft()

    // Edit mode should collapse.
    await expect(numberInput).not.toBeVisible({ timeout: 3_000 });

    const slider = page.locator('[role="slider"][aria-label="Dauer"]');
    await expect(slider).toHaveAttribute("aria-valuenow", "120", { timeout: 3_000 });
  });

  // ── Insulin slider: Dosis (min=0, max=50, step=0.5) ─────────────────

  // Test 4 — ArrowRight increments by exactly 0.5 U (the decimal-step case).
  //
  // This is the highest-value assertion in the suite: the step prop feeds
  // directly into commit(snap(value ± step)), and the SnapSlider's snap()
  // uses Math.round((v - min) / step) * step + min.  If the step were
  // accidentally coerced to an integer (e.g. via Math.round elsewhere), the
  // jump would be 1.0 U instead of 0.5 U — directly observable here.
  test("Dosis slider — ArrowRight increments by 0.5 U; ArrowLeft decrements by 0.5 U", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    const slider = await openEditSlider(page, INSULIN_NAME, "Dosis");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(INSULIN_INITIAL_VALUE),
      { timeout: 5_000 },
    );

    await slider.focus();

    // ArrowRight: commit(snap(8 + 0.5)) = 8.5
    // Regression guard: if step=1 were used instead, value would become 9.
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "8.5", { timeout: 3_000 });

    // ArrowLeft: commit(snap(8.5 - 0.5)) = 8
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "8", { timeout: 3_000 });
  });

  // Test 5 — drag with 0.5-step snap verification.
  //
  // Drag from the current thumb (16 % for 8 U) to 43.3 % of track:
  //   raw  = 0 + 0.433 * 50 = 21.65
  //   snap = Math.round(21.65 / 0.5) * 0.5 = Math.round(43.3) * 0.5 = 43 * 0.5 = 21.5
  //
  // The assertion verifies nowNum % 0.5 === 0 rather than expecting a fixed
  // value, which is robust to sub-pixel drag inaccuracies.  If the decimal
  // snap broke and a fractional raw value were forwarded, the modulo check
  // would fail for any value that lands between 0.5-step boundaries.
  test("Dosis slider — drag result is always on a 0.5 U boundary", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    const slider = await openEditSlider(page, INSULIN_NAME, "Dosis");
    await expect(slider).toHaveAttribute(
      "aria-valuenow",
      String(INSULIN_INITIAL_VALUE),
      { timeout: 5_000 },
    );

    const box = await slider.boundingBox();
    if (!box) throw new Error("Dosis slider bounding box is null — slider not rendered?");

    const midY = box.y + box.height / 2;
    // Current thumb at 8/50 = 16 % of track.
    const thumbX = box.x + box.width * (INSULIN_INITIAL_VALUE / 50);
    // Target: 43.3 % → raw 21.65 → snap → 21.5 (a clean 0.5-step boundary).
    const targetX = box.x + box.width * 0.433;

    await page.mouse.move(thumbX, midY);
    await page.mouse.down();
    const STEPS = 8;
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(
        thumbX + (targetX - thumbX) * (i / STEPS),
        midY,
      );
    }
    await page.mouse.up();

    const rawAttr = await slider.getAttribute("aria-valuenow");
    const nowNum = rawAttr != null ? Number(rawAttr) : NaN;
    expect(Number.isFinite(nowNum)).toBe(true);

    // Must be in range.
    expect(nowNum).toBeGreaterThanOrEqual(0);
    expect(nowNum).toBeLessThanOrEqual(50);

    // Must sit on a 0.5-step boundary.
    // toBeCloseTo(0, 5) tolerates float-representation dust (e.g. 0.000...01)
    // while catching real step errors (e.g. 0.15 for a raw 21.65 passed
    // without snapping).
    expect(nowNum % 0.5).toBeCloseTo(0, 5);

    // The drag travelled well past the initial position, so the value
    // must have changed from the seed 8.
    expect(nowNum).not.toEqual(INSULIN_INITIAL_VALUE);
  });

  // Test 6 — tap-to-edit: type a decimal value (12.5), Enter commits it.
  //
  // The commitDraft path in SnapSlider rounds the typed value to `dec`
  // decimal places (dec = 1 for step=0.5) and calls onChange.  The
  // InsulinEntryEditor's onChange is `setUnits(Math.round(n * 2) / 2)`.
  // For 12.5 U: clamped=12.5, rounded to 1 dec=12.5, Math.round(12.5*2)/2=12.5.
  // aria-valuenow must become "12.5".
  test("Dosis slider — tap-to-edit: type 12.5 then Enter commits it", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page, test.info().workerIndex);

    await openEditSlider(page, INSULIN_NAME, "Dosis");

    const readout = page.getByRole("button", { name: "Dosis" });
    await expect(readout).toBeVisible({ timeout: 5_000 });
    await readout.click();

    const numberInput = page.locator('input[type="number"]').first();
    await expect(numberInput).toBeVisible({ timeout: 3_000 });

    // 12.5 is a valid 0.5-step boundary value.
    await numberInput.fill("12.5");
    await numberInput.press("Enter"); // → onKeyDown Enter → commitDraft()

    // Edit mode collapses.
    await expect(numberInput).not.toBeVisible({ timeout: 3_000 });

    const slider = page.locator('[role="slider"][aria-label="Dosis"]');
    await expect(slider).toHaveAttribute("aria-valuenow", "12.5", { timeout: 3_000 });
  });
});
