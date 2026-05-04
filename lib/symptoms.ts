import { supabase } from "./supabase";

/**
 * Standalone symptom event log. Multiple symptoms can be grouped under
 * one entry sharing a single severity (1..5) and timestamp. Used to
 * correlate hormonal/general symptoms with the glucose curve and
 * insulin sensitivity. Pure documentation — no derived calculations.
 *
 * Curated symptom vocabulary. Tokens are stable across releases so
 * stored rows keep their meaning. UI labels are looked up via i18n
 * (engineLog.symptom_<token>). Adding new symptoms is a code change.
 */
export const SYMPTOM_TYPES = [
  "headache",
  "fatigue",
  "cramps",
  "nausea",
  "cravings",
  "low_mood",
  "sleep_disturbance",
  "brain_fog",
  "bloating",
  "anxiety",
  "irritability",
  "back_pain",
  "breast_tenderness",
  "dizziness",
  // Classic hyper-/dehydration markers — useful diabetes context that
  // pairs well with the per-row glucose snapshot below.
  "mouth_dryness",
  "polyuria",
] as const;

export type SymptomType = typeof SYMPTOM_TYPES[number];
const SYMPTOM_SET: Set<string> = new Set(SYMPTOM_TYPES);
export function isSymptomType(v: unknown): v is SymptomType {
  return typeof v === "string" && SYMPTOM_SET.has(v);
}

export interface SymptomLog {
  id: string;
  user_id: string;
  created_at: string;
  occurred_at: string;
  symptom_types: SymptomType[];
  severity: 1 | 2 | 3 | 4 | 5;
  /** Snapshot of the live CGM reading at the moment of logging
   *  (mg/dL). Null when no CGM is connected, when the entry is
   *  logged retroactively, or for legacy rows inserted before this
   *  column existed. */
  cgm_glucose_at_log: number | null;
  notes: string | null;
}

export interface SymptomLogInput {
  symptom_types: SymptomType[];
  severity: number;            // validated to 1..5
  occurred_at?: string;        // ISO; defaults to now()
  /** Optional live CGM mg/dL captured by the caller right before the
   *  insert. Pass `null` (or omit) when no reading is available. */
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,occurred_at,symptom_types,severity,cgm_glucose_at_log,notes";

export async function insertSymptomLog(input: SymptomLogInput): Promise<SymptomLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  const types = (input.symptom_types || []).filter(isSymptomType);
  if (types.length === 0) throw new Error("Mindestens ein Symptom erforderlich.");
  const sev = Math.round(Number(input.severity));
  if (!Number.isFinite(sev) || sev < 1 || sev > 5) {
    throw new Error("Schweregrad muss zwischen 1 und 5 liegen.");
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    symptom_types: types,
    severity: sev,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("symptom_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as SymptomLog;
}

export async function fetchSymptomLogs(
  fromIso?: string,
  toIso?: string,
): Promise<SymptomLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase
    .from("symptom_logs")
    .select(COLS)
    .order("occurred_at", { ascending: false });
  if (fromIso) q = q.gte("occurred_at", fromIso);
  if (toIso)   q = q.lte("occurred_at", toIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as SymptomLog[];
}

export async function fetchRecentSymptomLogs(days: number): Promise<SymptomLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchSymptomLogs(fromIso);
}

export async function deleteSymptomLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("symptom_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
