/**
 * Shared validation helpers for POST + PATCH on /api/exercise.
 *
 * Each parser returns either `{ value }` on success or `{ error }` with the
 * exact error message the API has been returning historically — keeping the
 * messages stable so existing clients (and the engine log form) don't have
 * to adapt.
 */

export const COLS =
  "id,user_id,created_at,exercise_type,duration_minutes,intensity,cgm_glucose_at_log,notes";

// Mirrors lib/exercise.ts ExerciseType: keeps legacy 'hypertrophy' for
// backward compat, adds the widened taxonomy used by the form.
const VALID_TYPE = new Set([
  "hypertrophy", "strength", "cardio", "hiit", "yoga", "cycling", "run",
  // Team / racquet sports — added in task #203 alongside the
  // exercise_logs_exercise_type_check widening migration.
  "football", "tennis", "volleyball", "basketball",
  // Body-temperature events + swimming + breathwork — must match the
  // CHECK constraint in supabase/migrations/20260512_add_breathwork_and_swimming_exercise_types.sql.
  "swimming", "hot_shower", "cold_shower", "breathwork",
]);
const VALID_INTENSITY = new Set(["low", "medium", "high"]);

type Result<T> = { value: T } | { error: string };

export function parseExerciseType(raw: unknown): Result<string> {
  const v = String(raw ?? "").toLowerCase();
  if (!VALID_TYPE.has(v)) {
    return {
      error: "exercise_type must be one of: cardio, strength, hiit, yoga, cycling, run, swimming, football, tennis, volleyball, basketball, breathwork, hot_shower, cold_shower (legacy 'hypertrophy' also accepted)",
    };
  }
  return { value: v };
}

export function parseIntensity(raw: unknown): Result<string> {
  const v = String(raw ?? "").toLowerCase();
  if (!VALID_INTENSITY.has(v)) {
    return { error: "intensity must be 'low', 'medium' or 'high'" };
  }
  return { value: v };
}

export function parseDuration(raw: unknown): Result<number> {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 600) {
    return { error: "duration_minutes must be an integer 0 < n ≤ 600" };
  }
  return { value: n };
}

export function parseCgmGlucose(raw: unknown): Result<number | null> {
  if (raw == null || raw === "") return { value: null };
  const c = Number(raw);
  if (!Number.isFinite(c) || c < 20 || c > 600) {
    return { error: "cgm_glucose_at_log out of range" };
  }
  return { value: Math.round(c * 10) / 10 };
}

export function parseNotes(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}
