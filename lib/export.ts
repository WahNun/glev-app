// CSV export helpers for Glev. All exports run client-side: we already
// have the data in the user's browser via supabase.from(...).select(...)
// so there's no value in adding a server endpoint just to re-encode it.
//
// Each `*ToCSV` function produces a self-contained CSV string with a
// header row and one record per source row. NULL values become empty
// fields. Complex columns (e.g. parsed_json on meals) are serialized as
// minified JSON in a single quoted cell so the file remains valid CSV
// while preserving the original data shape for round-trip use.

import { supabase } from "@/lib/supabase";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";

/* ──────────────────────────────────────────────────────────────────
   CSV primitives
   ────────────────────────────────────────────────────────────────── */

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else s = JSON.stringify(v);
  // Quote when the cell contains a comma, double-quote, CR or LF.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function buildCSV(headers: string[], rows: unknown[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join("\r\n");
}

/* ──────────────────────────────────────────────────────────────────
   Per-table serializers
   ────────────────────────────────────────────────────────────────── */

export function mealsToCSV(meals: Meal[]): string {
  const headers = [
    "id", "created_at", "meal_time", "meal_type", "input_text",
    "carbs_grams", "protein_grams", "fat_grams", "fiber_grams", "calories",
    "insulin_units",
    "glucose_before", "glucose_after", "bg_1h", "bg_1h_at", "bg_2h", "bg_2h_at",
    "outcome_state", "evaluation", "related_meal_id",
    "parsed_json",
  ];
  const rows = meals.map((m) => [
    m.id, m.created_at, m.meal_time, m.meal_type, m.input_text,
    m.carbs_grams, m.protein_grams, m.fat_grams, m.fiber_grams, m.calories,
    m.insulin_units,
    m.glucose_before, m.glucose_after, m.bg_1h, m.bg_1h_at, m.bg_2h, m.bg_2h_at,
    m.outcome_state, m.evaluation, m.related_meal_id,
    m.parsed_json,
  ]);
  return buildCSV(headers, rows);
}

export function insulinToCSV(logs: InsulinLog[]): string {
  const headers = [
    "id", "created_at", "insulin_type", "insulin_name", "units",
    "cgm_glucose_at_log",
    "glucose_after_1h", "glucose_after_2h",
    "glucose_after_12h", "glucose_after_24h",
    "related_entry_id", "notes",
  ];
  const rows = logs.map((l) => [
    l.id, l.created_at, l.insulin_type, l.insulin_name, l.units,
    l.cgm_glucose_at_log ?? null,
    l.glucose_after_1h ?? null, l.glucose_after_2h ?? null,
    l.glucose_after_12h ?? null, l.glucose_after_24h ?? null,
    l.related_entry_id ?? null, l.notes,
  ]);
  return buildCSV(headers, rows);
}

export function exerciseToCSV(logs: ExerciseLog[]): string {
  const headers = [
    "id", "created_at", "exercise_type", "duration_minutes", "intensity",
    "cgm_glucose_at_log", "glucose_at_end", "glucose_after_1h", "notes",
  ];
  const rows = logs.map((e) => [
    e.id, e.created_at, e.exercise_type, e.duration_minutes, e.intensity,
    e.cgm_glucose_at_log ?? null, e.glucose_at_end ?? null,
    e.glucose_after_1h ?? null, e.notes,
  ]);
  return buildCSV(headers, rows);
}

export function fingersticksToCSV(readings: FingerstickReading[]): string {
  const headers = [
    "id", "measured_at", "value_mg_dl", "notes", "created_at",
  ];
  const rows = readings.map((r) => [
    r.id, r.measured_at, r.value_mg_dl, r.notes, r.created_at,
  ]);
  return buildCSV(headers, rows);
}

/* ──────────────────────────────────────────────────────────────────
   Fetchers (full history per kind, scoped to the signed-in user via
   RLS — supabase enforces this server-side). Each catches errors and
   returns [] so a single broken table doesn't block the other exports.
   ────────────────────────────────────────────────────────────────── */

export async function fetchAllMeals(): Promise<Meal[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("meals")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as Meal[];
}

export async function fetchAllInsulinLogs(): Promise<InsulinLog[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("insulin_logs")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as InsulinLog[];
}

export async function fetchAllExerciseLogs(): Promise<ExerciseLog[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("exercise_logs")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as ExerciseLog[];
}

export async function fetchAllFingersticks(): Promise<FingerstickReading[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("fingerstick_readings")
    .select("*")
    .order("measured_at", { ascending: false });
  return (data ?? []) as FingerstickReading[];
}

/* ──────────────────────────────────────────────────────────────────
   Browser download helper. We use a Blob + object URL because that
   keeps memory usage low for large CSVs (no base64 inflation) and
   plays nicely with the browser's native filename suggestion.
   ────────────────────────────────────────────────────────────────── */

export function downloadFile(filename: string, content: string, mimeType: string = "text/csv;charset=utf-8") {
  // Prepend BOM so Excel opens UTF-8 correctly without garbled umlauts.
  const blob = new Blob(["\uFEFF", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ISO date string for filenames: YYYY-MM-DD. */
export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
