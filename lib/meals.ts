import { supabase } from "./supabase";
import { logDebug } from "./debug";

export interface ParsedFood {
  name: string;
  grams: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

export interface Meal {
  id: string;
  user_id: string;
  input_text: string;
  parsed_json: ParsedFood[];
  glucose_before: number | null;
  glucose_after: number | null;
  bg_1h: number | null;
  bg_1h_at: string | null;
  bg_2h: number | null;
  bg_2h_at: string | null;
  outcome_state: "pending" | "provisional" | "final" | null;
  meal_time: string | null;
  carbs_grams: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fiber_grams: number | null;
  calories: number | null;
  insulin_units: number | null;
  meal_type: string | null;
  evaluation: string | null;
  related_meal_id: string | null;
  created_at: string;
}

export function computeCalories(carbs: number, protein: number, fat: number): number {
  return Math.round(carbs * 4 + protein * 4 + fat * 9);
}

export interface SaveMealInput {
  inputText: string;
  parsedJson: ParsedFood[];
  glucoseBefore: number | null;
  glucoseAfter: number | null;
  carbsGrams: number;
  proteinGrams: number;
  fatGrams: number;
  fiberGrams: number;
  calories: number;
  insulinUnits: number | null;
  mealType: string | null;
  evaluation: string | null;
  createdAt?: string | null;
  mealTime?: string | null;
  relatedMealId?: string | null;
}

/**
 * Deterministic meal-type classifier — single source of truth shared
 * with the GPT prompt (lib/ai/systemPrompt.ts) so the AI's classification
 * and the local fallback always agree.
 *
 * Rules (checked in order — first match wins):
 *   FAST_CARBS    → fiber < 5g  AND carbs >= 20g
 *                   (low-fiber carb load: bread, rice, juice, candy, fruit)
 *   HIGH_FAT      → fat_kcal / total_kcal > 0.45
 *                   (fat dominates the energy mix: pizza, fried, cheese,
 *                   nuts, avocado, cream — drives the delayed-rise pizza
 *                   effect)
 *   HIGH_PROTEIN  → protein > carbs  AND protein > fat  AND protein >= 25g
 *                   (steak, chicken, fish, eggs, legumes, dairy, shakes)
 *   HIGH_FIBER    → fiber >= 8g
 *                   (vegetables, whole grain, legumes, fiber drinks —
 *                   slows carb absorption so the BG rise is gentler than
 *                   the carb count alone would suggest)
 *   BALANCED      → otherwise (no dominant macro)
 */
export function classifyMeal(carbs: number, protein: number, fat: number, fiber: number = 0): string {
  if (fiber < 5 && carbs >= 20) return "FAST_CARBS";
  const totalKcal = computeCalories(carbs, protein, fat);
  if (totalKcal > 0 && (fat * 9) / totalKcal > 0.45) return "HIGH_FAT";
  if (protein > carbs && protein > fat && protein >= 25) return "HIGH_PROTEIN";
  if (fiber >= 8) return "HIGH_FIBER";
  return "BALANCED";
}

export async function saveMeal(input: SaveMealInput): Promise<Meal> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not authenticated");

  const row: Record<string, unknown> = {
    user_id:        user.id,
    input_text:     input.inputText,
    parsed_json:    input.parsedJson,
    glucose_before: input.glucoseBefore,
    glucose_after:  input.glucoseAfter,
    carbs_grams:    input.carbsGrams,
    protein_grams:  input.proteinGrams ?? null,
    fat_grams:      input.fatGrams ?? null,
    fiber_grams:    input.fiberGrams ?? null,
    calories:       input.calories ?? null,
    insulin_units:  input.insulinUnits,
    meal_type:      input.mealType,
    evaluation:     input.evaluation,
    related_meal_id: input.relatedMealId ?? null,
  };
  if (input.createdAt) row.created_at = input.createdAt;
  if (input.mealTime) row.meal_time = input.mealTime;

  let { data, error } = await supabase
    .from("meals")
    .insert(row)
    .select()
    .single();

  // Retry without meal_time if the column is missing (schema not migrated yet).
  if (error && /meal_time/i.test(error.message ?? "")) {
    delete row.meal_time;
    const r2 = await supabase.from("meals").insert(row).select().single();
    data = r2.data; error = r2.error;
  }
  // Retry without related_meal_id if the column is missing (migration pending).
  if (error && /related_meal_id/i.test(error.message ?? "")) {
    delete row.related_meal_id;
    const r2 = await supabase.from("meals").insert(row).select().single();
    data = r2.data; error = r2.error;
  }

  if (error) {
    if (error.message?.includes("column") && (error.message?.includes("protein_grams") || error.message?.includes("fat_grams") || error.message?.includes("fiber_grams") || error.message?.includes("calories"))) {
      delete row.protein_grams;
      delete row.fat_grams;
      delete row.fiber_grams;
      delete row.calories;
      const { data: d2, error: e2 } = await supabase.from("meals").insert(row).select().single();
      if (e2) throw new Error(e2.message);
      logDebug("MEAL_INSERT", { id: d2.id, carbs: input.carbsGrams, protein: input.proteinGrams, fat: input.fatGrams, fiber: input.fiberGrams, calories: input.calories, insulin: input.insulinUnits, glucose: input.glucoseBefore, mealType: input.mealType, evaluation: input.evaluation, note: "macro columns missing in DB" });
      return d2 as Meal;
    }
    throw new Error(error.message);
  }
  logDebug("MEAL_INSERT", { id: data.id, carbs: input.carbsGrams, protein: input.proteinGrams, fat: input.fatGrams, fiber: input.fiberGrams, calories: input.calories, insulin: input.insulinUnits, glucose: input.glucoseBefore, mealType: input.mealType, evaluation: input.evaluation });
  return data as Meal;
}

