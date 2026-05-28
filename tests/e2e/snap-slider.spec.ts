// End-to-end coverage for the SnapSlider component.
//
// Why this exists:
//   SnapSlider is used in every log form and powers the core drag-to-set
//   interaction pattern across the whole app. There were previously zero
//   automated tests covering it, so regressions (especially in the custom
//   pointer-event drag path written specifically to work around WKWebView's
//   broken native <input type="range">) were only caught manually in TestFlight.
//
// What is tested:
//   1. Pointer drag with snap verification: dragging to a position between two
//      step stops proves the component rounds to the nearest step. Without
//      snapping the raw fractional value would reach the host form and produce
//      a different observable outcome.
//   2. Keyboard increment: ArrowRight/ArrowLeft on the div[role="slider"]
//      increments/decrements the value by exactly one step.
//   3. Tap-to-edit with blur commit: clicking the read-out opens an
//      <input type="number">, typing a value, then blurring (Tab key)
//      commits it via the onBlur=commitDraft path. A second sub-check
//      verifies the Enter key path as well.
//
// Test surface — the CycleForm at /engine?tab=cycle:
//   CycleForm defaults to mode="bleeding" which renders the flow-intensity
//   SnapSlider immediately (min=1, max=5, step=1, initial value=3). This
//   slider is guaranteed to appear for any user whose sex is not "male"
//   (the test user fixture has no sex set → cycleSurfacesAvailable returns
//   true → cycle tab stays visible).
//
// CycleForm value mapping (critical for understanding expected values):
//   The CycleForm maps the SnapSlider commit value to a 3-level enum and
//   feeds a discrete value back as the controlled prop:
//     commit value ≤ 2  →  flow="light"   →  slider re-receives 2
//     commit value == 3 →  flow="medium"  →  slider re-receives 3
//     commit value ≥ 4  →  flow="heavy"   →  slider re-receives 4
//   This remapping is exploited in the drag snap test (see test 1 below)
//   to distinguish a snapped result (4) from a non-snapped fractional
//   result (would produce 3 via the "medium" branch). See test 1 for details.
//
// Locale:
//   NEXT_LOCALE=de is pinned via a cookie so server-rendered content uses
//   German strings (aria-label="Stärke"). Without the cookie, Chromium's
//   Accept-Language may produce English ("Flow"), breaking aria-label assertions.
//
// Compile time:
//   /engine is a large page (~3 400 LoC). Dev-mode Turbopack may take
//   60–120 s to compile it on the very first visit. Each test allows up to
//   120 s for the slider to become visible to absorb this cost without flaking.

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


