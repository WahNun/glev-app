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
import { gToUnit, icrToUnit, type CarbUnit } from "@/lib/carbUnits";

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

// Default to grams when the caller doesn't pass a unit, so any legacy
// caller (or test) that doesn't yet thread through the user preference
// continues to receive byte-for-byte identical output.
export function mealsToCSV(meals: Meal[], unit: CarbUnit = "g"): string {
  // Header reflects the active unit so a clinician opening the file
  // can see at a glance whether a value is grams, BE, or KE. The
  // column key itself ("carbs_grams" vs "carbs_be" / "carbs_ke") is
  // unit-suffixed too so a side-by-side BE + g export from two users
  // won't silently overwrite cells when joined on the header name.
  // Use the short unit code in parens ("g" / "BE" / "KE") rather than
  // the verbose "g KH" label so a column reads "carbs_grams (g)" not
  // the redundant "carbs_grams (g KH)".
  const carbsHeader =
    unit === "g" ? "carbs_grams" : `carbs_${unit.toLowerCase()}`;
  const carbsUnitTag = unit === "g" ? "g" : unit;
  const headers = [
    "id", "created_at", "meal_time", "meal_type", "input_text",
    `${carbsHeader} (${carbsUnitTag})`,
    "protein_grams", "fat_grams", "fiber_grams", "calories",
    "insulin_units",
    "glucose_before", "glucose_after", "bg_1h", "bg_1h_at", "bg_2h", "bg_2h_at",
    "outcome_state", "evaluation", "related_meal_id",
    "parsed_json",
  ];
  const rows = meals.map((m) => [
    m.id, m.created_at, m.meal_time, m.meal_type, m.input_text,
    // Convert at the presentation layer only — the DB still holds grams.
    // null/undefined survive csvCell as empty cells, so guard so we don't
    // silently emit "0" for missing values.
    m.carbs_grams === null || m.carbs_grams === undefined
      ? null
      : gToUnit(m.carbs_grams, unit),
    m.protein_grams, m.fat_grams, m.fiber_grams, m.calories,
    m.insulin_units,
    m.glucose_before, m.glucose_after, m.bg_1h, m.bg_1h_at, m.bg_2h, m.bg_2h_at,
    m.outcome_state, m.evaluation, m.related_meal_id,
    m.parsed_json,
  ]);
  return buildCSV(headers, rows);
}