export async function deleteMeal(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("meals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface UpdateMealInput {
  carbs_grams?:    number | null;
  protein_grams?:  number | null;
  fat_grams?:      number | null;
  fiber_grams?:    number | null;
  insulin_units?:  number | null;
  glucose_before?: number | null;
  bg_1h?:          number | null;
  bg_2h?:          number | null;
  meal_type?:      string | null;
}

/**
 * Update an existing meal row + recompute the dependent fields:
 * - meal_type      via classifyMeal (skipped if user passed an explicit value)
 * - evaluation     via lib/engine/evaluation.evaluateEntry, using the best
 *                  available post-meal reading (bg_2h preferred, then bg_1h,
 *                  then null → fallback ICR-ratio heuristic)
 * Outcome / delta_1h / delta_2h are computed on read by lifecycleFor — they
 * are NOT stored, so no additional write is needed for those.
 *
 * Caller should refetch (or merge the returned Meal) so the chip + insights
 * reflect the new evaluation immediately.
 */
export async function updateMeal(id: string, patch: UpdateMealInput): Promise<Meal> {
  if (!supabase) throw new Error("Supabase is not configured");

  // 1) Fetch the current row so we can compute the recalculated fields
  //    against the FULL merged state (the patch is partial).
  const { data: current, error: fetchErr } = await supabase
    .from("meals").select(FULL_COLS).eq("id", id).single();
  if (fetchErr) throw new Error(fetchErr.message);
  const cur = current as Meal;

  // 2) Build the merged values for recomputation.
  const merged = {
    carbs_grams:    patch.carbs_grams    ?? cur.carbs_grams    ?? 0,
    protein_grams:  patch.protein_grams  ?? cur.protein_grams  ?? 0,
    fat_grams:      patch.fat_grams      ?? cur.fat_grams      ?? 0,
    fiber_grams:    patch.fiber_grams    ?? cur.fiber_grams    ?? 0,
    insulin_units:  patch.insulin_units  ?? cur.insulin_units  ?? 0,
    glucose_before: patch.glucose_before !== undefined ? patch.glucose_before : cur.glucose_before,
    bg_1h:          patch.bg_1h          !== undefined ? patch.bg_1h          : cur.bg_1h,
    bg_2h:          patch.bg_2h          !== undefined ? patch.bg_2h          : cur.bg_2h,
  };
  const explicitType = patch.meal_type !== undefined && patch.meal_type !== null && patch.meal_type !== "";
  const newMealType = explicitType
    ? patch.meal_type!
    : classifyMeal(merged.carbs_grams, merged.protein_grams, merged.fat_grams, merged.fiber_grams);

  // 3) Recompute evaluation through lifecycleFor — single source of truth.
  //    The cached `evaluation` column is only populated when the row reaches
  //    state === "final" (bg_2h captured in-window AND ageMinutes >= 120).
  //    Pending / provisional rows leave evaluation = null so the dashboard
  //    Control Score never counts a half-baked outcome.
  //    Lazy import keeps lib/meals.ts free of an engine cycle.
  const { lifecycleFor } = await import("./engine/lifecycle");
  const nowAt = new Date().toISOString();
  const bg1hAtAfter = patch.bg_1h !== undefined ? (patch.bg_1h != null ? nowAt : null) : cur.bg_1h_at;
  const bg2hAtAfter = patch.bg_2h !== undefined ? (patch.bg_2h != null ? nowAt : null) : cur.bg_2h_at;
  const mergedMeal: Meal = {
    ...cur,
    carbs_grams:    merged.carbs_grams,
    protein_grams:  merged.protein_grams,
    fat_grams:      merged.fat_grams,
    fiber_grams:    merged.fiber_grams,
    insulin_units:  merged.insulin_units,
    glucose_before: merged.glucose_before,
    bg_1h:          merged.bg_1h,
    bg_1h_at:       bg1hAtAfter,
    bg_2h:          merged.bg_2h,
    bg_2h_at:       bg2hAtAfter,
    meal_type:      newMealType,
  };
  const lc = lifecycleFor(mergedMeal);
  const finalEvaluation = lc.state === "final" ? lc.outcome : null;

  // 4) Build the DB patch — only include fields the caller actually sent,
  //    plus the recomputed meal_type + evaluation + recomputed calories.
  const dbPatch: Record<string, unknown> = {};
  if (patch.carbs_grams    !== undefined) dbPatch.carbs_grams    = patch.carbs_grams;
  if (patch.protein_grams  !== undefined) dbPatch.protein_grams  = patch.protein_grams;
  if (patch.fat_grams      !== undefined) dbPatch.fat_grams      = patch.fat_grams;
  if (patch.fiber_grams    !== undefined) dbPatch.fiber_grams    = patch.fiber_grams;
  if (patch.insulin_units  !== undefined) dbPatch.insulin_units  = patch.insulin_units;
  if (patch.glucose_before !== undefined) dbPatch.glucose_before = patch.glucose_before;
  if (patch.bg_1h !== undefined) {
    dbPatch.bg_1h = patch.bg_1h;
    dbPatch.bg_1h_at = bg1hAtAfter;
  }
  if (patch.bg_2h !== undefined) {
    dbPatch.bg_2h = patch.bg_2h;
    dbPatch.bg_2h_at = bg2hAtAfter;
  }
  dbPatch.meal_type = newMealType;
  dbPatch.evaluation = finalEvaluation;
  // calories follow the macros — recompute regardless of which macro changed.
  dbPatch.calories = computeCalories(merged.carbs_grams, merged.protein_grams, merged.fat_grams);

  let { data, error } = await supabase
    .from("meals").update(dbPatch).eq("id", id).select(FULL_COLS).single();

  // Schema fallback: if bg_1h_at / bg_2h_at columns are missing on a
  // not-yet-migrated DB, drop them and retry once.
  if (error && /bg_1h_at|bg_2h_at|column .* does not exist/i.test(error.message ?? "")) {
    delete dbPatch.bg_1h_at;
    delete dbPatch.bg_2h_at;
    const r2 = await supabase
      .from("meals").update(dbPatch).eq("id", id).select(FULL_COLS).single();
    data = r2.data; error = r2.error;
  }
  if (error) throw new Error(error.message);

  logDebug("MEAL_UPDATE", {
    id, patch: Object.keys(dbPatch),
    newMealType, lifecycleState: lc.state, newEvaluation: finalEvaluation,
  });
  return data as Meal;
}

const FULL_COLS = "id, user_id, input_text, parsed_json, glucose_before, glucose_after, bg_1h, bg_1h_at, bg_2h, bg_2h_at, outcome_state, meal_time, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, insulin_units, meal_type, evaluation, related_meal_id, created_at";
const MID_COLS  = "id, user_id, input_text, parsed_json, glucose_before, glucose_after, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, insulin_units, meal_type, evaluation, created_at";
const CORE_COLS = "id, user_id, input_text, parsed_json, glucose_before, carbs_grams, insulin_units, meal_type, evaluation, created_at";

export interface UpdateReadingsResult {
  applied: string[];
  warnings: string[];
}

export async function updateMealReadings(
  id: string,
  readings: { bg1h?: number | null; bg2h?: number | null }
): Promise<UpdateReadingsResult> {
  if (!supabase) throw new Error("Supabase is not configured");
  const now = new Date().toISOString();
  const applied: string[] = [];
  const warnings: string[] = [];

  const patch: Record<string, unknown> = {};
  if (readings.bg1h !== undefined) { patch.bg_1h = readings.bg1h; patch.bg_1h_at = readings.bg1h != null ? now : null; }
  if (readings.bg2h !== undefined) { patch.bg_2h = readings.bg2h; patch.bg_2h_at = readings.bg2h != null ? now : null; }
  if (!Object.keys(patch).length) return { applied, warnings };

  const isMissingCol = (msg?: string, code?: string) =>
    code === "42703" ||
    (!!msg && /(column|could not find).*(bg_1h|bg_2h|bg_1h_at|bg_2h_at|outcome_state)/i.test(msg));

  // Try the modern path first.
  const { error } = await supabase.from("meals").update(patch).eq("id", id);
  if (!error) {
    if (readings.bg1h !== undefined) applied.push("bg_1h");
    if (readings.bg2h !== undefined) applied.push("bg_2h");

    // Refresh the cached `evaluation` column whenever a 2h reading is
    // newly attached — the row may now satisfy lifecycle.state === "final"
    // and the dashboard Control Score reads `evaluation` directly. Skip
    // when only bg_1h is being touched (1h alone never goes final).
    if (readings.bg2h !== undefined) {
      const { data: row } = await supabase
        .from("meals").select(FULL_COLS).eq("id", id).single();
      if (row) {
        const { lifecycleFor } = await import("./engine/lifecycle");
        const lc = lifecycleFor(row as Meal);
        const evaluation = lc.state === "final" ? lc.outcome : null;
        if (evaluation !== (row as Meal).evaluation) {
          await supabase.from("meals").update({ evaluation }).eq("id", id);
        }
      }
    }

    return { applied, warnings };
  }

  if (!isMissingCol(error.message, error.code)) throw new Error(error.message);

  // Legacy fallback: store the 2h reading in glucose_after; warn that the 1h
  // reading needs the schema migration to persist.
  const legacyPatch: Record<string, unknown> = {};
  if (readings.bg2h !== undefined) legacyPatch.glucose_after = readings.bg2h;
  if (Object.keys(legacyPatch).length) {
    const { error: e2 } = await supabase.from("meals").update(legacyPatch).eq("id", id);
    if (e2) throw new Error(e2.message);
    applied.push("glucose_after");
  }
  // Schema migration is complete in production; no user-facing warnings emitted.
  return { applied, warnings };
}

export async function fetchMeals(): Promise<Meal[]> {
  if (!supabase) throw new Error("Supabase is not configured");

  let { data, error } = await supabase
    .from("meals")
    .select(FULL_COLS)
    .order("created_at", { ascending: false });

  // Fall back when the new bg_1h/bg_2h/outcome_state columns are missing.
  // Supabase / PostgREST returns several phrasings for missing columns —
  // accept all of the common ones plus error code 42703 (undefined_column).
  const isMissingCol = (e: { message?: string; code?: string } | null) =>
    !!e && (e.code === "42703"
      || /does not exist/i.test(e.message ?? "")
      || /could not find (the )?column/i.test(e.message ?? "")
      || /column .* does not exist/i.test(e.message ?? ""));
  if (isMissingCol(error)) {
    const mid = await supabase
      .from("meals")
      .select(MID_COLS)
      .order("created_at", { ascending: false });
    if (mid.error && mid.error.message?.toLowerCase().includes("does not exist")) {
      const core = await supabase
        .from("meals")
        .select(CORE_COLS)
        .order("created_at", { ascending: false });
      if (core.error) throw new Error(core.error.message);
      data = (core.data ?? []).map((r: Record<string, unknown>) => ({
        ...r, glucose_after: null, protein_grams: null, fat_grams: null, fiber_grams: null, calories: null,
        bg_1h: null, bg_1h_at: null, bg_2h: null, bg_2h_at: null, outcome_state: null, meal_time: null,
        related_meal_id: null,
      })) as unknown as typeof data;
      error = null;
    } else if (mid.error) {
      throw new Error(mid.error.message);
    } else {
      data = (mid.data ?? []).map((r: Record<string, unknown>) => ({
        ...r, bg_1h: null, bg_1h_at: null, bg_2h: null, bg_2h_at: null, outcome_state: null, meal_time: null,
        related_meal_id: null,
      })) as unknown as typeof data;
      error = null;
    }
  }

  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}

// Splits a meal description like "95g döner bread, 120g veal döner meat" into
// ParsedFood items. Macros per item are unknown for historical entries, so we
// only fill name + grams. Dashboards fall back to total grams from the meal row.
function descToParsedJson(desc: string): ParsedFood[] {
  return desc
    .split(/,\s*/)
    .map((part) => {
      const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*(?:g|ml)\s+(.+)$/i);
      if (!m) return null;
      return { name: m[2].trim(), grams: parseFloat(m[1]), carbs: 0, protein: 0, fat: 0, fiber: 0 };
    })
    .filter((x): x is ParsedFood => x !== null);
}

