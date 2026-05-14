// Task #282 — End-to-end coverage that the German chip labels actually
// render in the /entries list, not just inside the `chipLabelsFrom`
// helper that Task #281 pinned via a unit test.
//
// Why this exists:
//   Task #279 introduced an i18n-aware `chipLabelsFrom(t)` and Task #281
//   added `tests/unit/chipsDeLocale.test.ts` that locks the helper's
//   contract: every outcome / meal-type key resolves to its German
//   string when fed the production `messages/de.json` `chips` namespace.
//   That covers a key-pattern drift in `lib/mealTypes.ts` (e.g. swapping
//   `eval_GOOD` → `evalGOOD`), but it does NOT exercise the rendered
//   DOM in the entries / dashboard pages. A regression in how those
//   pages call `useChipLabels` (forgetting to pass the chips namespace,
//   rendering the raw enum instead of the label, missing the `title`
//   tooltip) would still reach users while the unit test stays green.
//
// What this asserts (and why each piece matters):
//   1. With the locale pinned to `de`, /entries renders the German
//      outcome label inside the chip element for every outcome the
//      lifecycle evaluator can produce — GOOD, UNDERDOSE, OVERDOSE,
//      SPIKE, SPIKE_STRONG, HYPO_DURING (six of the seven enum cases;
//      see CHECK_CONTEXT note below).
//   2. The meal-type pill carries the German full label as its `title`
//      attribute (the visible text is the language-agnostic short code
//      "FC" / "HP" / "HF" / "B"), so hovering the pill surfaces e.g.
//      "Schnelle Kohlenhydrate" rather than the English "Fast Carbs".
//      All four classifications (FAST_CARBS, HIGH_PROTEIN, HIGH_FAT,
//      BALANCED) are covered across the seeded rows.
//
//   CHECK_CONTEXT is intentionally NOT exercised here — there is no
//   current `evaluateEntry` path that emits it, so it can only appear
//   on legacy rows whose `meal.evaluation` column was historically set
//   to that string AND whose recomputed lifecycle returns null outcome.
//   `chipForMeal` only surfaces an outcome chip in `final` state (which
//   always assigns lc.outcome), so a synthetic row would not render the
//   chip we care about. The unit test in `tests/unit/chipsDeLocale.test.ts`
//   pins the German label for that key.
//
// Seeding strategy:
//   We bypass the UI and insert meals directly via the service-role
//   admin client (same channel `tests/support/testUser.ts` and the
//   carb-unit-picker spec already use). Each seed row is crafted to
//   force `lifecycleFor` into the `final` branch (`hasCurve` via
//   `min_bg_180`) and to drive `evaluateEntry` to one specific outcome.
//   The thresholds we rely on (Task #251 spike cutoffs, Task #187 hypo
//   guards, the Δ_2h ±30 mg/dL band) are documented at each row.
//
// We also cover the four meal-type buckets across the same six rows by
// rotating `meal_type`, so a single fixture set covers both axes the
// task asked for.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

// Same admin-client shape the carb-unit-picker spec uses — env vars
// are already required by the suite via global-setup, so re-creating
// the client here adds no new coupling.
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "entries-chips-de spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cookie name lib/locale.ts writes; must match what i18n/request.ts
// reads on the server side.
const LOCALE_COOKIE = "NEXT_LOCALE";

