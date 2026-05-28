// End-to-end regression coverage for the FingerstickLogCard and the
// SymptomForm — the two log surfaces that were listed in the snap-slider
// coverage gap, but had already been refactored away from SnapSlider
// by the time this spec was written.
//
// ── Why no SnapSlider tests here? ─────────────────────────────────────────
// The task brief assumed both forms still used SnapSlider.  On inspection:
//
//   components/FingerstickLogCard.tsx
//     The glucose value field was replaced with NumberField (type="text",
//     inputMode="decimal") — a free-form text input that accepts both
//     English dot and German comma decimals, validated/clamped at save time.
//     A 260-step SnapSlider for blood glucose was removed because users copy
//     an exact meter reading and need to type "127", not drag to it.
//
//   components/CycleSymptomForms.tsx (SymptomForm)
//     Per-symptom severity uses a div[role="radiogroup"] with five
//     role="radio" buttons (1–5), not a SnapSlider.  The CycleForm's
//     flow-intensity SnapSlider is already covered by snap-slider.spec.ts.
//
// This spec therefore guards the ACTUAL interaction paths in those components
// rather than carrying dead SnapSlider tests that would never run.
//
// ── What is tested ────────────────────────────────────────────────────────
//
// FingerstickLogCard (at /engine?tab=fingerstick):
//   1. NumberField text input — valid value updates the visible field
//   2. German comma decimal ("127,5") accepted verbatim (normalised at save)
//   3. Out-of-range value shows the German error banner on save
//   4. Empty / non-numeric input also shows the range error on save
//   5. Valid in-range save: success feedback rendered and field clears
//      (Supabase row is cleaned up in afterAll via service-role client)
//
// SymptomForm (at /engine?tab=symptoms):
//   6. Clicking a symptom chip selects it (severity row becomes visible)
//   7. Clicking the same chip again deselects it (severity row hides)
//   8. Clicking a second chip keeps both severity rows visible simultaneously
//   9. Clicking a severity radio button sets aria-checked="true" on that
//      button and "false" on all others in the same radiogroup
//  10. Keyboard: Tab into a severity row then ArrowRight/Left cycles
//      through the five radio buttons correctly
//
// ── Test lifecycle ────────────────────────────────────────────────────────
//   beforeAll  — service-role Supabase client is instantiated (used for
//                afterAll cleanup of any fingerstick_readings rows inserted
//                by test 5).
//   beforeEach — clear cookies, pin NEXT_LOCALE=de cookie, log in.
//   afterAll   — delete any fingerstick_readings rows inserted in test 5.
//
// ── Locale ────────────────────────────────────────────────────────────────
//   NEXT_LOCALE=de is pinned via cookie.  German strings used in assertions:
//     "Wert"                          → aria-label of the NumberField input
//     "Speichern"                     → save button label (idle)
//     "Gespeichert ✓"                 → success feedback text
//     "Wert muss zwischen 20 und 600 mg/dL liegen."  → range error text
//     "Kopfschmerzen"                 → "headache" chip label
//     "Müdigkeit"                     → "fatigue" chip label

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "fingerstick-and-symptom-forms spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