// Real historical entries from the user's tracking sheet (Apr 17–22, 2026),
// matching the mockup so production reflects actual data on first sign-in.
const HISTORICAL_SEEDS: ReadonlyArray<{
  input_text: string;
  glucose_before: number; glucose_after: number;
  carbs_grams: number; protein_grams: number; fat_grams: number; fiber_grams: number;
  insulin_units: number; evaluation: string; created_at: string;
}> = [
  { input_text: "95g döner bread, 120g veal döner meat, 60g mixed salad, 20g tzatziki, 20g cocktail sauce, 15g feta cheese, 250ml ayran", glucose_before: 91, glucose_after: 162, carbs_grams: 68, protein_grams: 47, fat_grams: 30, fiber_grams: 4, insulin_units: 1, evaluation: "UNDERDOSE", created_at: "2026-04-22T18:10:00Z" },
  { input_text: "1 McRoyal Bacon burger, 4 chicken delights, 10g BBQ sauce, 15g fries, 330ml cola zero", glucose_before: 127, glucose_after: 162, carbs_grams: 61, protein_grams: 40, fat_grams: 45, fiber_grams: 4, insulin_units: 1, evaluation: "UNDERDOSE", created_at: "2026-04-22T11:23:00Z" },
  { input_text: "294g pulao rice, 400g mango lassi, 32g BETTERY vanilla plant protein powder, 493g chicken korma, 83g yogurt cucumber tomato salad", glucose_before: 121, glucose_after: 60, carbs_grams: 157, protein_grams: 103, fat_grams: 60, fiber_grams: 13, insulin_units: 3, evaluation: "OVERDOSE", created_at: "2026-04-21T20:53:00Z" },
  { input_text: "95g cinnamon roll, 250g matcha latte, 4g sugar", glucose_before: 74, glucose_after: 150, carbs_grams: 74, protein_grams: 12, fat_grams: 19, fiber_grams: 2, insulin_units: 1, evaluation: "UNDERDOSE", created_at: "2026-04-21T15:19:00Z" },
  { input_text: "40g granola, 20g blueberries, 33g raspberries, 160g yogurt, 38g mixed nuts, 130g banana, 60g egg, 32g BETTERY vanilla plant protein powder", glucose_before: 97, glucose_after: 96, carbs_grams: 59, protein_grams: 53, fat_grams: 40, fiber_grams: 13, insulin_units: 1, evaluation: "GOOD", created_at: "2026-04-21T14:20:00Z" },
  { input_text: "200g beef steak, 150g turnip greens, 80g cooked brown rice, 140g potatoes, 60g mixed salad, 45g white bread", glucose_before: 196, glucose_after: 96, carbs_grams: 66, protein_grams: 64, fat_grams: 33, fiber_grams: 11, insulin_units: 3, evaluation: "OVERDOSE", created_at: "2026-04-20T20:28:00Z" },
  { input_text: "80g granola, 120g banana, 20g mixed nuts, 150g coconut rice milk", glucose_before: 118, glucose_after: 256, carbs_grams: 82, protein_grams: 14, fat_grams: 24, fiber_grams: 10, insulin_units: 1, evaluation: "UNDERDOSE", created_at: "2026-04-20T16:36:00Z" },
  { input_text: "60g chia pudding, 129g Greek yogurt, 33g blueberries, 34g raspberries, 125g light mozzarella, 125g tomato, 48g rye bread, 6g olive oil, 60g egg, 32g BETTERY vanilla plant protein powder, 37g mixed nuts, 2g cinnamon", glucose_before: 86, glucose_after: 120, carbs_grams: 51, protein_grams: 90, fat_grams: 55, fiber_grams: 18, insulin_units: 1, evaluation: "UNDERDOSE", created_at: "2026-04-20T10:43:00Z" },
  { input_text: "218g fennel pear salad, 139g broccoli, 95g roasted chickpeas, 69g halloumi, 115g potato wedges, 60g egg", glucose_before: 120, glucose_after: 81, carbs_grams: 93, protein_grams: 51, fat_grams: 39, fiber_grams: 25, insulin_units: 2, evaluation: "OVERDOSE", created_at: "2026-04-19T21:55:00Z" },
  { input_text: "75g pita bread, 110g kafta, 18g tahini sauce, 35g mixed vegetables, 90g tabbouleh salad", glucose_before: 109, glucose_after: 66, carbs_grams: 42, protein_grams: 33, fat_grams: 37, fiber_grams: 9, insulin_units: 2, evaluation: "OVERDOSE", created_at: "2026-04-19T15:01:00Z" },
  { input_text: "131g chia pudding, 126g stracciatella yogurt, 125g light mozzarella, 125g tomato, 48g rye bread, 40g Portuguese fresh cheese, 60g egg, 40g blueberries, 35g raspberries, 20g mixed nuts, 6g olive oil, 32g BETTERY vanilla plant protein powder, 15g gummy candy", glucose_before: 71, glucose_after: 62, carbs_grams: 67, protein_grams: 93, fat_grams: 62, fiber_grams: 21, insulin_units: 2, evaluation: "GOOD", created_at: "2026-04-19T11:12:00Z" },
  { input_text: "90g mackerel, 55g fries, 70g dark bread, 75g seafood rice, 20g olives, 35g salad, 20g creamed spinach, 8g Portuguese onion olive oil sauce", glucose_before: 145, glucose_after: 67, carbs_grams: 50, protein_grams: 31, fat_grams: 34, fiber_grams: 8, insulin_units: 3, evaluation: "OVERDOSE", created_at: "2026-04-18T20:30:00Z" },
  { input_text: "234g chicken breast, 158g broccoli, 90g roasted chickpeas, 32g BETTERY protein shake, 8g olive oil, 6g butter, 4g garlic", glucose_before: 120, glucose_after: 65, carbs_grams: 40, protein_grams: 119, fat_grams: 29, fiber_grams: 17, insulin_units: 3, evaluation: "OVERDOSE", created_at: "2026-04-18T14:40:00Z" },
  { input_text: "150g chia pudding, 100g Greek yogurt, 45g blueberries, 45g raspberries, 18g mixed nuts, 32g Bettery protein shake, 55g wholegrain rye bread, 125g mozzarella, 40g cream cheese, 120g tomato, 50g egg", glucose_before: 114, glucose_after: 97, carbs_grams: 62, protein_grams: 87, fat_grams: 73, fiber_grams: 24, insulin_units: 2, evaluation: "GOOD", created_at: "2026-04-18T09:34:00Z" },
  { input_text: "1 Ox Tongue Croquette, honey mustard, 8 olives, 1 oyster, 5 ravioli, 100g green beans", glucose_before: 112, glucose_after: 56, carbs_grams: 76, protein_grams: 25, fat_grams: 14, fiber_grams: 6, insulin_units: 3, evaluation: "OVERDOSE", created_at: "2026-04-17T21:40:00Z" },
];