// Optional second argument lets the caller annotate every row with the
// user's current ICR converted to their preferred carb-unit (e.g. BE/IE
// or KE/IE) AND/OR their current correction factor (mg/dL drop per 1
// IE). Some DACH clinics like to read insulin doses alongside the
// ratio they were dosed against — and the matching CF — so a quick
// "U vs ICR + CF" sanity check is possible without flipping back to
// the patient's settings sheet. The values are a snapshot of the
// user's *current* setting at export time — not per-log historic
// values, since insulin_logs doesn't store either.
//
// CF is always emitted in mg/dL/IE because that is the canonical (and
// only) unit Glev stores. There is no carb-unit conversion to do — CF
// is a glucose-per-insulin ratio, not a carb ratio — so the column key
// stays `cf_mgdl_per_ie` regardless of the user's chosen carb unit.
//
// Defaults preserve the legacy header/row layout byte-for-byte: any
// caller that hasn't been threaded with the user preference (or any
// test that asserts on the raw output) keeps working unchanged.
export function insulinToCSV(
  logs: InsulinLog[],
  opts: {
    carbUnit?: CarbUnit;
    icrGperIE?: number | null;
    cfMgdlPerIE?: number | null;
  } = {},
): string {
  const { carbUnit, icrGperIE, cfMgdlPerIE } = opts;
  // Annotate ICR only when both the unit AND a finite positive value
  // are available — a missing ICR setting (user never opened Settings)
  // would otherwise show a misleading "0 BE/IE" in every row.
  const includeICR =
    carbUnit !== undefined &&
    typeof icrGperIE === "number" &&
    Number.isFinite(icrGperIE) &&
    icrGperIE > 0;
  // CF is independent of carbUnit (it's mg/dL per IE), so we can
  // emit it as soon as a finite positive value is supplied. Same
  // safeguards as ICR — a missing/zero value would otherwise read
  // as "0 mg/dL/IE" and suggest an unsafe correction ratio.
  const includeCF =
    typeof cfMgdlPerIE === "number" &&
    Number.isFinite(cfMgdlPerIE) &&
    cfMgdlPerIE > 0;
  // Header column tag mirrors the meals CSV convention: short unit
  // code in parens (e.g. "icr_be_per_ie (BE/IE)"), so the column is
  // self-describing for a clinician opening the file standalone.
  const icrUnitTag = carbUnit === "g" ? "g" : (carbUnit ?? "g");
  const icrHeaderKey =
    carbUnit === "g"
      ? "icr_g_per_ie"
      : `icr_${(carbUnit ?? "g").toLowerCase()}_per_ie`;
  const icrHeader = `${icrHeaderKey} (${icrUnitTag}/IE)`;
  const cfHeader = "cf_mgdl_per_ie (mg/dL/IE)";
  // Pre-compute the converted value once — same for every row, since
  // the user's current ICR is a single setting at export time.
  const icrConverted = includeICR
    ? icrToUnit(icrGperIE as number, carbUnit as CarbUnit)
    : null;
  const cfValue = includeCF ? (cfMgdlPerIE as number) : null;

  const headers = [
    "id", "created_at", "insulin_type", "insulin_name", "units",
    "cgm_glucose_at_log",
    "glucose_after_1h", "glucose_after_2h",
    "glucose_after_12h", "glucose_after_24h",
    "related_entry_id", "notes",
    ...(includeICR ? [icrHeader] : []),
    ...(includeCF ? [cfHeader] : []),
  ];
  const rows = logs.map((l) => [
    l.id, l.created_at, l.insulin_type, l.insulin_name, l.units,
    l.cgm_glucose_at_log ?? null,
    l.glucose_after_1h ?? null, l.glucose_after_2h ?? null,
    l.glucose_after_12h ?? null, l.glucose_after_24h ?? null,
    l.related_entry_id ?? null, l.notes,
    ...(includeICR ? [icrConverted] : []),
    ...(includeCF ? [cfValue] : []),
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
   Fetchers (per kind, scoped to the signed-in user via RLS — supabase
   enforces this server-side). Each catches errors and returns [] so
   a single broken table doesn't block the other exports.

   Each fetcher accepts an optional `{ from, to }` window (ISO date-
   time strings). When provided, the values are passed through as
   `gte` / `lte` filters on the table's primary timestamp column —
   `created_at` for meals / insulin / exercise (which is when the
   user logged the entry, and what the in-app feeds order by) and
   `measured_at` for fingersticks (the actual stick time, not the
   later sync time). Both bounds are optional individually so a
   "since X" or "up to Y" query also works; passing neither returns
   the full history (legacy behaviour).
   ────────────────────────────────────────────────────────────────── */

/**
 * Optional date-range window for the export fetchers. Both ends are
 * inclusive ISO timestamps; either may be omitted for an open range.
 *
 * Default semantics across all four fetchers:
 *   - undefined window  → full history (no filter applied)
 *   - { from }          → only rows on/after `from`
 *   - { to }            → only rows on/before `to`
 *   - { from, to }      → rows in the closed interval [from, to]
 */
export interface DateWindow {
  from?: string;
  to?: string;
}

export async function fetchAllMeals(window?: DateWindow): Promise<Meal[]> {
  if (!supabase) return [];
  let q = supabase
    .from("meals")
    .select("*")
    .order("created_at", { ascending: false });
  if (window?.from) q = q.gte("created_at", window.from);
  if (window?.to)   q = q.lte("created_at", window.to);
  const { data } = await q;
  return (data ?? []) as Meal[];
}

export async function fetchAllInsulinLogs(window?: DateWindow): Promise<InsulinLog[]> {
  if (!supabase) return [];
  let q = supabase
    .from("insulin_logs")
    .select("*")
    .order("created_at", { ascending: false });
  if (window?.from) q = q.gte("created_at", window.from);
  if (window?.to)   q = q.lte("created_at", window.to);
  const { data } = await q;
  return (data ?? []) as InsulinLog[];
}

export async function fetchAllExerciseLogs(window?: DateWindow): Promise<ExerciseLog[]> {
  if (!supabase) return [];
  let q = supabase
    .from("exercise_logs")
    .select("*")
    .order("created_at", { ascending: false });
  if (window?.from) q = q.gte("created_at", window.from);
  if (window?.to)   q = q.lte("created_at", window.to);
  const { data } = await q;
  return (data ?? []) as ExerciseLog[];
}

export async function fetchAllFingersticks(window?: DateWindow): Promise<FingerstickReading[]> {
  if (!supabase) return [];
  // Filter on `measured_at` rather than `created_at`: a fingerstick
  // is the time the user pricked their finger, not the later moment
  // the row was synced. A clinician asking for "the last 90 days of
  // glucose" expects the bound to be the measurement time.
  let q = supabase
    .from("fingerstick_readings")
    .select("*")
    .order("measured_at", { ascending: false });
  if (window?.from) q = q.gte("measured_at", window.from);
  if (window?.to)   q = q.lte("measured_at", window.to);
  const { data } = await q;
  return (data ?? []) as FingerstickReading[];
}

/* ──────────────────────────────────────────────────────────────────
   Count helpers — mirror the four `fetchAll*` helpers above but use
   Supabase's `{ count: 'exact', head: true }` so we get just the row
   count (no payload). Used by `ExportPanel` to render a live preview
   line ("12 Mahlzeiten · 8 Insulin · …") under the date-range picker
   so the user can confirm their slice before clicking export.

   The filter logic mirrors the matching `fetchAll*` helper exactly
   (same column for the bound — `created_at` for meals/insulin/
   exercise, `measured_at` for fingersticks — same gte/lte direction)
   so the preview cannot drift from the actual file contents.

   On error / missing supabase client, each helper returns 0 instead
   of throwing — a missing count line is preferable to blocking the
   panel render or showing a scary error for a soft preview.
   ────────────────────────────────────────────────────────────────── */

async function countCreatedAtTable(
  table: "meals" | "insulin_logs" | "exercise_logs",
  window?: DateWindow,
): Promise<number> {
  if (!supabase) return 0;
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  if (window?.from) q = q.gte("created_at", window.from);
  if (window?.to)   q = q.lte("created_at", window.to);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

export async function countMealsInWindow(window?: DateWindow): Promise<number> {
  return countCreatedAtTable("meals", window);
}

export async function countInsulinLogsInWindow(window?: DateWindow): Promise<number> {
  return countCreatedAtTable("insulin_logs", window);
}

export async function countExerciseLogsInWindow(window?: DateWindow): Promise<number> {
  return countCreatedAtTable("exercise_logs", window);
}

export async function countFingersticksInWindow(window?: DateWindow): Promise<number> {
  if (!supabase) return 0;
  // Same `measured_at` (not `created_at`) bound as `fetchAllFingersticks`,
  // so the preview cannot drift from what the export actually contains.
  let q = supabase
    .from("fingerstick_readings")
    .select("id", { count: "exact", head: true });
  if (window?.from) q = q.gte("measured_at", window.from);
  if (window?.to)   q = q.lte("measured_at", window.to);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

/**
 * Per-kind row counts for a given window — convenience wrapper that
 * runs all four count queries in parallel. Used by `ExportPanel` for
 * the preview line under the date-range picker.
 */
export interface RangeCounts {
  meals: number;
  insulin: number;
  exercise: number;
  fingersticks: number;
}

export async function countAllInWindow(window?: DateWindow): Promise<RangeCounts> {
  const [meals, insulin, exercise, fingersticks] = await Promise.all([
    countMealsInWindow(window),
    countInsulinLogsInWindow(window),
    countExerciseLogsInWindow(window),
    countFingersticksInWindow(window),
  ]);
  return { meals, insulin, exercise, fingersticks };
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

// Bundle CSV files into a zip. Prepends the same UTF-8 BOM as
// downloadFile so Excel opens extracted CSVs without garbled umlauts.
// Returns Uint8Array so the helper is usable outside the DOM (tests).
export async function buildCSVZip(
  files: Array<[filename: string, content: string]>,
): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [name, content] of files) {
    zip.file(name, "\uFEFF" + content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

// Browser download of a CSV bundle as a single .zip.
export async function downloadZipOfCSVs(
  zipFilename: string,
  files: Array<[filename: string, content: string]>,
): Promise<void> {
  const bytes = await buildCSVZip(files);
  // Copy into a fresh Uint8Array so the Blob owns a tightly-sized
  // ArrayBuffer (avoids the wider ArrayBufferLike type from jszip).
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ISO date string for filenames: YYYY-MM-DD. */
export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
