/**
 * Daily activity (Apple Health step counts) — server + client helpers.
 *
 * Source of truth: `daily_activity_summary` table (Migration
 * 20260519). The iOS shell pushes per-day aggregates via
 * POST /api/health/steps/sync. The engine reads from this table as a
 * pure annotation signal — it never alters the dose math.
 */

import { adminClient } from "./cgm/supabase";

export interface DailyActivityRow {
  /** ISO calendar date in the device's local timezone (YYYY-MM-DD). */
  date: string;
  steps: number;
  active_minutes: number | null;
  source: string;
}

/**
 * Server-side: load the last `days` days of activity for a user, newest
 * first. Used by the engine context helper. Returns [] on any error so
 * activity is a pure "best-effort" signal — a Supabase hiccup should
 * never block dose reasoning.
 */
export async function loadRecentActivityServer(
  userId: string,
  days = 14,
): Promise<DailyActivityRow[]> {
  if (days <= 0) return [];
  const sinceDate = new Date(Date.now() - days * 86_400_000);
  const sinceIso = sinceDate.toISOString().slice(0, 10);
  try {
    const { data, error } = await adminClient()
      .from("daily_activity_summary")
      .select("date, steps, active_minutes, source")
      .eq("user_id", userId)
      .gte("date", sinceIso)
      .order("date", { ascending: false })
      .limit(days + 1);
    if (error) return [];
    return (data ?? []) as DailyActivityRow[];
  } catch {
    return [];
  }
}

export interface ActivityContext {
  /** Today's steps (device-local), or null when no row for today. */
  todaySteps: number | null;
  /** Trailing 7-day average steps (rounded), or null when no rows. */
  avgSteps7d: number | null;
  /** Number of days in the 7-day window with at least one row. */
  sampleSize7d: number;
}

/**
 * Reduce raw daily rows into a small engine-facing context object.
 * Pure — `rows` must already be sorted newest-first (the loader does
 * this). The "today" check uses the device-local date string the iOS
 * shell stored, so it doesn't drift across timezones.
 */
export function summariseActivityContext(
  rows: DailyActivityRow[],
  today: string = todayLocalIso(),
): ActivityContext {
  const todayRow = rows.find((r) => r.date === today) ?? null;
  const last7 = rows.slice(0, 7);
  const sum7 = last7.reduce((acc, r) => acc + (Number.isFinite(r.steps) ? r.steps : 0), 0);
  const avg = last7.length > 0 ? Math.round(sum7 / last7.length) : null;
  return {
    todaySteps: todayRow ? todayRow.steps : null,
    avgSteps7d: avg,
    sampleSize7d: last7.length,
  };
}

/** YYYY-MM-DD in the caller's local timezone — matches the format the
 *  iOS shell stores into `daily_activity_summary.date`. */
export function todayLocalIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------
// Client-side fetch helper for the Insights card.
// ---------------------------------------------------------------------

export interface ClientActivityResponse {
  rows: DailyActivityRow[];
  context: ActivityContext;
}

export async function fetchRecentActivityClient(
  days = 14,
): Promise<ClientActivityResponse> {
  try {
    // Pass the browser's local "today" so the server's context summary
    // resolves `todaySteps` against the same calendar day the iOS
    // shell stored, regardless of whether the API process runs in UTC.
    const today = todayLocalIso();
    const r = await fetch(
      `/api/health/steps?days=${days}&today=${today}`,
      { cache: "no-store" },
    );
    if (!r.ok) return { rows: [], context: summariseActivityContext([], today) };
    const j = (await r.json()) as ClientActivityResponse;
    const rows = Array.isArray(j.rows) ? j.rows : [];
    return {
      rows,
      // Re-compute on the client too — defensive against an older
      // server build that ignores the `today` query param.
      context: summariseActivityContext(rows, today),
    };
  } catch {
    return { rows: [], context: summariseActivityContext([]) };
  }
}
