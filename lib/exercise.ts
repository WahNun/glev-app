import { supabase } from "./supabase";

/**
 * Standalone exercise event log. Lets the engine relate movement to
 * glucose patterns. Pure documentation — no calculations.
 *
 * `hypertrophy` is the legacy value (rows created before the taxonomy
 * widening). New form submissions use `strength`. The two are treated
 * as equivalent everywhere downstream.
 */
export type ExerciseType =
  | "hypertrophy"  // legacy
  | "strength"
  | "cardio"
  | "hiit"
  | "yoga"
  | "cycling"
  | "run"
  // Team / racquet sports — intermittent aerobic activity, grouped
  // with cardio for pattern-note guidance.
  | "football"     // soccer
  | "tennis"
  | "volleyball"
  | "basketball";

export type ExerciseIntensity = "low" | "medium" | "high";

export interface ExerciseLog {
  id: string;
  user_id: string;
  created_at: string;
  exercise_type: ExerciseType;
  duration_minutes: number;
  intensity: ExerciseIntensity;
  cgm_glucose_at_log: number | null;
  notes: string | null;
  // CGM auto-fetch results: at workout end, and +1h after end.
  glucose_at_end?: number | null;
  glucose_after_1h?: number | null;
  // Task #194: window-level aggregates over the dense 0–180 min CGM
  // curve captured starting at workout end (created_at + duration).
  // Populated by the `exercise_curve_180` job. The engine reads
  // `had_hypo_window` to surface a delayed hypo BETWEEN the at-end
  // and +1h slots — invisible to the legacy point-value scoring.
  min_bg_180?: number | null;
  max_bg_180?: number | null;
  time_to_peak_min?: number | null;
  auc_180?: number | null;
  had_hypo_window?: boolean | null;
  min_bg_60_180?: number | null;
}

export interface ExerciseLogInput {
  exercise_type: ExerciseType;
  duration_minutes: number;
  intensity: ExerciseIntensity;
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
  // Retroactive logs pass an explicit start instant so the row's
  // `created_at` matches the actual workout start (not the submit
  // moment). Omit / undefined for "log it as starting now".
  start_at?: string;
}

const COLS =
  "id,user_id,created_at,exercise_type,duration_minutes,intensity,cgm_glucose_at_log,notes";

export async function insertExerciseLog(input: ExerciseLogInput): Promise<ExerciseLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw authErr || new Error("Not authenticated");

  const row: Record<string, unknown> = {
    user_id: user.id,
    exercise_type: input.exercise_type,
    duration_minutes: input.duration_minutes,
    intensity: input.intensity,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };
  // Only override created_at when the caller explicitly provides a
  // past start time (retroactive logging). Otherwise the DB default
  // `now()` is used, which keeps live submissions backwards-compatible.
  if (input.start_at) {
    row.created_at = input.start_at;
  }

  const { data, error } = await supabase
    .from("exercise_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as ExerciseLog;
}

export async function fetchExerciseLogs(
  fromIso?: string,
  toIso?: string,
): Promise<ExerciseLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase.from("exercise_logs").select("*").order("created_at", { ascending: false });
  if (fromIso) q = q.gte("created_at", fromIso);
  if (toIso)   q = q.lte("created_at", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ExerciseLog[];
}

export async function fetchRecentExerciseLogs(days: number): Promise<ExerciseLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchExerciseLogs(fromIso);
}

export async function deleteExerciseLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("exercise_logs").delete().eq("id", id);
  if (error) throw error;
}