function buildHistoricalRows(userId: string) {
  return HISTORICAL_SEEDS.map((s) => ({
    user_id: userId,
    input_text: s.input_text,
    parsed_json: descToParsedJson(s.input_text),
    glucose_before: s.glucose_before,
    glucose_after: s.glucose_after,
    carbs_grams: s.carbs_grams,
    protein_grams: s.protein_grams,
    fat_grams: s.fat_grams,
    fiber_grams: s.fiber_grams,
    calories: computeCalories(s.carbs_grams, s.protein_grams, s.fat_grams),
    insulin_units: s.insulin_units,
    meal_type: classifyMeal(s.carbs_grams, s.protein_grams, s.fat_grams, s.fiber_grams),
    evaluation: s.evaluation,
    created_at: s.created_at,
  }));
}

// Required columns that must never be stripped on fallback.
const REQUIRED_COLS = new Set(["user_id", "input_text", "created_at"]);

// Try a bulk insert; on a "missing column" schema-cache error, parse the
// missing column name from the error, drop it from every row, and retry.
// Loops until either insert succeeds, no more optional columns can be dropped,
// or we hit a non-schema error.
async function insertMealsWithFallback(rows: Record<string, unknown>[]): Promise<{ error: { message: string } | null; dropped: string[] }> {
  if (!supabase) return { error: { message: "Supabase not configured" }, dropped: [] };
  let current = rows;
  const dropped: string[] = [];
  for (let i = 0; i < 12; i++) {
    const { error } = await supabase.from("meals").insert(current);
    if (!error) return { error: null, dropped };
    const msg = error.message || "";
    const m = msg.match(/Could not find the '([^']+)' column/);
    if (!m) return { error: { message: msg }, dropped };
    const col = m[1];
    if (REQUIRED_COLS.has(col)) return { error: { message: msg }, dropped };
    current = current.map((r) => {
      const copy = { ...r };
      delete copy[col];
      return copy;
    });
    dropped.push(col);
  }
  return { error: { message: "insertMealsWithFallback: too many missing columns" }, dropped };
}