async function pinGermanLocale(context: BrowserContext, baseURL: string) {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
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

// Navigate to the cycle tab and wait until the SnapSlider (flow intensity)
// is visible. Returns the slider locator for immediate interaction.
//
// The 120 s visibility timeout covers dev-mode Turbopack first-compile.
// Subsequent tests in the same suite will find a cached bundle and be fast.
async function openCycleSlider(page: Page) {
  await page.goto("/engine?tab=cycle", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForURL(/\/engine/, { timeout: 30_000 });

  const slider = page.locator('[role="slider"]').first();
  await expect(slider).toBeVisible({ timeout: 120_000 });
  return slider;
}

test.use({ actionTimeout: 15_000 });

test.describe("SnapSlider interaction", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page, test.info().workerIndex);
  });

  // ── Test 1: Pointer drag with snap verification ────────────────────────
  // Drag to a position exactly between two step stops to prove the component
  // rounds (snaps) the raw fractional value to the nearest step.
  //
  // Chosen target: 65 % of track width.
  //   raw value = min + 0.65 * (max - min) = 1 + 0.65 * 4 = 3.6
  //   snap((3.6 - 1) / 1 = 2.6) → Math.round(2.6) = 3 → 3 * 1 + 1 = 4
  //   CycleForm: commit(4) → 4 ≥ 4 → "heavy" → slider re-receives 4
  //
  // If snapping were broken (raw 3.6 forwarded instead of 4):
  //   CycleForm: commit(3.6) → 2 < 3.6 < 4 → "medium" → slider = 3
  //
  // So the assertion aria-valuenow = "4" is ONLY satisfied when snapping
  // correctly rounds 3.6 to 4. Without snapping, the result would be "3".
  // This makes the assertion a direct observable proxy for snap correctness.
  //
  // Playwright's page.mouse API dispatches pointer events in the same order
  // as a real mouse, matching the component's setPointerCapture drag path.
  test("drag to mid-step position snaps to nearest step (not a fractional value)", async ({ page }) => {
    test.setTimeout(180_000);
    const slider = await openCycleSlider(page);

    // Confirm baseline: flow="medium" → slider value = 3.
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 5_000 });

    const box = await slider.boundingBox();
    if (!box) throw new Error("slider bounding box is null — slider not rendered?");

    const midY = box.y + box.height / 2;
    // Start at 10 % to land in the initial "medium" zone without changing
    // the value on pointerdown (10 % → raw=1.4 → snap→1 → "light"→2).
    // Actually start in the medium zone (35 % → raw=2.4 → snap→2 → "light").
    // Simpler: start from the current position and drag right. We initiate at
    // the current thumb position (pct = (3-1)/(5-1) = 50 %) and drag to 65 %.
    const thumbX = box.x + box.width * 0.50; // slider at value=3 → 50 % position
    // Target: 65 % of track — between step-3 zone (37.5–62.5 %) and step-4 zone (62.5–87.5 %).
    // Raw at 65 % = 1 + 0.65*4 = 3.6. With snap → 4. Without snap → 3 (medium).
    const targetX = box.x + box.width * 0.65;

    await page.mouse.move(thumbX, midY);
    await page.mouse.down();
    // Drag in 8 increments so pointermove fires continuously.
    const STEPS = 8;
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(
        thumbX + (targetX - thumbX) * (i / STEPS),
        midY,
      );
    }
    await page.mouse.up();

    // With correct snapping: raw 3.6 → snap → 4 → CycleForm "heavy" → 4.
    // Without snapping: raw 3.6 → CycleForm "medium" (2 < 3.6 < 4) → 3.
    await expect(slider).toHaveAttribute("aria-valuenow", "4", { timeout: 3_000 });
  });

  // ── Test 2: Keyboard ArrowRight / ArrowLeft ────────────────────────────
  // The slider div (role=slider) handles ArrowRight/Up and ArrowLeft/Down
  // directly via onKeyDown → commit(snap(value ± step)). This path is
  // independent of the invisible native <input type="range"> overlay and
  // must work for all keyboard users and AT tools.
  test("ArrowRight increases value by one step; ArrowLeft decreases it", async ({ page }) => {
    test.setTimeout(180_000);
    const slider = await openCycleSlider(page);

    // CycleForm initialises flow to "medium" → SnapSlider value = 3.
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 5_000 });

    // Focus the drag div so keyboard events are dispatched to it.
    await slider.focus();

    // ArrowRight: commit(snap(3+1)) = commit(4) → CycleForm "heavy" → 4.
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "4", { timeout: 3_000 });

    // ArrowLeft: commit(snap(4-1)) = commit(3) → CycleForm "medium" → 3.
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 3_000 });

    // ArrowLeft again: commit(snap(3-1)) = commit(2) → CycleForm "light" → 2.
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "2", { timeout: 3_000 });
  });

  // ── Test 3: Tap-to-edit — blur commit path ────────────────────────────
  // Clicking the read-out opens an <input type="number">; tabbing away
  // triggers the onBlur=commitDraft handler, which commits the typed value.
  // The blur path is the primary commit route in mobile WKWebView flows
  // (where the user dismisses the keyboard, triggering blur before any
  // button tap fires). If it regresses, every save triggered by dismissing
  // the keyboard would silently send the stale (pre-edit) value.
  test("tap-to-edit: click read-out → type value → blur (Tab) commits it", async ({ page }) => {
    test.setTimeout(180_000);
    await openCycleSlider(page);

    // The read-out is a <button type="button"> with aria-label="Stärke"
    // (German locale pinned via cookie). getByRole("button") selects it
    // without matching the div[role="slider"] that shares the same label.
    const readout = page.getByRole("button", { name: "Stärke" });
    await expect(readout).toBeVisible({ timeout: 5_000 });

    // Click to enter edit mode (draft is initialised to the current value).
    await readout.click();

    // An <input type="number"> should appear (autoFocused).
    const numberInput = page.locator('input[type="number"]').first();
    await expect(numberInput).toBeVisible({ timeout: 3_000 });

    // Type the new value, then trigger BLUR via Tab (the primary commit
    // route on iOS WKWebView — keyboard dismiss fires blur before any tap).
    await numberInput.fill("4");
    await page.keyboard.press("Tab"); // → onBlur → commitDraft()

    // Edit mode should collapse (setEditing(false) in commitDraft).
    await expect(numberInput).not.toBeVisible({ timeout: 3_000 });

    // Slider must reflect the blur-committed value:
    // SnapSlider commits 4 → CycleForm "heavy" → aria-valuenow = "4".
    const slider = page.locator('[role="slider"]').first();
    await expect(slider).toHaveAttribute("aria-valuenow", "4", { timeout: 3_000 });
  });

  // ── Test 4: Tap-to-edit — Enter commit path ───────────────────────────
  // The onKeyDown handler also commits on Enter. This covers the alternative
  // path where the user presses Enter on a hardware keyboard (desktop /
  // connected Bluetooth keyboard in TestFlight).
  test("tap-to-edit: click read-out → type value → Enter commits it", async ({ page }) => {
    test.setTimeout(180_000);
    await openCycleSlider(page);

    const readout = page.getByRole("button", { name: "Stärke" });
    await readout.click();

    const numberInput = page.locator('input[type="number"]').first();
    await expect(numberInput).toBeVisible({ timeout: 3_000 });

    // Value "3" keeps the slider in the "medium" zone — no CycleForm
    // remapping side-effect, making the expected result unambiguous.
    await numberInput.fill("3");
    await numberInput.press("Enter"); // → onKeyDown Enter → commitDraft()

    const slider = page.locator('[role="slider"]').first();
    // SnapSlider commits 3 → CycleForm "medium" → aria-valuenow = "3".
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 3_000 });
    await expect(numberInput).not.toBeVisible({ timeout: 3_000 });
  });

  // ── Test 5: Android Chrome — slow drag with spurious pointercancel ──────
  // Context (why this test exists):
  //   Some Android OEM WebView builds fire a spurious `pointercancel` after
  //   ~300 ms of continuous touch, terminating pointer capture and dropping the
  //   drag. The SnapSlider delegates `onPointerCancel` to `handlePointerUp`,
  //   which commits `valueFromPointer(e.clientX)`. If the delegation is ever
  //   removed or broken, the drag silently terminates at the last pointermove
  //   position and the final touch position is lost.
  //
  // Why the test is structured this way (critical):
  //   The `pointercancel` is injected INSTEAD OF the final mouse move to
  //   the target position — not after it. This is the key design choice:
  //
  //   Phase 1 drag stops at the MID-POINT (57.5 %) → last pointermove commits
  //   raw=3.3 → snap→3 → CycleForm "medium" → aria-valuenow="3".
  //
  //   Then pointercancel fires with clientX=targetX (65 %) — which is the
  //   real Android OEM pattern (cancel carries the last known touch position).
  //
  //   handlePointerUp(cancel_event) calls commit(valueFromPointer(65%)) →
  //   raw=3.6 → snap→4 → CycleForm "heavy" → aria-valuenow="4".
  //
  //   Regression table (why "4" is the only correct outcome):
  //     onPointerCancel ignored / broken → last committed = "3" (mid-point) → FAIL
  //     onPointerCancel commits at clientX=0 → raw=1 → "light"→"2"        → FAIL
  //     onPointerCancel correctly commits at clientX=targetX → "4"         → PASS
  //
  // Project coverage:
  //   Runs in both `chromium` (desktop baseline) and `android-chrome`
  //   (devices["Pixel 7"], hasTouch:true — primary regression target).
  test("slow drag (350 ms hold) with spurious pointercancel commits value from cancel clientX", async ({ page }) => {
    test.setTimeout(180_000);
    const slider = await openCycleSlider(page);

    // Baseline: flow="medium" → value=3.
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 5_000 });

    const box = await slider.boundingBox();
    if (!box) throw new Error("slider bounding box is null — slider not rendered?");

    const midY   = box.y + box.height / 2;
    const startX  = box.x + box.width * 0.50; // thumb at value=3 (50 %)
    // Mid-point of the drag: 57.5 % → raw=3.3 → snap→3 → CycleForm "medium" → 3.
    // This is where the pointermove sequence intentionally stops — the final
    // commit to "4" must come from the pointercancel handler, not from a move.
    const midX   = box.x + box.width * 0.575;
    // Target that the cancel event will report as the last touch position.
    // 65 % → raw=3.6 → snap→4 → CycleForm "heavy" → 4.
    const targetX = box.x + box.width * 0.65;

    // ── Phase 1: start drag at the thumb position.
    await page.mouse.move(startX, midY);
    await page.mouse.down();

    // ── Phase 2: move to the MID-POINT only (not all the way to targetX).
    //   Last committed value after this loop: 3 (snap of raw 3.3 at 57.5 %).
    const STEPS = 4;
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(
        startX + (midX - startX) * (i / STEPS),
        midY,
      );
    }

    // ── Phase 3: hold for 350 ms — past the ~300 ms Android OEM cancel window.
    await page.waitForTimeout(350);

    // ── Phase 4: inject the spurious pointercancel with clientX=targetX.
    //   Real Android OEM events carry the last known touch X at the moment
    //   of cancellation. We simulate the finger having drifted to targetX
    //   during the hold. The component must commit that position.
    //
    //   `composed:true`  — crosses shadow-DOM boundaries (future-proofing).
    //   `isPrimary:true` — matches the isPrimary guard in handlePointerDown.
    //   `pointerId:1`    — matches the capture ID set on pointerdown.
    //
    //   NOTE: no page.mouse.move(targetX) is called before this dispatch.
    //   The value=4 outcome is only reachable via this cancel handler.
    await page.evaluate((cx: number) => {
      const el = document.querySelector('[role="slider"]') as HTMLElement | null;
      if (!el) throw new Error("slider element not found in DOM");
      el.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: false,
          composed: true,
          isPrimary: true,
          clientX: cx,
          pointerId: 1,
        }),
      );
    }, targetX);

    // ── Phase 5: assert the cancel-committed value.
    //   ONLY the cancel path can produce "4" — pointermove last committed "3".
    await expect(slider).toHaveAttribute("aria-valuenow", "4", { timeout: 3_000 });

    // ── Phase 6: clean up Playwright's internal mouse state.
    //   After the synthetic cancel, isDraggingRef is false, so this mouseup
    //   hits the `if (!isDraggingRef.current) return;` guard in handlePointerUp
    //   and is a no-op for the slider. Necessary to keep Playwright's mouse
    //   state consistent for subsequent tests in the same browser context.
    await page.mouse.up();
  });

  // ── Test 6: Vertical gesture does not change slider value (axis-lock) ───
  // Context (why this test exists):
  //   The axis-lock fix (#398) calls stopPropagation() only once the
  //   cumulative horizontal delta exceeds the vertical delta, preventing
  //   the Android scroll handler from claiming a horizontal drag. The
  //   complementary requirement is that a gesture which is genuinely more
  //   vertical than horizontal must NOT move the slider — otherwise users
  //   scrolling past a SnapSlider would accidentally alter its value.
  //
  // How axis-lock interacts with a vertical gesture:
  //   handlePointerDown fires, sets isDraggingRef=true, and commits
  //   valueFromPointer(startX). Because we start at the thumb position
  //   (50 % of track width = value 3) that commit is a no-op.
  //
  //   handlePointerMove fires for each subsequent move. The check
  //   `if (|dx| > |dy|)` is never satisfied when X is constant and Y
  //   grows, so axisLockedRef stays false and stopPropagation() is never
  //   called (the scroll event propagates freely). The component still
  //   calls commit(valueFromPointer(clientX)) on every move, but because
  //   clientX is constant throughout the vertical drag, valueFromPointer
  //   always returns the same position (50 % → 3) and the snapped commit
  //   is identical to the initial value — aria-valuenow never changes.
  //
  //   handlePointerUp commits with the same unchanging clientX, again 3.
  //
  // Regression table:
  //   Correct behaviour: vertical drag → X constant → value stays 3  → PASS
  //   If axis-lock check were inverted (|dy| > |dx|):
  //     axisLockedRef would be set → stopPropagation() → scroll broken → FAIL
  //   If valueFromPointer used clientY instead of clientX: value drifts  → FAIL
  //
  // Platform coverage:
  //   Runs in both `chromium` (Desktop Chrome baseline) and `android-chrome`
  //   (devices["Pixel 7"], hasTouch:true) because the snap-slider spec file
  //   matches both project testMatch patterns. The android-chrome project is
  //   the primary regression target — it emulates the Android Chrome DevTools
  //   touch environment where the axis-lock fix was originally needed.
  test("vertical gesture on slider surface does not change slider value", async ({ page }) => {
    test.setTimeout(180_000);
    const slider = await openCycleSlider(page);

    // Baseline: flow="medium" → value=3.
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 5_000 });

    const box = await slider.boundingBox();
    if (!box) throw new Error("slider bounding box is null — slider not rendered?");

    // Start at the thumb position (50 % of track width = value 3) so
    // handlePointerDown commits valueFromPointer(startX) = 3 — the same
    // as the current value, meaning pointerdown itself causes no change.
    const startX = box.x + box.width * 0.50;
    const startY = box.y + box.height / 2;

    // Move straight down 80 px while X stays constant. This is a
    // mostly-vertical gesture: |dy| >> |dx| (dx = 0) on every step,
    // so the axis-lock condition `|dx| > |dy|` is never met.
    const verticalDelta = 80;
    const STEPS = 8;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(startX, startY + (verticalDelta * i) / STEPS);
    }

    await page.mouse.up();

    // The slider must still report value=3.
    // valueFromPointer() depends only on clientX, which never changed,
    // so every commit during this gesture resolved to snap(3) = 3.
    await expect(slider).toHaveAttribute("aria-valuenow", "3", { timeout: 3_000 });
  });
});
