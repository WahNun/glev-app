"use client";

import { supabase } from "./supabase";

export type LogType = "meal" | "bolus" | "basal" | "exercise";

export type FetchType =
  | "before"
  | "bg_1h" | "bg_2h"
  | "after_1h" | "after_2h"
  | "after_12h" | "after_24h"
  | "at_end" | "exer_after_1h"
  | "meal_curve_180"
  | "bolus_curve_180"
  | "exercise_curve_180";

export type JobStatus = "pending" | "fetched" | "failed" | "skipped";

export interface CgmFetchJob {
  id: string;
  user_id: string;
  log_id: string;
  log_type: LogType;
  fetch_type: FetchType;
  fetch_time: string;
  status: JobStatus;
  retry_count: number;
  value_mgdl: number | null;
  fetched_at: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Human-readable label for a fetched value, used in expanded entry views.
 * E.g. "1H POST", "AT END", "12H POST".
 */
export function fetchTypeLabel(t: FetchType): string {
  switch (t) {
    case "before":         return "AT LOG";
    case "bg_1h":
    case "after_1h":
    case "exer_after_1h":  return "1H POST";
    case "bg_2h":
    case "after_2h":       return "2H POST";
    case "after_12h":      return "12H POST";
    case "after_24h":      return "24H POST";
    case "at_end":         return "AT END";
    case "meal_curve_180":
    case "bolus_curve_180":
    case "exercise_curve_180": return "3H CURVE";
  }
}

/**
 * Schedule fetch jobs for a freshly inserted log entry. Triggers an
 * immediate "before" fetch on the server and queues the rest. Safe to
 * call without awaiting if you don't need the result — failures are
 * logged but don't block the calling submit flow.
 */
export async function scheduleJobsForLog(args: {
  logId: string;
  logType: LogType;
  refTimeIso: string;
  /** Workout duration in minutes — required only for log_type === "exercise". */
  durationMinutes?: number;
}): Promise<{ ok: boolean; glucoseAtLog?: number | null }> {
  try {
    const r = await fetch("/api/cgm-jobs/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn("[cgmJobs] schedule failed", r.status, txt);
      return { ok: false };
    }
    const j = await r.json();
    return { ok: true, glucoseAtLog: j.glucoseAtLog ?? null };
  } catch (e) {
    console.warn("[cgmJobs] schedule error", e);
    return { ok: false };
  }
}

/**
 * Process all pending jobs whose fetch_time is in the past. Called
 * by the periodic ticker and on app load. Returns counts.
 */
export async function processPendingJobs(): Promise<{
  fetched: number; failed: number; skipped: number; pending: number;
} | null> {
  try {
    const r = await fetch("/api/cgm-jobs/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn("[cgmJobs] process error", e);
    return null;
  }
}

/**
 * Fetch all jobs for a single log entry (used by expanded views to
 * show pending/fetched state with proper labels).
 */
export async function fetchJobsForLog(logId: string): Promise<CgmFetchJob[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("cgm_fetch_jobs")
    .select("*")
    .eq("log_id", logId)
    .order("fetch_time", { ascending: true });
  if (error) {
    console.warn("[cgmJobs] fetchJobsForLog", error);
    return [];
  }
  return (data || []) as CgmFetchJob[];
}