async function pinDeLocale(context: BrowserContext, baseURL: string) {
  await context.clearCookies();
  await context.addCookies([{
    name: LOCALE_COOKIE,
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
}

// LanguageSync (mounted in the protected layout) reconciles the cookie
// against `profiles.language` on every navigation — if a previous spec
// left this column at "en" the cookie would silently flip back. Pin it
// to "de" before each run AND in afterEach to restore the suite-wide
// baseline.
async function setProfileLanguage(userId: string, language: "de" | "en") {
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ language })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.language set failed: ${error.message}`);
}

async function clearAllMeals(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("user_id", userId);
  if (error) throw new Error(`meals cleanup failed: ${error.message}`);
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

/* ──────────────────────────────────────────────────────────────────
   Seed fixtures. Each row is engineered against a specific branch of
   `lib/engine/evaluation.ts::evaluateEntry` so the resulting
   `chip.finalOutcome` is deterministic. Spike cutoffs by classification:
     FAST_CARBS = 70, HIGH_PROTEIN = 50, HIGH_FAT = 40, BALANCED = 55.
   Δ-band: |Δ_2h| ≤ 30 → GOOD, > 30 → UNDER/OVERDOSE (when below cutoff).
   ────────────────────────────────────────────────────────────────── */

interface SeedRow {
  meal_type: "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED";
  carbs: number;
  insulin: number;
  bg_before: number;
  bg_2h: number;
  min_bg_180: number;
  max_bg_180: number | null;
  had_hypo_window: boolean | null;
  // For documentation + assertion mapping (string is the chips DE label).
  expectedOutcome: "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE" | "SPIKE_STRONG" | "HYPO_DURING";
  expectedEvalLabelDe: string;
  expectedTypeLabelDe: string;
}

const SEED: SeedRow[] = [
  // 1) GOOD + FAST_CARBS — Δ_2h = +10 (≤30); peakRise small (no spike);
  //    no hypo. Hits the `delta` branch with GOOD.
  {
    meal_type: "FAST_CARBS",
    carbs: 40, insulin: 4,
    bg_before: 100, bg_2h: 110,
    min_bg_180: 95, max_bg_180: 125, had_hypo_window: false,
    expectedOutcome: "GOOD",
    expectedEvalLabelDe: "Gut",
    expectedTypeLabelDe: "Schnelle Kohlenhydrate",
  },
  // 2) UNDERDOSE + HIGH_PROTEIN — Δ_2h = +45 (>30 and ≤ HIGH_PROTEIN
  //    cutoff 50, so spike does NOT fire). max_bg_180 omitted so the
  //    peak-based spike trigger stays inert.
  {
    meal_type: "HIGH_PROTEIN",
    carbs: 60, insulin: 2,
    bg_before: 100, bg_2h: 145,
    min_bg_180: 100, max_bg_180: null, had_hypo_window: false,
    expectedOutcome: "UNDERDOSE",
    expectedEvalLabelDe: "Unterdosis",
    expectedTypeLabelDe: "Eiweißreich",
  },
  // 3) OVERDOSE + HIGH_FAT — Δ_2h = -60 (< -30); no curve hypo
  //    (min_bg_180 ≥ 70); spike requires positive rise so it doesn't
  //    trigger on a drop.
  {
    meal_type: "HIGH_FAT",
    carbs: 40, insulin: 10,
    bg_before: 180, bg_2h: 120,
    min_bg_180: 110, max_bg_180: 180, had_hypo_window: false,
    expectedOutcome: "OVERDOSE",
    expectedEvalLabelDe: "Überdosis",
    expectedTypeLabelDe: "Fettreich",
  },
  // 4) SPIKE + BALANCED — peakRise = 60 > BALANCED cutoff 55, but
  //    60 < 55 × 1.5 (=82.5) so SPIKE_STRONG is NOT promoted. Δ_2h is
  //    small so the post-meal landing is back inside the band.
  {
    meal_type: "BALANCED",
    carbs: 50, insulin: 4,
    bg_before: 100, bg_2h: 120,
    min_bg_180: 95, max_bg_180: 160, had_hypo_window: false,
    expectedOutcome: "SPIKE",
    expectedEvalLabelDe: "Spike",
    expectedTypeLabelDe: "Ausgewogen",
  },
  // 5) SPIKE_STRONG + FAST_CARBS — peakRise = 110 > 70 × 1.5 (=105) so
  //    the magnitude path promotes the SPIKE to SPIKE_STRONG.
  {
    meal_type: "FAST_CARBS",
    carbs: 60, insulin: 4,
    bg_before: 100, bg_2h: 120,
    min_bg_180: 95, max_bg_180: 210, had_hypo_window: false,
    expectedOutcome: "SPIKE_STRONG",
    expectedEvalLabelDe: "Starker Spike",
    expectedTypeLabelDe: "Schnelle Kohlenhydrate",
  },
  // 6) HYPO_DURING + HIGH_PROTEIN — `had_hypo_window: true` is the
  //    primary curve-aware trigger; `min_bg_180: 55` (< 70) is a
  //    second guarantee in case the boolean column is dropped on a
  //    future migration.
  {
    meal_type: "HIGH_PROTEIN",
    carbs: 40, insulin: 4,
    bg_before: 100, bg_2h: 110,
    min_bg_180: 55, max_bg_180: 130, had_hypo_window: true,
    expectedOutcome: "HYPO_DURING",
    expectedEvalLabelDe: "Hypo im Verlauf",
    expectedTypeLabelDe: "Eiweißreich",
  },
];

async function seedMeals(userId: string, rows: SeedRow[]) {
  const admin = getAdminClient();
  const now = Date.now();
  const inserts = rows.map((r, i) => {
    // Stagger meals 6h apart, all in the past, so they appear together
    // on /entries (which sorts newest-first by meal_time) and the
    // default "All time" date filter shows all six.
    const mealMs = now - (rows.length - i) * 6 * 3600_000;
    const mealIso = new Date(mealMs).toISOString();
    return {
      user_id: userId,
      input_text: `chips DE e2e #${i} (${r.expectedOutcome})`,
      meal_time: mealIso,
      created_at: mealIso,
      carbs_grams: r.carbs,
      insulin_units: r.insulin,
      meal_type: r.meal_type,
      glucose_before: r.bg_before,
      bg_2h: r.bg_2h,
      bg_2h_at: new Date(mealMs + 120 * 60_000).toISOString(),
      min_bg_180: r.min_bg_180,
      max_bg_180: r.max_bg_180,
      had_hypo_window: r.had_hypo_window,
    };
  });
  const { error } = await admin.from("meals").insert(inserts);
  if (error) throw new Error(`meals seed failed: ${error.message}`);
}

