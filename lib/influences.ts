import { supabase } from "./supabase";

/**
 * Standalone "influence" event log (UI label: Einflussfaktoren / Influences).
 * One row covers a single occurrence of something that may affect glucose
 * or insulin sensitivity (alcohol, cannabis, medication, other). Pure
 * documentation — the Engine never alters insulin dosage from these rows.
 *
 * UI label is intentionally neutral ("Einflussfaktoren" / "Influences")
 * — App-Store compliance: never surface "Drogen" or specific illegal
 * substance names anywhere in user-visible copy.
 *
 * Stable enum tokens persisted to DB; UI labels come from i18n.
 */
export const INFLUENCE_TYPES = [
  "alcohol",
  "cannabis",
  "medication",
  "other",
] as const;

export type InfluenceType = typeof INFLUENCE_TYPES[number];
const INFLUENCE_SET: Set<string> = new Set(INFLUENCE_TYPES);
export function isInfluenceType(v: unknown): v is InfluenceType {
  return typeof v === "string" && INFLUENCE_SET.has(v);
}

export interface InfluenceLog {
  id: string;
  user_id: string;
  created_at: string;
  occurred_at: string;
  influence_type: InfluenceType;
  /** Free-form short qualifier — e.g. medication name, drink type.
   *  Optional. Trimmed; empty stored as null. */
  details: string | null;
  /** Free-form quantity string — e.g. "2 Glas Wein", "5mg". Optional. */
  amount: string | null;
  /** Snapshot of the live CGM reading at log time (mg/dL). Null when
   *  no CGM is connected, the entry is back-dated, or the row predates
   *  the column. */
  cgm_glucose_at_log: number | null;
  notes: string | null;
}

export interface InfluenceLogInput {
  influence_type: InfluenceType;
  occurred_at?: string;
  details?: string | null;
  amount?: string | null;
  cgm_glucose_at_log?: number | null;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,occurred_at,influence_type,details,amount,cgm_glucose_at_log,notes";

export async function insertInfluenceLog(input: InfluenceLogInput): Promise<InfluenceLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  if (!isInfluenceType(input.influence_type)) {
    throw new Error("Ungültiger Einflussfaktor-Typ.");
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    influence_type: input.influence_type,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    details: input.details?.trim() || null,
    amount: input.amount?.trim() || null,
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("influence_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as InfluenceLog;
}

export async function fetchInfluenceLogs(
  fromIso?: string,
  toIso?: string,
): Promise<InfluenceLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase
    .from("influence_logs")
    .select(COLS)
    .order("occurred_at", { ascending: false });
  if (fromIso) q = q.gte("occurred_at", fromIso);
  if (toIso)   q = q.lte("occurred_at", toIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as InfluenceLog[];
}

export async function fetchRecentInfluenceLogs(days: number): Promise<InfluenceLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchInfluenceLogs(fromIso);
}

export async function deleteInfluenceLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("influence_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
