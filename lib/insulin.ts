import { supabase } from "./supabase";

export type InsulinKind = "bolus" | "basal" | "correction";

export interface InsulinEntry {
  id: string;
  user_id: string;
  units: number;
  kind: InsulinKind;
  at: string;
  note: string | null;
  meal_id: string | null;
  created_at: string;
}

export interface SaveInsulinInput {
  units: number;
  kind: InsulinKind;
  at: string;
  note?: string | null;
  mealId?: string | null;
}

const COLS =
  "id, user_id, units, kind, at, note, meal_id, created_at";

export function isValidInsulinKind(v: unknown): v is InsulinKind {
  return v === "bolus" || v === "basal" || v === "correction";
}

export async function fetchInsulinEntries(
  fromIso?: string,
  toIso?: string,
): Promise<InsulinEntry[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase.from("insulin_entries").select(COLS).order("at", { ascending: false });
  if (fromIso) q = q.gte("at", fromIso);
  if (toIso) q = q.lte("at", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as InsulinEntry[];
}

export async function saveInsulinEntry(input: SaveInsulinInput): Promise<InsulinEntry> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not authenticated");

  const row = {
    user_id: user.id,
    units: input.units,
    kind: input.kind,
    at: input.at,
    note: input.note ?? null,
    meal_id: input.mealId ?? null,
  };

  const { data, error } = await supabase
    .from("insulin_entries")
    .insert(row)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as InsulinEntry;
}

export async function deleteInsulinEntry(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("insulin_entries").delete().eq("id", id);
  if (error) throw error;
}

export function dailyTotals(entries: InsulinEntry[]): {
  bolus: number;
  basal: number;
  correction: number;
  total: number;
} {
  const t = { bolus: 0, basal: 0, correction: 0, total: 0 };
  for (const e of entries) {
    t[e.kind] += Number(e.units);
    t.total += Number(e.units);
  }
  return t;
}
