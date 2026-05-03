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
export type PhaseMarker = "ovulation" | "pms" | "other";

export interface MenstrualLog {
  id: string;
  user_id: string;
  created_at: string;
  start_date: string;          // YYYY-MM-DD
  end_date: string | null;     // YYYY-MM-DD or null
  flow_intensity: FlowIntensity | null;
  phase_marker: PhaseMarker | null;
  notes: string | null;
}

export interface MenstrualLogInput {
  start_date: string;
  end_date?: string | null;
  flow_intensity?: FlowIntensity | null;
  phase_marker?: PhaseMarker | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,start_date,end_date,flow_intensity,phase_marker,notes";

export async function insertMenstrualLog(input: MenstrualLogInput): Promise<MenstrualLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    flow_intensity: input.flow_intensity ?? null,
    phase_marker: input.phase_marker ?? null,
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
