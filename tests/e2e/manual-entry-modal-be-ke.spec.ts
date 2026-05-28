// End-to-end coverage for BE/KE carb units inside the ManualEntryModal.
//
// Why this exists:
//   Task #58 made the manual entry modal honour the user's chosen carb unit
//   (g / BE / KE). The carbs input swaps its label, placeholder, and step;
//   the review summary calls carbUnit.display() on the converted gram value;
//   and the DB save path always writes grams (via carbUnit.toGrams()). None
//   of that path had automated coverage, so a future refactor of useCarbUnit,
//   lib/carbUnits.ts, or the modal's save path could silently regress:
//     • saving 5 BE as 5 g instead of 60 g
//     • showing "60 g KH" in the review after the user picked BE
//     • leaving the form label unchanged ("Carbs (g)") when unit is BE/KE
//
// What this asserts (and why each piece matters):
//   1. Form step — carbs input label changes to "(BE)" / "(KE)".
//      Catches regressions where the label is hardcoded or useCarbUnit does
//      not propagate into the modal on first render.
//   2. Form step — carbs input placeholder reflects the unit's example value
//      ("z.B. 5" for BE, "z.B. 6" for KE). Catches regressions where the
//      step/placeholder attributes are not driven from carbUnit.
//   3. Review step — carbs row shows the unit-converted value ("5 BE" / "5 KE"),
//      not the raw gram equivalent ("60 g KH" / "50 g KH"). Catches a missing
//      carbUnit.display() call or passing the wrong argument (typed units vs
//      converted grams).
//   4. DB — meals.carbs_grams is persisted as grams (60 for 5 BE, 50 for 5 KE),
//      not as the typed display value (5). Catches a missing toGrams() call on
//      the save path.
//
// Pattern follows tests/e2e/carb-unit-picker.spec.ts: seed/reset the
// profiles.carb_unit row via the service-role admin client, drive the real
// login flow, then clean up saved meals in afterEach.