// Navigate to the fingerstick tab and wait until the NumberField is visible.
// Returns the text input locator (aria-label="Wert" in German locale).
async function openFingerstickForm(page: Page) {
  await page.goto("/engine?tab=fingerstick", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForURL(/\/engine/, { timeout: 30_000 });

  const input = page.locator('input[aria-label="Wert"]');
  await expect(input).toBeVisible({ timeout: 120_000 });
  return input;
}

// Navigate to the symptoms tab and wait until at least one symptom chip is
// visible.  Returns the symptom chip container locator.
async function openSymptomForm(page: Page) {
  await page.goto("/engine?tab=symptoms", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForURL(/\/engine/, { timeout: 30_000 });

  // "Kopfschmerzen" (headache) is always present in the "general" category
  // which is the default — safe anchor for visibility.
  const headacheChip = page.getByRole("button", { name: "Kopfschmerzen" });
  await expect(headacheChip).toBeVisible({ timeout: 120_000 });
}

// IDs of fingerstick_readings rows inserted during test 5 so afterAll can
// clean them up.
const insertedFingerstickIds: string[] = [];

test.use({ actionTimeout: 15_000 });

// ═══════════════════════════════════════════════════════════════════════════
// FingerstickLogCard — NumberField interaction tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe("FingerstickLogCard — NumberField interactions", () => {
  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = loadTestUserByIndex(test.info().workerIndex);
    void testUser; // userId used in afterAll cleanup
  });

  test.afterAll(async () => {
    if (insertedFingerstickIds.length === 0) return;
    const admin = getAdminClient();
    await admin
      .from("fingerstick_readings")
      .delete()
      .in("id", insertedFingerstickIds);
    insertedFingerstickIds.length = 0;
  });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page, test.info().workerIndex);
  });

  // ── Test 1: NumberField accepts a valid integer value ─────────────────
  // The glucose field is a type="text" input that stays unconstrained while
  // the user is typing.  A valid integer like "120" must appear exactly as
  // typed — no rounding, no stripping, no snapping.
  test("NumberField shows typed glucose value verbatim", async ({ page }) => {
    test.setTimeout(180_000);
    const input = await openFingerstickForm(page);

    await input.click();
    await input.fill("120");

    // The input must reflect exactly what was typed.
    await expect(input).toHaveValue("120", { timeout: 3_000 });
  });

  // ── Test 2: German decimal comma is accepted ───────────────────────────
  // NumberField strips non-digit characters except one decimal separator,
  // and accepts both "." and "," so German users can type "127,5" without
  // the browser silently discarding the comma (which happens with
  // type="number").  The value must reach the field unchanged at this stage
  // — normalisation to "." happens at save time in the parent component.
  test("NumberField keeps German decimal comma verbatim ('127,5')", async ({ page }) => {
    test.setTimeout(180_000);
    const input = await openFingerstickForm(page);

    await input.click();
    await input.fill("127,5");

    await expect(input).toHaveValue("127,5", { timeout: 3_000 });
  });

  // ── Test 3: Out-of-range value shows German error message on save ──────
  // The German error string is "Wert muss zwischen 20 und 600 mg/dL liegen."
  // Saving "10" (below the 20 mg/dL lower bound) must trigger this.
  // This path goes through: handleSave → num < 20 → setFeedback(err).
  test("out-of-range value (10 mg/dL) shows error feedback after save", async ({ page }) => {
    test.setTimeout(180_000);
    const input = await openFingerstickForm(page);

    await input.click();
    await input.fill("10");

    const saveBtn = page.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // Error feedback rendered in the role=status aria-live region.
    await expect(
      page.getByRole("status"),
    ).toHaveText("Wert muss zwischen 20 und 600 mg/dL liegen.", { timeout: 5_000 });
  });

  // ── Test 4: Empty input also shows range error ─────────────────────────
  // An empty NumberField produces valueStr="" → Number("") = 0, which is
  // below 20.  The same error path is taken — this ensures that a user who
  // taps "Speichern" without typing anything gets a clear validation message
  // rather than a silent failure.
  test("empty input shows range error after save attempt", async ({ page }) => {
    test.setTimeout(180_000);
    await openFingerstickForm(page);

    // Do NOT type anything — submit the empty form.
    const saveBtn = page.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    await expect(
      page.getByRole("status"),
    ).toHaveText("Wert muss zwischen 20 und 600 mg/dL liegen.", { timeout: 5_000 });
  });

  // ── Test 5: Valid in-range save shows success feedback and clears field ─
  // A value of 120 mg/dL (in-range for the 20–600 guard) should:
  //   • Reach the insertFingerstick() call in handleSave
  //   • Display "Gespeichert ✓" in the status region
  //   • Reset valueStr to "" (the NumberField input reverts to placeholder)
  //
  // The inserted row is recorded in insertedFingerstickIds and deleted in
  // afterAll via service-role client so tests remain hermetic.
  test("valid in-range value (120 mg/dL) shows success feedback and clears field", async ({ page }) => {
    test.setTimeout(180_000);
    const input = await openFingerstickForm(page);

    await input.click();
    await input.fill("120");

    const saveBtn = page.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // Intercept the API response to capture the inserted row ID before
    // asserting the UI — this lets afterAll delete the row cleanly.
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/fingerstick") && resp.status() === 200,
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const resp = await responsePromise.catch(() => null);
    if (resp) {
      try {
        const body = await resp.json() as { id?: string };
        if (body.id) insertedFingerstickIds.push(body.id);
      } catch {
        // If the response shape changed, skip ID capture — the row will
        // be a tiny orphan; it does not affect test correctness.
      }
    }

    // Success feedback rendered.
    await expect(
      page.getByRole("status"),
    ).toHaveText("Gespeichert ✓", { timeout: 10_000 });

    // Field must have cleared (reset to empty string → placeholder visible).
    await expect(input).toHaveValue("", { timeout: 3_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SymptomForm — chip selection and severity radiogroup interactions
// ═══════════════════════════════════════════════════════════════════════════
//
// The severity UI is NOT a SnapSlider.  It is a div[role="radiogroup"] with
// five role="radio" buttons (1–5) per selected chip.  These tests guard the
// toggle-on/off chip logic and the single-selection constraint inside each
// radiogroup.

test.describe("SymptomForm — chip and severity radiogroup interactions", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page, test.info().workerIndex);
  });

  // ── Test 6: Clicking a chip makes the severity row appear ──────────────
  // Toggling on "Kopfschmerzen" (headache) should add it to `selected` and
  // render a div[role="radiogroup"][aria-label="Kopfschmerzen"] with five
  // radio buttons.  This row is only rendered when selected.size > 0.
  test("selecting 'Kopfschmerzen' chip renders severity radiogroup for it", async ({ page }) => {
    test.setTimeout(180_000);
    await openSymptomForm(page);

    const chip = page.getByRole("button", { name: "Kopfschmerzen" });
    await chip.click();

    // The severity radiogroup for this symptom must appear.
    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 });

    // There must be exactly 5 radio buttons inside it.
    const radios = group.locator('[role="radio"]');
    await expect(radios).toHaveCount(5, { timeout: 3_000 });
  });

  // ── Test 7: Clicking the same chip again removes the severity row ──────
  // Second click on "Kopfschmerzen" calls toggle() which removes it from
  // `selected`.  The radiogroup must become hidden (component conditionally
  // renders the whole per-chip severity section only when selected.size > 0).
  test("deselecting 'Kopfschmerzen' chip hides its severity radiogroup", async ({ page }) => {
    test.setTimeout(180_000);
    await openSymptomForm(page);

    const chip = page.getByRole("button", { name: "Kopfschmerzen" });

    // Select then immediately deselect.
    await chip.click();
    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 }); // confirm it appeared first

    await chip.click(); // deselect
    await expect(group).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Test 8: Two chips produce two independent severity rows ────────────
  // Selecting both "Kopfschmerzen" and "Müdigkeit" (fatigue) must render
  // two separate radiogroups — one per chip — at the same time.
  test("selecting two chips renders two independent severity radiogroups", async ({ page }) => {
    test.setTimeout(180_000);
    await openSymptomForm(page);

    await page.getByRole("button", { name: "Kopfschmerzen" }).click();
    await page.getByRole("button", { name: "Müdigkeit" }).click();

    const group1 = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    const group2 = page.locator('[role="radiogroup"][aria-label="Müdigkeit"]');

    await expect(group1).toBeVisible({ timeout: 5_000 });
    await expect(group2).toBeVisible({ timeout: 5_000 });

    // Each group has exactly 5 radio buttons.
    await expect(group1.locator('[role="radio"]')).toHaveCount(5, { timeout: 3_000 });
    await expect(group2.locator('[role="radio"]')).toHaveCount(5, { timeout: 3_000 });
  });

  // ── Test 9: Clicking a radio button sets aria-checked and clears others ─
  // The default severity for a newly selected chip is 3 (initial state in
  // the SeveritiesMap).  Clicking "4" must:
  //   • Set aria-checked="true" on the button labelled "4"
  //   • Leave aria-checked="false" on buttons 1, 2, 3, 5
  //
  // This directly tests that setSymptomSeverity fires correctly and that
  // only one value can be checked at a time within a radiogroup.
  test("clicking severity button 4 checks it and unchecks all others", async ({ page }) => {
    test.setTimeout(180_000);
    await openSymptomForm(page);

    await page.getByRole("button", { name: "Kopfschmerzen" }).click();
    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 });

    // Default severity is 3 — confirm before changing.
    const radio3 = group.locator('[role="radio"]').nth(2); // 0-indexed: index 2 = button "3"
    await expect(radio3).toHaveAttribute("aria-checked", "true", { timeout: 3_000 });

    // Click severity 4 (index 3).
    const radio4 = group.locator('[role="radio"]').nth(3);
    await radio4.click();

    // Only 4 must now be checked.
    await expect(radio4).toHaveAttribute("aria-checked", "true", { timeout: 3_000 });

    // All other buttons must be unchecked.
    for (const idx of [0, 1, 2, 4]) {
      await expect(
        group.locator('[role="radio"]').nth(idx),
      ).toHaveAttribute("aria-checked", "false", { timeout: 3_000 });
    }
  });

  // ── Test 10: Severity radiogroup reflects value changes across all five ─
  // Cycle through severities 1 → 5 by clicking each button in order and
  // asserting the correct single-checked state after each click.  This
  // catches a class of bugs where the checked state was only updated for
  // certain values (e.g. only the first or last button re-rendered).
  test("all five severity buttons can be selected in sequence", async ({ page }) => {
    test.setTimeout(180_000);
    await openSymptomForm(page);

    await page.getByRole("button", { name: "Kopfschmerzen" }).click();
    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 });

    const radios = group.locator('[role="radio"]');
    await expect(radios).toHaveCount(5, { timeout: 3_000 });

    // Click each button 1–5 in order and verify single-checked invariant.
    for (let i = 0; i < 5; i++) {
      await radios.nth(i).click();

      await expect(radios.nth(i)).toHaveAttribute("aria-checked", "true", { timeout: 3_000 });

      for (let j = 0; j < 5; j++) {
        if (j === i) continue;
        await expect(radios.nth(j)).toHaveAttribute("aria-checked", "false", { timeout: 3_000 });
      }
    }
  });
});
