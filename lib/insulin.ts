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
  // CGM auto-fetch results (populated by /api/cgm-jobs/process). Bolus
  // uses 1h/2h, basal uses 12h/24h. Null = not fetched yet (pending or
  // CGM not connected).
  glucose_after_1h?: number | null;
  glucose_after_2h?: number | null;
  glucose_after_12h?: number | null;
  glucose_after_24h?: number | null;
  // Optional explicit link to the meal this bolus was dosed for. Set by
  // the user via the "Zu Mahlzeit verknüpfen" dropdown in the Bolus log
  // dialog. Null for basal entries and un-tagged boluses. Engine ICR
  // pairing (lib/engine/pairing.ts) prefers this over time-window matches.
  related_entry_id?: string | null;
}

export interface InsulinLogInput {
  insulin_type: "bolus" | "basal";
  insulin_name: string;
  units: number;
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
  related_entry_id?: string | null;
}

const COLS =
  "id,user_id,created_at,insulin_type,insulin_name,units,cgm_glucose_at_log,notes,related_entry_id";

export async function insertInsulinLog(input: InsulinLogInput): Promise<InsulinLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  // PostgrestError / AuthError from supabase-js are plain objects, NOT
  // real Error subclasses. If we re-throw them as-is, downstream
  // `e instanceof Error` checks fail and the UI shows "Unbekannter
  // Fehler" instead of the actual cause (RLS denied, missing column,
  // session expired, …). Wrap every throw in a real Error so callers
  // get the message they need to debug.
  if (authErr || !user) {
    const m = authErr?.message || "Nicht angemeldet — bitte erneut einloggen.";
    throw new Error(m);
  }

  const row = {
    user_id: user.id,
    insulin_type: input.insulin_type,
    insulin_name: input.insulin_name.trim(),
    units: input.units,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
    // Only meaningful for bolus entries; basal always passes null.
    related_entry_id: input.insulin_type === "bolus" ? (input.related_entry_id ?? null) : null,
  };

  const { data, error } = await supabase
    .from("insulin_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    // Surface the PostgrestError message + code so RLS / FK / NOT NULL
    // / missing-column failures are visible in the UI banner instead
    // of being swallowed by the catch-block's instanceof Error check.
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as InsulinLog;
}

export async function fetchInsulinLogs(
  fromIso?: string,
  toIso?: string,
): Promise<InsulinLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  // select("*") so newly added post-fetch columns load without
  // requiring this string to be kept in sync with the schema.
  let q = supabase.from("insulin_logs").select("*").order("created_at", { ascending: false });
  if (fromIso) q = q.gte("created_at", fromIso);
  if (toIso)   q = q.lte("created_at", toIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as InsulinLog[];
}

export async function fetchRecentInsulinLogs(days: number): Promise<InsulinLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchInsulinLogs(fromIso);
}

export async function deleteInsulinLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("insulin_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Manual backfill for the post-fetch CGM readings on a Bolus or Basal log.
 *
 * Used by the entries-page expand views when the auto-fetch worker
 * either never had data (CGM disconnected, history too short) or the
 * job timed out before the user opened the app. The user enters the
 * BG from their meter, and we write it directly to the same column
 * the auto-fetch worker would have populated. Pass `null` to clear a
 * value. Only the keys present in `readings` are touched.
 */
export async function updateInsulinReadings(
  id: string,
  readings: {
    after_1h?: number | null;
    after_2h?: number | null;
    after_12h?: number | null;
    after_24h?: number | null;
  },
): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const patch: Record<string, unknown> = {};
  if (readings.after_1h  !== undefined) patch.glucose_after_1h  = readings.after_1h;
  if (readings.after_2h  !== undefined) patch.glucose_after_2h  = readings.after_2h;
  if (readings.after_12h !== undefined) patch.glucose_after_12h = readings.after_12h;
  if (readings.after_24h !== undefined) patch.glucose_after_24h = readings.after_24h;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("insulin_logs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
