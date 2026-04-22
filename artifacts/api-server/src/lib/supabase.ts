import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

export const supabase = url && key ? createClient(url, key) : null;

export interface LogEntry {
  date: string;
  meal: string;
  glucose_before: number;
  glucose_after?: number | null;
  carbs: number;
  fiber?: number | null;
  protein?: number | null;
  fat?: number | null;
  net_carbs?: number | null;
  bolus_units: number;
  meal_type: string;
  evaluation?: string | null;
  notes?: string | null;
}

export async function insertLog(entry: LogEntry): Promise<unknown> {
  if (!supabase) {
    console.warn("[supabase] SUPABASE_URL or key not set — skipping cloud sync");
    return null;
  }
  const { data, error } = await supabase.from("logs").insert(entry).select().single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

export async function fetchAllLogs(): Promise<LogEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("logs")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return (data ?? []) as LogEntry[];
}