import { expect, test, type Page } from "@playwright/test";
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
      "manual-entry-modal-be-ke spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function setCarbUnit(userId: string, unit: "g" | "BE" | "KE") {
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ carb_unit: unit })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.carb_unit update failed: ${error.message}`);
}

/**
 * Read the most recently inserted meal row for this user.
 * Returns { id, carbs_grams } so the caller can assert and clean up.
 */
async function readLatestMeal(
  userId: string,
): Promise<{ id: string; carbs_grams: number | null } | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("meals")
    .select("id, carbs_grams")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`meals read failed: ${error.message}`);
  return data as { id: string; carbs_grams: number | null } | null;
}

async function deleteMeal(mealId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("id", mealId);
  if (error) throw new Error(`meals cleanup failed: ${error.message}`);
}

async function loginAsTestUser(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/**
 * Open the ManualEntryModal from the /entries page.
 *
 * Flow:
 *   1. Click the "+ Eintrag" / "+ Entry" CTA button (has aria-haspopup="menu").
 *   2. Click "Mahlzeit manuell eintragen" / "Add meal manually" in the menu.
 *   3. Wait for the modal title to appear.
 */
async function openManualEntryModal(page: Page) {
  // Two buttons on /entries share aria-haspopup="menu":
  //   • QuickAddMenu (header FAB) — has an explicit aria-label
  //     ("Schnell loggen" / "Quick log")
  //   • EntryAddCTA (full-width page CTA) — no aria-label, text is
  //     "Eintrag" (de) / "Entry" (en) after the "+" icon span
  // getByRole scoped to the text "Eintrag|Entry" targets only the CTA.
  const ctaBtn = page.getByRole("button", {
    name: /\+?\s*(Eintrag|Entry)\b/i,
  });
  await expect(ctaBtn).toBeVisible({ timeout: 20_000 });
  await ctaBtn.click();

  // Menu item: de = "Mahlzeit manuell eintragen", en = "Add meal manually"
  const manualMenuItem = page.getByRole("menuitem", {
    name: /Mahlzeit manuell|Add meal manually/i,
  });
  await expect(manualMenuItem).toBeVisible({ timeout: 5_000 });
  await manualMenuItem.click();

  // Wait for modal title: de = "Neuer manueller Eintrag", en = "New manual entry"
  await expect(
    page.getByText(/Neuer manueller Eintrag|New manual entry/i),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Drives the full manual entry modal flow for a given BE/KE unit:
 *   form step → assert label + placeholder → fill carbs → advance to review
 *   → assert review carb display → save → assert DB grams.
 *
 * Returns the id of the saved meal row so the caller can clean it up.
 *
 * Selector strategy for the carbs input:
 *   The modal renders the carbs input with step={carbUnit.step}, which is
 *   0.5 for BE and KE (versus 1 for grams). All other numeric inputs in the
 *   modal use implicit step="any" or step="0.5" only for insulin — but
 *   insulin is rendered further down the form. We wait for the label text
 *   to confirm the unit resolved before touching the input, then locate it
 *   as the first input[step="0.5"] inside the visible modal.
 */
async function runModalFlow(
  page: Page,
  userId: string,
  {
    typedValue,
    expectedLabelRegex,
    expectedPlaceholder,
    expectedReviewText,
    expectedGrams,
  }: {
    typedValue: string;
    expectedLabelRegex: RegExp;
    expectedPlaceholder: string;
    expectedReviewText: RegExp;
    expectedGrams: number;
  },
): Promise<string> {
  // ── FORM STEP: assert the carbs label reflects the chosen unit ────────────
  // The label is built as:
  //   `${t("carbs_label").replace(/\s*\([^)]*\)\s*$/, "").trim()} (${carbUnit.label})`
  // so "Carbs (g)" → "Carbs (BE)" / "Carbs (KE)".
  // We wait here because useCarbUnit fetches profiles.carb_unit asynchronously
  // on mount — the label only flips once the Supabase read completes.
  await expect(page.getByText(expectedLabelRegex)).toBeVisible({ timeout: 15_000 });

  // ── FORM STEP: assert the placeholder matches the unit ────────────────────
  // carbUnit.placeholder: BE → "z.B. 5", KE → "z.B. 6"
  // The carbs input is the first input[type=number] with step="0.5" in the
  // modal (both BE and KE share step=0.5; the insulin input also has step=0.5
  // but it is further down — this is the first one in DOM order).
  const carbsInput = page.locator("input[type='number'][step='0.5']").first();
  await expect(carbsInput).toHaveAttribute("placeholder", expectedPlaceholder);

  // Fill the carbs field with the typed value in display units
  await carbsInput.fill(typedValue);

  // ── FORM STEP → REVIEW: click "Weiter →" / "Next →" ─────────────────────
  const nextBtn = page.getByRole("button", { name: /^(Weiter|Next)/i });
  await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
  await nextBtn.click();

  // ── REVIEW STEP: assert carbs row shows the unit-converted display value ──
  // Row renders: <span>{t("row_carbs")}</span><span>{carbUnit.display(grams)}</span>
  // carbUnit.display(60) with unit=BE → "5 BE"
  // carbUnit.display(50) with unit=KE → "5 KE"
  await expect(page.getByText(expectedReviewText)).toBeVisible({ timeout: 5_000 });

  // ── SAVE ─────────────────────────────────────────────────────────────────
  const confirmBtn = page.getByRole("button", { name: /Bestätigen|Confirm/i });
  await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
  await confirmBtn.click();

  // Wait for the "Gespeichert ✓" / "Saved ✓" state to appear in the button,
  // which is the save-complete signal set by handleSubmit.
  await expect(
    page.getByRole("button", { name: /Gespeichert|Saved/i }),
  ).toBeVisible({ timeout: 20_000 });

  // ── DB ASSERTION: carbs_grams must be persisted as grams, not display units
  // This is the regression-critical check: if toGrams() is ever dropped or
  // bypassed on the save path, the persisted value would be 5 (the typed
  // display value) instead of 60 / 50 (the canonical gram amount).
  const saved = await readLatestMeal(userId);
  expect(saved).not.toBeNull();
  expect(saved!.carbs_grams).toBe(expectedGrams);

  return saved!.id;
}

// ──────────────────────────────────────────────────────────────────────────────

test.describe("ManualEntryModal — BE/KE carb unit end-to-end", () => {
  let testUser: TestUser;
  let savedMealId: string | null = null;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    // Reset to g so each test starts from a deterministic baseline.
    await setCarbUnit(testUser.userId, "g");
    await loginAsTestUser(page, testUser.email, testUser.password);
  });

  test.afterEach(async () => {
    // Delete the meal row saved during the test so re-runs start fresh
    // and other specs see a clean meal table.
    if (savedMealId) {
      await deleteMeal(savedMealId);
      savedMealId = null;
    }
    // Always restore the default unit so other specs are not affected.
    await setCarbUnit(testUser.userId, "g");
  });

  // ── BE · 1 BE = 12 g ──────────────────────────────────────────────────────
  //
  // User types "5" into the BE-labelled carbs field.
  // Expected: review shows "5 BE", DB stores 60 g (5 × 12).
  test("BE mode: label shows (BE), review shows 5 BE, DB stores 60 g", async ({ page }) => {
    await setCarbUnit(testUser.userId, "BE");

    await page.goto("/entries");
    await openManualEntryModal(page);

    savedMealId = await runModalFlow(page, testUser.userId, {
      typedValue: "5",
      // carbsLabel = "Carbs (BE)" — both de/en locales strip "(g)" and append "(BE)"
      expectedLabelRegex: /Carbs\s*\(BE\)/i,
      // CARB_UNITS.BE.placeholder = "z.B. 5"
      expectedPlaceholder: "z.B. 5",
      // carbUnit.display(60) with unit=BE → formatCarbs(60, "BE") → "5 BE"
      expectedReviewText: /^5 BE$/,
      // 5 BE × 12 g/BE = 60 g
      expectedGrams: 60,
    });
  });

  // ── KE · 1 KE = 10 g ──────────────────────────────────────────────────────
  //
  // User types "5" into the KE-labelled carbs field.
  // Expected: review shows "5 KE", DB stores 50 g (5 × 10).
  test("KE mode: label shows (KE), review shows 5 KE, DB stores 50 g", async ({ page }) => {
    await setCarbUnit(testUser.userId, "KE");

    await page.goto("/entries");
    await openManualEntryModal(page);

    savedMealId = await runModalFlow(page, testUser.userId, {
      typedValue: "5",
      // carbsLabel = "Carbs (KE)"
      expectedLabelRegex: /Carbs\s*\(KE\)/i,
      // CARB_UNITS.KE.placeholder = "z.B. 6"
      expectedPlaceholder: "z.B. 6",
      // carbUnit.display(50) with unit=KE → formatCarbs(50, "KE") → "5 KE"
      expectedReviewText: /^5 KE$/,
      // 5 KE × 10 g/KE = 50 g
      expectedGrams: 50,
    });
  });
});
