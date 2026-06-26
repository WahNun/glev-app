import type { SupabaseClient } from "@supabase/supabase-js";
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
/**
 * After a new glucose reading is saved (fingerstick or CGM), find the
 * single nearest open `meal_timeline_check` within a ±15-minute window
 * around `measuredAt` and backfill `bg_at_check` + `confirmed_at`.
 *
 * Fire-and-forget pattern: callers must NOT await this in the critical
 * path. A failed fill must never block the save that triggers it.
 *
 * Rules enforced here (DB-level RLS adds a second layer for user-scoped
 * clients; service-role callers rely on the explicit `user_id` filter):
 *   - Only rows belonging to `userId` are touched.
 *   - Only rows where `bg_at_check IS NULL` qualify.
 *   - `planned_at` must lie within ±15 minutes of `measuredAt`.
 *   - If multiple open checks qualify, only the one with `planned_at`
 *     closest to `measuredAt` is updated.
 *   - The UPDATE includes an extra `.is("bg_at_check", null)` guard so a
 *     concurrent write that beats us turns the update into a safe no-op.
 */
export async function fillNearbyChecks(
  sb: SupabaseClient,
  userId: string,
  valueMgDl: number,
  measuredAt: Date,
): Promise<void> {
  const WINDOW_MS  = 15 * 60 * 1000;
  const windowStart = new Date(measuredAt.getTime() - WINDOW_MS).toISOString();
  const windowEnd   = new Date(measuredAt.getTime() + WINDOW_MS).toISOString();

  const { data: rows, error: selErr } = await sb
    .from("meal_timeline_checks")
    .select("id,planned_at")
    .eq("user_id", userId)
    .is("bg_at_check", null)
    .gte("planned_at", windowStart)
    .lte("planned_at", windowEnd);

  if (selErr || !rows || rows.length === 0) return;

  const measured = measuredAt.getTime();
  const nearest = (rows as Array<{ id: string; planned_at: string }>).reduce(
    (best, row) => {
      const distRow  = Math.abs(new Date(row.planned_at).getTime() - measured);
      const distBest = Math.abs(new Date(best.planned_at).getTime() - measured);
      return distRow < distBest ? row : best;
    },
  );

  await sb
    .from("meal_timeline_checks")
    .update({ bg_at_check: valueMgDl, confirmed_at: new Date().toISOString() })
    .eq("id", nearest.id)
    .is("bg_at_check", null);
}

export interface PostBolusCheckRaw {
  meal_id: string;
  bg_at_check: number;
}

/**
 * Fetch all post-bolus checks that have a recorded BG value.
 * Only includes rows where check_type starts with "post_" (pre-checks are
 * excluded because they measure a different clinical moment).
 *
 * Used by the Insights page "Post-Bolus BZ Trend" card to aggregate
 * average/min/max BG per meal type. The caller joins with the already-
 * loaded meals array to resolve meal_type without an extra query.
 */
export async function fetchPostBolusChecksRaw(): Promise<PostBolusCheckRaw[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("meal_timeline_checks")
    .select("meal_id, bg_at_check")
    .not("bg_at_check", "is", null)
    .like("check_type", "post_%");
  if (error) throw new Error(error.message);
  return (data ?? []) as PostBolusCheckRaw[];
}

/**
 * Auto-create post-bolus check stubs immediately after a meal is saved.
 * Inserts `post_1h` (+1 h) and `post_2h` (+2 h) rows with `confirmed_at = null`
 * so `fillNearbyChecks()` can backfill `bg_at_check` on the next CGM sync.
 *
 * Fire-and-forget contract: callers must wrap this in `void (async () => { … })()`.
 * A failure here must never block the meal-save path.
 *
 * Duplicate-safe: skips a check type when a row for (meal_id, check_type) already
 * exists (no DB-level unique constraint — guard is implemented via SELECT-then-INSERT).
 */
export async function insertPostBolusCheckStubs(
  sb: SupabaseClient,
  userId: string,
  mealId: string,
  mealTimeIso: string,
): Promise<void> {
  const offsets: Array<{ checkType: string; offsetMs: number }> = [
    { checkType: "post_1h", offsetMs: 1 * 60 * 60_000 },
    { checkType: "post_2h", offsetMs: 2 * 60 * 60_000 },
  ];

  const mealTimeMs = new Date(mealTimeIso).getTime();
  if (Number.isNaN(mealTimeMs)) return;

  for (const { checkType, offsetMs } of offsets) {
    const { data: existing } = await sb
      .from("meal_timeline_checks")
      .select("id")
      .eq("meal_id", mealId)
      .eq("check_type", checkType)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const planned_at = new Date(mealTimeMs + offsetMs).toISOString();
    await sb.from("meal_timeline_checks").insert({
      user_id: userId,
      meal_id: mealId,
      check_type: checkType,
      planned_at,
      confirmed_at: null,
    });
  }
}

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
