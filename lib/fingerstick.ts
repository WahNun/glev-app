import { supabase } from "./supabase";

/**
 * Manual fingerstick (capillary blood) glucose readings.
 *
 * Persisted in `fingerstick_readings` (see
 * supabase/migrations/20260426_add_fingerstick_readings.sql). Used when
 * CGM data is unavailable or the user wants to override the CGM value
 * with a more trustworthy fingerstick measurement.
 *
 * Display + business rules:
 *   • Dashboard renders FS points as squares (white outline) on the
 *     2-h sparkline so they are visually distinct from CGM circles.
 *   • If a fingerstick exists within FS_OVERRIDE_WINDOW_MS of "now",
 *     it takes precedence over the latest CGM value as the
 *     "current glucose" everywhere (hero number, engine glucose_before).
 */

export const FS_OVERRIDE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface FingerstickReading {
  id: string;
  user_id: string;
  measured_at: string;
  value_mg_dl: number;
  notes: string | null;
  created_at: string;
}

export interface FingerstickInput {
  value_mg_dl: number;
  measured_at?: string; // ISO; defaults to now()
  notes?: string | null;
}

const COLS = "id,user_id,measured_at,value_mg_dl,notes,created_at";

export async function insertFingerstick(input: FingerstickInput): Promise<FingerstickReading> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw authErr || new Error("Not authenticated");

  if (!Number.isFinite(input.value_mg_dl) || input.value_mg_dl < 20 || input.value_mg_dl > 600) {
    throw new Error("Glucose value must be between 20 and 600 mg/dL");
  }

  const row = {
    user_id: user.id,
    value_mg_dl: input.value_mg_dl,
    measured_at: input.measured_at ?? new Date().toISOString(),
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("fingerstick_readings")
    .insert(row)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as FingerstickReading;
}

/**
 * Fetch fingerstick readings within a time range. `fromIso` is inclusive,
 * `toIso` is inclusive. Newest first.
 */
export async function fetchFingersticks(fromIso?: string, toIso?: string): Promise<FingerstickReading[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase.from("fingerstick_readings").select(COLS).order("measured_at", { ascending: false });
  if (fromIso) q = q.gte("measured_at", fromIso);
  if (toIso)   q = q.lte("measured_at", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as FingerstickReading[];
}

/** Convenience: fingersticks measured in the last `hours` hours. */
export async function fetchRecentFingersticks(hours: number): Promise<FingerstickReading[]> {
  const fromIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return fetchFingersticks(fromIso);
}

/**
 * The single most-recent fingerstick reading, or null. Returns regardless
 * of how old it is — callers use FS_OVERRIDE_WINDOW_MS to decide whether
 * it should override CGM data as the "current" glucose.
 */
export async function fetchLatestFingerstick(): Promise<FingerstickReading | null> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("fingerstick_readings")
    .select(COLS)
    .order("measured_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) ? (data[0] as FingerstickReading) : null;
}

export async function deleteFingerstick(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("fingerstick_readings").delete().eq("id", id);
  if (error) throw error;
}
