import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import { getHistory, type Reading } from "@/lib/cgm/llu";
import type { LogType, FetchType, CgmFetchJob } from "@/lib/cgmJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5 * 60 * 1000;          // 5 min
const MATCH_WINDOW_MS = 10 * 60 * 1000;        // ±10 min around fetch_time
const ABANDON_AFTER_MS = 60 * 60 * 1000;       // 1h past fetch_time → mark failed if still no data

function targetColumn(logType: LogType, fetchType: FetchType): { table: string; column: string } | null {
  if (logType === "meal") {
    if (fetchType === "bg_1h") return { table: "meals", column: "bg_1h" };
    if (fetchType === "bg_2h") return { table: "meals", column: "bg_2h" };
  }
  if (logType === "bolus" || logType === "basal") {
    if (fetchType === "after_1h")  return { table: "insulin_logs", column: "glucose_after_1h" };
    if (fetchType === "after_2h")  return { table: "insulin_logs", column: "glucose_after_2h" };
    if (fetchType === "after_12h") return { table: "insulin_logs", column: "glucose_after_12h" };
    if (fetchType === "after_24h") return { table: "insulin_logs", column: "glucose_after_24h" };
  }
  if (logType === "exercise") {
    if (fetchType === "at_end")        return { table: "exercise_logs", column: "glucose_at_end" };
    if (fetchType === "exer_after_1h") return { table: "exercise_logs", column: "glucose_after_1h" };
  }
  return null;
}

/** Find the reading whose timestamp is closest to target (within window). */
function pickReadingNear(history: Reading[], targetMs: number, windowMs: number): Reading | null {
  let best: Reading | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const r of history) {
    if (!r.timestamp || r.value == null) continue;
    const t = new Date(r.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    const d = Math.abs(t - targetMs);
    if (d <= windowMs && d < bestDiff) {
      best = r;
      bestDiff = d;
    }
  }
  return best;
}

/**
 * POST /api/cgm-jobs/process
 * Run through the user's pending jobs whose fetch_time is in the past,
 * try to resolve each via the CGM history, and update both the job row
 * and the corresponding log row's target column.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });

  const admin = adminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Pull due pending jobs (cap to 50 per pass to keep latency bounded).
  const { data: jobs, error: qErr } = await admin
    .from("cgm_fetch_jobs")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .lte("fetch_time", nowIso)
    .order("fetch_time", { ascending: true })
    .limit(50);
  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }
  const due = (jobs || []) as CgmFetchJob[];
  if (due.length === 0) {
    return NextResponse.json({ fetched: 0, failed: 0, skipped: 0, pending: 0 });
  }

  // Pull CGM history once. If the user has no CGM connected, mark every
  // due job as 'skipped' (no error).
  let history: Reading[] = [];
  let current: Reading | null = null;
  let cgmAvailable = true;
  try {
    const out = await getHistory(user.id);
    history = out?.history || [];
    current = out?.current || null;
  } catch (e) {
    cgmAvailable = false;
    console.info("[cgm-jobs/process] CGM not available:", (e as Error)?.message || e);
  }

  let fetched = 0, failed = 0, skipped = 0, stillPending = 0;

  for (const job of due) {
    if (!cgmAvailable) {
      await admin.from("cgm_fetch_jobs")
        .update({ status: "skipped", error_msg: "CGM not connected", updated_at: nowIso })
        .eq("id", job.id);
      skipped++;
      continue;
    }

    const fetchTimeMs = new Date(job.fetch_time).getTime();
    const ageMs = nowMs - fetchTimeMs;

    // 1) Try historical match first (closest reading within ±10min of fetch_time).
    let value: number | null = null;
    const hit = pickReadingNear(history, fetchTimeMs, MATCH_WINDOW_MS);
    if (hit && typeof hit.value === "number") {
      value = hit.value;
    } else if (ageMs <= MATCH_WINDOW_MS && current?.value != null) {
      // 2) If the job is fresh (within the match window), accept current.
      value = current.value;
    }

    if (value != null) {
      const tc = targetColumn(job.log_type, job.fetch_type);
      if (tc) {
        // Don't overwrite a manually entered value — only fill if NULL.
        try {
          const { data: rowRaw } = await admin.from(tc.table).select("*").eq("id", job.log_id).maybeSingle();
          const row = rowRaw as unknown as Record<string, unknown> | null;
          const cur = row ? row[tc.column] : null;
          if (row && (cur == null || cur === "")) {
            await admin.from(tc.table).update({ [tc.column]: value }).eq("id", job.log_id);
          }
        } catch (e) {
          console.warn("[cgm-jobs/process] writeback failed:", e);
        }
      }
      await admin.from("cgm_fetch_jobs")
        .update({ status: "fetched", value_mgdl: value, fetched_at: nowIso, updated_at: nowIso })
        .eq("id", job.id);
      fetched++;
      continue;
    }

    // No data found.
    if (job.retry_count >= MAX_RETRIES || ageMs >= ABANDON_AFTER_MS) {
      await admin.from("cgm_fetch_jobs")
        .update({ status: "failed", error_msg: "no CGM data near fetch_time", updated_at: nowIso })
        .eq("id", job.id);
      failed++;
    } else {
      // Push fetch_time forward by RETRY_DELAY_MS so we don't busy-loop.
      const next = new Date(nowMs + RETRY_DELAY_MS).toISOString();
      await admin.from("cgm_fetch_jobs")
        .update({ retry_count: job.retry_count + 1, fetch_time: next, updated_at: nowIso })
        .eq("id", job.id);
      stillPending++;
    }
  }

  return NextResponse.json({ fetched, failed, skipped, pending: stillPending });
}
