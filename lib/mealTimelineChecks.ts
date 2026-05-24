import { supabase } from "./supabase";

/**
 * Data layer for the Meal-Node-Cluster on the dashboard glucose chart.
 *
 * `meal_timeline_checks` was added in
 * `supabase/migrations/20260523_ai_function_calling_schema.sql` for the
 * upcoming Phase-3 AI reminder/confirmation flow. Task #673 introduces
 * the first WRITE-path against it: a draggable Make.com-style node
 * cluster on the 12h CGM curve where the user plans pre/post-bolus
 * BZ-checks per meal.
 *
 * Hard rules (see DECISIONS D-017):
 *   • Writes only happen after an explicit UI Confirm tap. Never auto.
 *   • `bg_at_check` is intentionally NOT written here — a later Phase-3
 *     task fills it once the planned moment is reached.
 *   • The unique business key is (`meal_id`, `check_type`). The table
 *     has no DB-level unique constraint, so we implement upsert as
 *     select-then-update-or-insert.
 */

export type MealCheckType = "pre" | `post_${number}`;

export interface MealTimelineCheck {
  id: string;
  user_id: string;
  meal_id: string;
  check_type: string;
  planned_at: string | null;
  confirmed_at: string | null;
  bg_at_check: number | null;
  created_at: string;
}

/** Map of `check_type` → row, keyed per meal_id. */
export type ChecksByMeal = Map<string, Record<string, MealTimelineCheck>>;

/**
 * Fetch all timeline checks for a given set of meals, grouped by
 * meal_id and then by check_type. RLS scopes the SELECT to the
 * authenticated user; we still pass the meal_ids list so the result
 * stays bounded even on power users.
 */
export async function listChecksForMeals(mealIds: string[]): Promise<ChecksByMeal> {
  const out: ChecksByMeal = new Map();
  if (!supabase || mealIds.length === 0) return out;
  const { data, error } = await supabase
    .from("meal_timeline_checks")
    .select("id,user_id,meal_id,check_type,planned_at,confirmed_at,bg_at_check,created_at")
    .in("meal_id", mealIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as MealTimelineCheck[]) {
    const bucket = out.get(row.meal_id) ?? {};
    // If duplicate rows exist for the same (meal_id, check_type) we
    // keep the newest by created_at — defensive, since the table has
    // no DB-level unique constraint yet.
    const existing = bucket[row.check_type];
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      bucket[row.check_type] = row;
    }
    out.set(row.meal_id, bucket);
  }
  return out;
}

export interface UpsertCheckInput {
  mealId: string;
  checkType: MealCheckType | string;
  plannedAt: string; // ISO
}

/**
 * Upsert a single (meal_id, check_type) row. The user-tap also acts as
 * the confirmation of the plan, so `confirmed_at` is set to NOW().
 * Returns the persisted row so callers can refresh their local state
 * with the server-side id + created_at.
 */
export async function upsertCheck(input: UpsertCheckInput): Promise<MealTimelineCheck> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  const { data: existingRows, error: selErr } = await supabase
    .from("meal_timeline_checks")
    .select("id")
    .eq("meal_id", input.mealId)
    .eq("check_type", input.checkType)
    .order("created_at", { ascending: false })
    .limit(1);
  if (selErr) throw new Error(selErr.message);
  const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

  const nowIso = new Date().toISOString();
  if (existing) {
    const { data, error } = await supabase
      .from("meal_timeline_checks")
      .update({ planned_at: input.plannedAt, confirmed_at: nowIso })
      .eq("id", existing.id)
      .select("id,user_id,meal_id,check_type,planned_at,confirmed_at,bg_at_check,created_at")
      .single();
    if (error) throw new Error(error.message);
    return data as MealTimelineCheck;
  }

  const { data, error } = await supabase
    .from("meal_timeline_checks")
    .insert({
      user_id: user.id,
      meal_id: input.mealId,
      check_type: input.checkType,
      planned_at: input.plannedAt,
      confirmed_at: nowIso,
    })
    .select("id,user_id,meal_id,check_type,planned_at,confirmed_at,bg_at_check,created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as MealTimelineCheck;
}