test.describe("Entries → German chips render in the list (Task #282)", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    // Pristine baseline on both surfaces the locale resolution reads:
    // the NEXT_LOCALE cookie (server-side i18n config) AND
    // profiles.language (LanguageSync reconciliation on every nav).
    await pinDeLocale(context, baseURL!);
    await setProfileLanguage(testUser.userId, "de");
    // Wipe meals so the assertions only see our six fixtures and the
    // dashboard's auto-seeded sample meals (only seeded for empty users)
    // never run for this user. We re-clear in afterEach for the next spec.
    await clearAllMeals(testUser.userId);
    await seedMeals(testUser.userId, SEED);
  });

  test.afterEach(async ({ context, baseURL }) => {
    await clearAllMeals(testUser.userId);
    // Restore the suite-wide DE baseline both the language-picker spec
    // and other consumers expect.
    await pinDeLocale(context, baseURL!);
    await setProfileLanguage(testUser.userId, "de");
  });

  test("each outcome chip renders its German label and each meal-type pill carries its German tooltip", async ({ page }) => {
    await loginAsTestUser(page);

    // Sanity that the cookie is still on "de" after login (the
    // profile-sync path could have flipped it). If this fails the rest
    // of the assertions would all read English, so catching it here
    // pinpoints the regression to the locale wiring instead.
    const cookies = await page.context().cookies();
    const localeCookie = cookies.find((c) => c.name === LOCALE_COOKIE);
    expect(localeCookie?.value).toBe("de");

    await page.goto("/entries");

    // Wipe persisted entries-page filters so date-range isn't accidentally
    // narrowed to a window that excludes our fixtures (the chip-filter
    // spec already documents this gotcha).
    await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
    await page.reload();

    // Wait for the list to mount — every seeded row produces one
    // `MealEntryCardCollapsed`, identifiable by its outcome pill text.
    // Use the GOOD ("Gut") chip as the readiness signal because it has
    // the shortest, most distinctive label.
    await expect(
      page.locator('span.glev-mec-eval', { hasText: /^Gut$/ }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // ---- OUTCOME CHIP TEXT (chips namespace via chipLabelsFrom) ----
    // Each German label must appear on at least one rendered chip.
    // We scope to `span.glev-mec-eval` (the outcome pill class set in
    // MealEntryCardCollapsed) so a stray match elsewhere on the page
    // (e.g. an empty-state copy or a filter chip) can't satisfy the
    // assertion. Exact-match regex defends against a future label
    // that happens to be a prefix of another (e.g. "Spike" vs
    // "Starker Spike" — without anchoring, `getByText("Spike")` would
    // match both).
    const outcomeCases: Array<{ label: string; outcome: string }> = SEED.map((r) => ({
      label: r.expectedEvalLabelDe,
      outcome: r.expectedOutcome,
    }));
    for (const { label, outcome } of outcomeCases) {
      const chip = page.locator('span.glev-mec-eval', {
        hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      });
      await expect(
        chip.first(),
        `outcome chip for ${outcome} should render German label "${label}"`,
      ).toBeVisible();
    }

    // English fallbacks must NOT leak through anywhere in the outcome
    // chip column — that's exactly the regression Task #282 is meant
    // to catch (chipLabelsFrom wired with the wrong namespace, raw
    // enum rendered, etc). Spot-check the most likely English strings.
    const englishLeaks = ["Good", "Under Dose", "Over Dose", "Strong Spike", "Hypo During"];
    for (const en of englishLeaks) {
      await expect(
        page.locator("span.glev-mec-eval", { hasText: new RegExp(`^${en}$`) }),
        `English outcome label "${en}" must not leak when locale=de`,
      ).toHaveCount(0);
    }

    // ---- TYPE PILL TOOLTIP (chips namespace via chipLabelsFrom) ----
    // The type column renders the language-agnostic short code
    // ("FC" / "HP" / "HF" / "B") with the FULL German label exposed
    // via the `title` attribute on the same span. That `title` is the
    // tooltip surface chipLabelsFrom feeds — assert each of the four
    // classifications has at least one matching pill.
    const typeLabelsDe = Array.from(new Set(SEED.map((r) => r.expectedTypeLabelDe)));
    for (const label of typeLabelsDe) {
      const titled = page.locator(`span[title="${label}"]`);
      await expect(
        titled.first(),
        `meal-type pill must expose German tooltip "${label}"`,
      ).toBeVisible();
    }

    // ---- OUTCOME CHIP TOOLTIP (engine namespace via renderEngineMessages) ----
    // Beyond the chip's visible label, the same span carries a `title`
    // attribute populated by `renderEngineMessages(tEngine, chip.body)`
    // (see components/MealEntryCardCollapsed.tsx). For final-state chips
    // that body is the engine evaluator's reasoning string — verify the
    // GOOD row's tooltip carries the German `engine_eval_good` copy
    // ("Glukose blieb innerhalb von ±30 mg/dL …") and not its English
    // sibling. Catches a regression where a future refactor wires the
    // tooltip through the wrong translator namespace.
    const goodChip = page.locator('span.glev-mec-eval', { hasText: /^Gut$/ }).first();
    const goodTitle = await goodChip.getAttribute("title");
    expect(goodTitle, "GOOD chip must expose a non-empty German tooltip").toBeTruthy();
    expect(goodTitle!).toContain("Glukose blieb innerhalb");
    expect(goodTitle!).not.toContain("stayed within");

    // And the English type labels must not appear as tooltips either.
    const englishTypeLeaks = ["Fast Carbs", "High Protein", "High Fat", "Balanced"];
    for (const en of englishTypeLeaks) {
      await expect(
        page.locator(`span[title="${en}"]`),
        `English type tooltip "${en}" must not leak when locale=de`,
      ).toHaveCount(0);
    }
  });
});