// Wipes the current user's meals and re-inserts the historical seed entries.
// Used by the "Reload historical entries" action in Settings.
export async function reloadHistoricalEntries(): Promise<{ inserted: number }> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error: delErr } = await supabase.from("meals").delete().eq("user_id", user.id);
  if (delErr) throw new Error(delErr.message);
  const rows = buildHistoricalRows(user.id);
  const { error, dropped } = await insertMealsWithFallback(rows);
  if (error) throw new Error(error.message);
  logDebug("HISTORICAL_RELOAD", { inserted: rows.length, dropped });
  return { inserted: rows.length };
}

// NOTE: seedMealsIfEmpty() was removed on 2026-04-24. It was previously
// invoked from Dashboard and Entries on first load and would auto-insert
// HISTORICAL_SEEDS (the developer's personal meal log) into every new
// user's account. The historical reload remains available as a manual
// opt-in via reloadHistoricalEntries() (Settings → Reload historical
// entries) for the developer's own account.

// Legacy generic seed retained for reference; no longer used.
function _legacySeeds_unused() {
  const now = Date.now();
  const d = 86400000;
  const _seeds = [
    { input_text: "Oatmeal with banana and honey", parsed_json: [{name:"Oatmeal",grams:80,carbs:54,protein:5,fat:3,fiber:8},{name:"Banana",grams:120,carbs:27,protein:1,fat:0,fiber:3},{name:"Honey",grams:15,carbs:13,protein:0,fat:0,fiber:0}], glucose_before:98, glucose_after:148, carbs_grams:94, insulin_units:6.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 29*d).toISOString() },
    { input_text: "Scrambled eggs with whole wheat toast", parsed_json: [{name:"Scrambled eggs",grams:150,carbs:2,protein:18,fat:14,fiber:0},{name:"Whole wheat toast",grams:60,carbs:28,protein:5,fat:2,fiber:4}], glucose_before:112, glucose_after:138, carbs_grams:30, insulin_units:2.0, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 28*d + 3*3600000).toISOString() },
    { input_text: "Pancakes with maple syrup", parsed_json: [{name:"Pancakes",grams:200,carbs:70,protein:8,fat:10,fiber:2},{name:"Maple syrup",grams:30,carbs:22,protein:0,fat:0,fiber:0}], glucose_before:105, glucose_after:205, carbs_grams:92, insulin_units:4.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 27*d).toISOString() },
    { input_text: "Turkey sandwich with apple", parsed_json: [{name:"Turkey",grams:80,carbs:0,protein:20,fat:3,fiber:0},{name:"Whole wheat bread",grams:60,carbs:28,protein:5,fat:2,fiber:4},{name:"Apple",grams:180,carbs:25,protein:0,fat:0,fiber:4}], glucose_before:118, glucose_after:145, carbs_grams:53, insulin_units:3.5, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 27*d + 4*3600000).toISOString() },
    { input_text: "Grilled chicken with sweet potato and broccoli", parsed_json: [{name:"Grilled chicken",grams:180,carbs:0,protein:42,fat:6,fiber:0},{name:"Sweet potato",grams:150,carbs:35,protein:2,fat:0,fiber:4},{name:"Broccoli",grams:100,carbs:7,protein:3,fat:0,fiber:3}], glucose_before:92, glucose_after:125, carbs_grams:42, insulin_units:3.0, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 26*d + 6*3600000).toISOString() },
    { input_text: "Salmon with quinoa and asparagus", parsed_json: [{name:"Salmon",grams:180,carbs:0,protein:38,fat:16,fiber:0},{name:"Quinoa",grams:100,carbs:20,protein:4,fat:2,fiber:3},{name:"Asparagus",grams:100,carbs:4,protein:3,fat:0,fiber:2}], glucose_before:101, glucose_after:120, carbs_grams:24, insulin_units:1.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 25*d + 6*3600000).toISOString() },
    { input_text: "Pizza 3 slices pepperoni", parsed_json: [{name:"Pizza slice",grams:280,carbs:90,protein:28,fat:24,fiber:3}], glucose_before:132, glucose_after:210, carbs_grams:90, insulin_units:5.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 25*d + 6*3600000).toISOString() },
    { input_text: "Greek yogurt with granola and berries", parsed_json: [{name:"Greek yogurt",grams:200,carbs:10,protein:18,fat:0,fiber:0},{name:"Granola",grams:50,carbs:32,protein:5,fat:6,fiber:3},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3}], glucose_before:88, glucose_after:130, carbs_grams:54, insulin_units:3.8, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 24*d).toISOString() },
    { input_text: "Chicken rice bowl with vegetables", parsed_json: [{name:"Chicken breast",grams:180,carbs:0,protein:35,fat:5,fiber:0},{name:"White rice",grams:200,carbs:52,protein:4,fat:0,fiber:1},{name:"Mixed vegetables",grams:100,carbs:10,protein:2,fat:1,fiber:4}], glucose_before:115, glucose_after:148, carbs_grams:62, insulin_units:4.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 23*d + 4*3600000).toISOString() },
    { input_text: "Avocado toast with poached eggs", parsed_json: [{name:"Sourdough bread",grams:80,carbs:38,protein:6,fat:2,fiber:2},{name:"Avocado",grams:100,carbs:9,protein:2,fat:15,fiber:7},{name:"Poached eggs",grams:100,carbs:1,protein:13,fat:10,fiber:0}], glucose_before:95, glucose_after:118, carbs_grams:48, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 22*d).toISOString() },
    { input_text: "Pasta primavera with parmesan", parsed_json: [{name:"Penne pasta",grams:180,carbs:72,protein:12,fat:3,fiber:4},{name:"Mixed vegetables",grams:150,carbs:12,protein:4,fat:2,fiber:5},{name:"Parmesan",grams:20,carbs:0,protein:4,fat:5,fiber:0}], glucose_before:128, glucose_after:198, carbs_grams:84, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 21*d + 6*3600000).toISOString() },
    { input_text: "Steak with mashed potatoes and green beans", parsed_json: [{name:"Ribeye steak",grams:220,carbs:0,protein:48,fat:22,fiber:0},{name:"Mashed potatoes",grams:200,carbs:40,protein:4,fat:8,fiber:3},{name:"Green beans",grams:80,carbs:6,protein:2,fat:0,fiber:3}], glucose_before:108, glucose_after:145, carbs_grams:46, insulin_units:4.0, meal_type:"HIGH_FAT", evaluation:"GOOD", created_at: new Date(now - 21*d + 6*3600000).toISOString() },
    { input_text: "Smoothie banana berries protein powder", parsed_json: [{name:"Banana",grams:120,carbs:27,protein:1,fat:0,fiber:3},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3},{name:"Protein powder",grams:30,carbs:3,protein:24,fat:1,fiber:0},{name:"Almond milk",grams:240,carbs:8,protein:2,fat:3,fiber:1}], glucose_before:90, glucose_after:160, carbs_grams:50, insulin_units:2.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 20*d).toISOString() },
    { input_text: "Sushi 10 pieces salmon and tuna", parsed_json: [{name:"Sushi rice",grams:200,carbs:50,protein:4,fat:0,fiber:1},{name:"Salmon",grams:80,carbs:0,protein:16,fat:5,fiber:0},{name:"Tuna",grams:60,carbs:0,protein:14,fat:1,fiber:0}], glucose_before:104, glucose_after:138, carbs_grams:50, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 19*d + 6*3600000).toISOString() },
    { input_text: "Chili con carne with cornbread", parsed_json: [{name:"Chili con carne",grams:300,carbs:32,protein:22,fat:10,fiber:8},{name:"Cornbread",grams:80,carbs:30,protein:4,fat:6,fiber:2}], glucose_before:122, glucose_after:178, carbs_grams:62, insulin_units:3.0, meal_type:"BALANCED", evaluation:"LOW", created_at: new Date(now - 18*d + 6*3600000).toISOString() },
    { input_text: "Cheese omelet with hash browns", parsed_json: [{name:"Cheese omelet",grams:200,carbs:2,protein:22,fat:22,fiber:0},{name:"Hash browns",grams:150,carbs:30,protein:3,fat:8,fiber:2}], glucose_before:97, glucose_after:128, carbs_grams:32, insulin_units:2.0, meal_type:"HIGH_FAT", evaluation:"GOOD", created_at: new Date(now - 17*d).toISOString() },
    { input_text: "Chicken Caesar salad with croutons", parsed_json: [{name:"Romaine lettuce",grams:150,carbs:5,protein:2,fat:0,fiber:3},{name:"Grilled chicken",grams:150,carbs:0,protein:30,fat:5,fiber:0},{name:"Caesar dressing",grams:40,carbs:2,protein:1,fat:16,fiber:0},{name:"Croutons",grams:30,carbs:15,protein:2,fat:3,fiber:1}], glucose_before:85, glucose_after:108, carbs_grams:22, insulin_units:1.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 16*d + 4*3600000).toISOString() },
    { input_text: "Beef tacos three corn tortillas", parsed_json: [{name:"Corn tortillas",grams:90,carbs:42,protein:4,fat:3,fiber:4},{name:"Ground beef",grams:120,carbs:0,protein:24,fat:12,fiber:0},{name:"Toppings",grams:60,carbs:6,protein:1,fat:2,fiber:1}], glucose_before:118, glucose_after:148, carbs_grams:48, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 15*d + 6*3600000).toISOString() },
    { input_text: "Pho noodle soup with beef", parsed_json: [{name:"Rice noodles",grams:200,carbs:44,protein:4,fat:0,fiber:2},{name:"Beef slices",grams:100,carbs:0,protein:20,fat:6,fiber:0},{name:"Broth and vegetables",grams:400,carbs:8,protein:4,fat:2,fiber:2}], glucose_before:110, glucose_after:162, carbs_grams:52, insulin_units:2.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 14*d + 6*3600000).toISOString() },
    { input_text: "Protein bar and apple", parsed_json: [{name:"Protein bar",grams:60,carbs:28,protein:20,fat:8,fiber:5},{name:"Apple",grams:180,carbs:25,protein:0,fat:0,fiber:4}], glucose_before:78, glucose_after:120, carbs_grams:53, insulin_units:3.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 13*d + 3*3600000).toISOString() },
    { input_text: "Cereal with whole milk and sliced banana", parsed_json: [{name:"Corn flakes cereal",grams:60,carbs:48,protein:3,fat:1,fiber:2},{name:"Whole milk",grams:240,carbs:12,protein:8,fat:8,fiber:0},{name:"Banana",grams:100,carbs:23,protein:1,fat:0,fiber:3}], glucose_before:102, glucose_after:188, carbs_grams:83, insulin_units:4.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 12*d).toISOString() },
    { input_text: "Stir fry vegetables with tofu and brown rice", parsed_json: [{name:"Tofu",grams:150,carbs:2,protein:16,fat:8,fiber:1},{name:"Mixed vegetables",grams:200,carbs:14,protein:4,fat:2,fiber:6},{name:"Brown rice",grams:180,carbs:38,protein:4,fat:2,fiber:3},{name:"Soy sauce",grams:20,carbs:2,protein:1,fat:0,fiber:0}], glucose_before:115, glucose_after:145, carbs_grams:56, insulin_units:4.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 11*d + 6*3600000).toISOString() },
    { input_text: "Burger with fries", parsed_json: [{name:"Beef burger",grams:180,carbs:0,protein:28,fat:18,fiber:0},{name:"Burger bun",grams:60,carbs:30,protein:5,fat:3,fiber:2},{name:"French fries",grams:150,carbs:40,protein:3,fat:12,fiber:3}], glucose_before:130, glucose_after:68, carbs_grams:70, insulin_units:7.5, meal_type:"HIGH_FAT", evaluation:"HIGH", created_at: new Date(now - 10*d + 6*3600000).toISOString() },
    { input_text: "Lentil soup with crusty bread", parsed_json: [{name:"Lentil soup",grams:350,carbs:40,protein:18,fat:4,fiber:14},{name:"Crusty bread",grams:80,carbs:40,protein:4,fat:1,fiber:2}], glucose_before:95, glucose_after:142, carbs_grams:80, insulin_units:5.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 9*d + 4*3600000).toISOString() },
    { input_text: "Overnight oats with almond butter and berries", parsed_json: [{name:"Rolled oats",grams:80,carbs:54,protein:6,fat:4,fiber:8},{name:"Almond butter",grams:30,carbs:3,protein:6,fat:16,fiber:2},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3},{name:"Almond milk",grams:120,carbs:4,protein:1,fat:2,fiber:0}], glucose_before:88, glucose_after:135, carbs_grams:73, insulin_units:5.0, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 8*d).toISOString() },
    { input_text: "Tuna salad wrap with spinach", parsed_json: [{name:"Canned tuna",grams:150,carbs:0,protein:32,fat:3,fiber:0},{name:"Whole wheat wrap",grams:70,carbs:32,protein:5,fat:4,fiber:4},{name:"Spinach and vegetables",grams:80,carbs:5,protein:2,fat:0,fiber:2},{name:"Mayo",grams:20,carbs:0,protein:0,fat:14,fiber:0}], glucose_before:106, glucose_after:125, carbs_grams:37, insulin_units:2.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 7*d + 4*3600000).toISOString() },
    { input_text: "Roast chicken with roasted vegetables and potatoes", parsed_json: [{name:"Roast chicken",grams:200,carbs:0,protein:44,fat:12,fiber:0},{name:"Roasted potatoes",grams:200,carbs:36,protein:4,fat:6,fiber:4},{name:"Roasted vegetables",grams:150,carbs:14,protein:3,fat:4,fiber:5}], glucose_before:124, glucose_after:158, carbs_grams:50, insulin_units:3.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 6*d + 6*3600000).toISOString() },
    { input_text: "French toast with fruit compote", parsed_json: [{name:"French toast",grams:180,carbs:56,protein:12,fat:10,fiber:2},{name:"Fruit compote",grams:80,carbs:20,protein:0,fat:0,fiber:2}], glucose_before:92, glucose_after:168, carbs_grams:76, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 5*d).toISOString() },
    { input_text: "Shrimp stir fry with jasmine rice", parsed_json: [{name:"Shrimp",grams:150,carbs:0,protein:28,fat:2,fiber:0},{name:"Jasmine rice",grams:200,carbs:52,protein:4,fat:0,fiber:1},{name:"Stir fry vegetables",grams:150,carbs:12,protein:3,fat:2,fiber:4},{name:"Oyster sauce",grams:20,carbs:4,protein:0,fat:0,fiber:0}], glucose_before:99, glucose_after:138, carbs_grams:68, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 4*d + 6*3600000).toISOString() },
    { input_text: "Cheese quesadilla with guacamole", parsed_json: [{name:"Flour tortillas",grams:80,carbs:40,protein:5,fat:4,fiber:2},{name:"Cheddar cheese",grams:60,carbs:0,protein:10,fat:14,fiber:0},{name:"Guacamole",grams:80,carbs:6,protein:1,fat:12,fiber:4}], glucose_before:114, glucose_after:52, carbs_grams:46, insulin_units:6.5, meal_type:"HIGH_FAT", evaluation:"HIGH", created_at: new Date(now - 3*d + 6*3600000).toISOString() },
    { input_text: "Oatmeal with blueberries and walnuts", parsed_json: [{name:"Steel cut oats",grams:80,carbs:50,protein:6,fat:4,fiber:8},{name:"Blueberries",grams:100,carbs:14,protein:1,fat:0,fiber:4},{name:"Walnuts",grams:30,carbs:2,protein:4,fat:18,fiber:2}], glucose_before:96, glucose_after:142, carbs_grams:66, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 2*d).toISOString() },
    { input_text: "Grilled salmon with quinoa and roasted broccoli", parsed_json: [{name:"Grilled salmon",grams:200,carbs:0,protein:40,fat:18,fiber:0},{name:"Quinoa",grams:120,carbs:24,protein:5,fat:2,fiber:3},{name:"Roasted broccoli",grams:150,carbs:11,protein:4,fat:4,fiber:5}], glucose_before:108, glucose_after:130, carbs_grams:35, insulin_units:2.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 1*d + 6*3600000).toISOString() },
  ];
  return _seeds;
}
void _legacySeeds_unused;
