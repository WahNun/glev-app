import { supabase } from "./supabase";

/**
 * Standalone insulin event log — independent of meals.
 * Pure documentation: Glev does NOT calculate doses. Users record
 * what they injected.
 */
export interface InsulinLog {
  id: string;
  user_id: string;
  created_at: string;
  insulin_type: "bolus" | "basal";
  insulin_name: string;
  units: number;
  cgm_glucose_at_log: number | null;
  notes: string | null;
}

export interface InsulinLogInput {
  insulin_type: "bolus" | "basal";
  insulin_name: string;
  units: number;
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,insulin_type,insulin_name,units,cgm_glucose_at_log,notes";

export async function insertInsulinLog(input: InsulinLogInput): Promise<InsulinLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw authErr || new Error("Not authenticated");

  const row = {
    user_id: user.id,
    insulin_type: input.insulin_type,
    insulin_name: input.insulin_name.trim(),
    units: input.units,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("insulin_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as InsulinLog;
}

export async function fetchInsulinLogs(
  fromIso?: string,
  toIso?: string,
): Promise<InsulinLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase.from("insulin_logs").select(COLS).order("created_at", { ascending: false });
  if (fromIso) q = q.gte("created_at", fromIso);
  if (toIso)   q = q.lte("created_at", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as InsulinLog[];
}

export async function fetchRecentInsulinLogs(days: number): Promise<InsulinLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchInsulinLogs(fromIso);
}

export async function deleteInsulinLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("insulin_logs").delete().eq("id", id);
  if (error) throw error;
}
