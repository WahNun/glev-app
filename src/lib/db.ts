import { supabase } from "./supabase";

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

export async function insertLog(entry: LogEntry): Promise<LogEntry & { id: string }> {
  if (!supabase) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  const { data, error } = await supabase.from("logs").insert(entry).select().single();
  if (error) throw new Error(error.message);
  return data as LogEntry & { id: string };
}

export async function fetchAllLogs(): Promise<LogEntry[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("logs")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LogEntry[];
}
