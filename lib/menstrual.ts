import { supabase } from "./supabase";

/**
 * Standalone menstrual / cycle event log.
 *
 * One row per logged event. Two distinct shapes are supported:
 *   1. Bleeding entry — `flow_intensity` set, `phase_marker` null.
 *      `start_date` required, `end_date` optional.
 *   2. Phase marker entry (ovulation / PMS / other hormonal event)
 *      — `phase_marker` set, `flow_intensity` null. `start_date`
 *      stores the marker date; `end_date` is always null.
 *
 * Pure documentation — no calculations, no cycle prediction.
 */

export type FlowIntensity = "light" | "medium" | "heavy";

/**
 * Legacy 3-marker enum from the original cycle MVP. New entries write
 * the 4-phase `cycle_phase` instead, but pre-refactor rows still carry
 * a `phase_marker` value (notably `'pms'` and `'other'`) so reading
 * code must continue to handle it.
 *
 * @deprecated for new writes — use `CyclePhase` instead.
 */
export type PhaseMarker = "ovulation" | "pms" | "other";

/**
 * Standard 4-phase menstrual cycle enum used by the refactored cycle
 * tracker. `'menstruation'` overlaps semantically with the bleeding
 * mode (which still tracks flow_intensity + start/end dates), but the
 * phase variant lets users mark the phase without committing to flow
 * granularity.
 */
export type CyclePhase = "follicular" | "ovulation" | "luteal" | "menstruation";

export const CYCLE_PHASES: readonly CyclePhase[] = [
  "follicular",
  "ovulation",
  "luteal",
  "menstruation",
];
const CYCLE_PHASE_SET: Set<string> = new Set(CYCLE_PHASES);
export function isCyclePhase(v: unknown): v is CyclePhase {
  return typeof v === "string" && CYCLE_PHASE_SET.has(v);
}

export interface MenstrualLog {
  id: string;
  user_id: string;
  created_at: string;
  start_date: string;          // YYYY-MM-DD
  end_date: string | null;     // YYYY-MM-DD or null
  flow_intensity: FlowIntensity | null;
  /** @deprecated for new writes — kept populated for legacy row reads. */
  phase_marker: PhaseMarker | null;
  /** Standard 4-phase enum. Null for bleeding-only rows or legacy
   *  entries pre-dating the column (read those via `phase_marker`). */
  cycle_phase: CyclePhase | null;
  notes: string | null;
}

export interface MenstrualLogInput {
  start_date: string;
  end_date?: string | null;
  flow_intensity?: FlowIntensity | null;
  /** @deprecated — new code should pass `cycle_phase` instead. Kept
   *  on the input shape so existing call sites keep compiling, but
   *  the helper rejects new `'pms'` / `'other'` writes. */
  phase_marker?: PhaseMarker | null;
  cycle_phase?: CyclePhase | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,start_date,end_date,flow_intensity,phase_marker,cycle_phase,notes";

export async function insertMenstrualLog(input: MenstrualLogInput): Promise<MenstrualLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  // Reject the deprecated PMS / other phase markers on new writes —
  // PMS is now stored as a `category='pms'` symptom_log and "Andere"
  // was removed by spec. Legacy rows in the DB are unaffected.
  const legacyMarker = input.phase_marker ?? null;
  if (legacyMarker === "pms" || legacyMarker === "other") {
    throw new Error(
      `phase_marker '${legacyMarker}' ist nicht mehr verfügbar — bitte stattdessen cycle_phase setzen oder PMS als Symptom loggen.`,
    );
  }

  const cyclePhase = isCyclePhase(input.cycle_phase) ? input.cycle_phase : null;

  const row: Record<string, unknown> = {
    user_id: user.id,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    flow_intensity: input.flow_intensity ?? null,
    phase_marker: legacyMarker,
    cycle_phase: cyclePhase,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("menstrual_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as MenstrualLog;
}

export async function fetchMenstrualLogs(
  fromIso?: string,
  toIso?: string,
): Promise<MenstrualLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase
    .from("menstrual_logs")
    .select(COLS)
    .order("start_date", { ascending: false });
  if (fromIso) q = q.gte("start_date", fromIso);
  if (toIso)   q = q.lte("start_date", toIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as MenstrualLog[];
}

export async function fetchRecentMenstrualLogs(days: number): Promise<MenstrualLog[]> {
  const fromDate = new Date(Date.now() - days * 86400000);
  const fromIso = fromDate.toISOString().slice(0, 10);
  return fetchMenstrualLogs(fromIso);
}

export async function deleteMenstrualLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("menstrual_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
