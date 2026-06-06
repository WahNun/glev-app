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
  | "swimming"
  // Team / racquet sports — intermittent aerobic activity, grouped
  // with cardio for pattern-note guidance.
  | "football"     // soccer
  | "tennis"
  | "volleyball"
  | "basketball"
  // Body-temperature events — not really "sport" but they affect
  // insulin absorption / glucose dynamics enough that T1Ds want to
  // log them next to exercise. Hot shower → vasodilation can speed
  // insulin absorption (drop risk). Cold shower → vasoconstriction
  // + adrenaline can transiently push glucose up.
  | "hot_shower"
  | "cold_shower"
  // Breathwork (Wim Hof, box breathing, holotropic, etc.) — adrenergic
  // / parasympathetic shift can move glucose either direction depending
  // on style, so it gets its own bucket rather than collapsing into
  // yoga or cardio.
  | "breathwork";

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
  // Task #183/#342: Apple Health workout sync columns (Migration
  // 20260518_extend_exercise_logs_apple_health). `source` defaults to
  // 'manual' on legacy rows; 'apple_health' rows additionally carry
  // started_at / ended_at / heart-rate fields that are LOCKED in the
  // UI (per the migration's agreed policy — only notes + intensity
  // remain editable on synced rows).
  source?: ExerciseSource | null;
  external_id?: string | null;
  avg_heart_rate?: number | null;
  max_heart_rate?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
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

export async function insertExerciseLog(input: ExerciseLogInput): Promise<ExerciseLog> {
  const body: Record<string, unknown> = {
    exercise_type: input.exercise_type,
    duration_minutes: input.duration_minutes,
    intensity: input.intensity,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };
  // Pass the actual workout start time for retroactive logs so the server
  // sets created_at correctly AND anchors the CGM historical lookup to
  // the real start instant (not the submit moment).
  if (input.start_at) {
    body.started_at = input.start_at;
  }

  const r = await fetch("/api/exercise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const j = await r.json();
  return j.log as ExerciseLog;
}

/**
 * PATCH /api/exercise/[id] — partial update of an existing exercise log.
 *
 * Mirrors `updateInsulinLogLink` (lib/insulin.ts) and is intentionally
 * routed through the API instead of going straight to Supabase so the
 * server-side validation (range + enum checks) is the single source of
 * truth shared with the POST handler.
 */
export async function updateExerciseLog(
  id: string,
  patch: {
    exercise_type?: ExerciseType;
    duration_minutes?: number;
    intensity?: ExerciseIntensity;
    notes?: string | null;
    /** ISO. Re-anchors `cgm_glucose_at_log` to the new wallclock via the
     *  CGM-historical lookup on the server. Apple-Health-synced rows
     *  reject this — the watch's wallclock is authoritative. */
    started_at?: string;
    /** ISO or null. Must be > started_at when both are present. */
    ended_at?: string | null;
  },
): Promise<ExerciseLog> {
  const r = await fetch(`/api/exercise/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const j = await r.json();
  return j.log as ExerciseLog;
}

/** Optional source filter for read helpers. Task #183 introduces the
 *  `apple_health` source alongside the implicit `manual` default. The
 *  filter is OPTIONAL so every existing caller keeps returning all
 *  rows regardless of source — change-set is backward-compatible by
 *  construction. Pass an array to fetch a union (e.g. `["manual",
 *  "apple_health"]` is identical to omitting the filter today, but
 *  pre-empts a future third source slipping in silently). */
export type ExerciseSource = "manual" | "apple_health";

export async function fetchExerciseLogs(
  fromIso?: string,
  toIso?: string,
  options?: { source?: ExerciseSource | ExerciseSource[] },
): Promise<ExerciseLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase.from("exercise_logs").select("*").order("created_at", { ascending: false });
  if (fromIso) q = q.gte("created_at", fromIso);
  if (toIso)   q = q.lte("created_at", toIso);
  if (options?.source) {
    const list = Array.isArray(options.source) ? options.source : [options.source];
    if (list.length === 1) q = q.eq("source", list[0]);
    else                   q = q.in("source", list);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ExerciseLog[];
}

export async function fetchRecentExerciseLogs(
  days: number,
  options?: { source?: ExerciseSource | ExerciseSource[]; before?: string },
): Promise<ExerciseLog[]> {
  const toMs = options?.before ? new Date(options.before).getTime() : Date.now();
  const fromIso = new Date(toMs - days * 86400000).toISOString();
  return fetchExerciseLogs(fromIso, options?.before, options);
}

export async function deleteExerciseLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("exercise_logs").delete().eq("id", id);
  if (error) throw error;
}
