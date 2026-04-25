import { supabase } from "./supabase";

/**
 * Standalone exercise event log. Lets the engine relate movement to
 * glucose patterns. Pure documentation — no calculations.
 */
export interface ExerciseLog {
  id: string;
  user_id: string;
  created_at: string;
  exercise_type: "hypertrophy" | "cardio";
  duration_minutes: number;
  intensity: "low" | "medium" | "high";
  cgm_glucose_at_log: number | null;
  notes: string | null;
}

export interface ExerciseLogInput {
  exercise_type: "hypertrophy" | "cardio";
  duration_minutes: number;
  intensity: "low" | "medium" | "high";
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,exercise_type,duration_minutes,intensity,cgm_glucose_at_log,notes";

export async function insertExerciseLog(input: ExerciseLogInput): Promise<ExerciseLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw authErr || new Error("Not authenticated");

  const row = {
    user_id: user.id,
    exercise_type: input.exercise_type,
    duration_minutes: input.duration_minutes,
    intensity: input.intensity,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };

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
  let q = supabase.from("exercise_logs").select(COLS).order("created_at", { ascending: false });
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
