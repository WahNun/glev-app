/**
 * scripts/backfillCurveJobs.ts
 *
 * One-shot (idempotent) backfill that enqueues `bolus_curve_180` and
 * `exercise_curve_180` CGM jobs for every historical log whose 3-hour
 * post-anchor window is already in the past.
 *
 * Why this exists
 * ---------------
 * Task #194 introduced dense 0–180 min CGM curves for bolus and exercise
 * logs, but the self-healing backfill in `backfillBolusCurveJobs` /
 * `backfillExerciseCurveJobs` (called on every /api/cgm-jobs/process tick)
 * only covers the last 24 h. Logs older than 24 h from before the feature
 * shipped will never get the curve or the derived aggregates
 * (min_bg_180, max_bg_180, auc_180, had_hypo_window, etc.).
 * This one-shot script walks the full history and enqueues the missing jobs.
 *
 * What it does
 * ------------
 *  1. Pages through ALL rows in `insulin_logs` (bolus only) and
 *     `exercise_logs`, using the service-role client (bypasses RLS).
 *  2. For each log, computes the window anchor:
 *       bolus    → created_at
 *       exercise → created_at + duration_minutes
 *     and the expected fetch_time (anchor + 180 min).
 *  3. Skips logs whose fetch_time is still in the future (window not done).
 *  4. Skips logs that already have samples in the matching parallel table
 *     (`bolus_glucose_samples` / `exercise_glucose_samples`) — the curve is
 *     already populated, nothing to do.
 *  5. Skips logs that already have a `cgm_fetch_jobs` row for the matching
 *     fetch_type — a job is already in flight or has been processed.
 *  6. Inserts a new `cgm_fetch_jobs` row (status = pending) for every
 *     remaining log. The existing /api/cgm-jobs/process worker will pick
 *     these up on the next tick and resolve them via CGM history.
 *
 * Idempotency
 * -----------
 * Safe to re-run. Checks both the parallel-table samples (step 4) and the
 * jobs table (step 5) before inserting. Duplicate jobs are never created.
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  npx tsx \
 *     scripts/backfillCurveJobs.ts [--dry-run]
 *
 *   --dry-run   Print what would be inserted without writing anything.
 */

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PAGE_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry-run");
const nowMs = Date.now();

// ── helpers ──────────────────────────────────────────────────────────────────

function parseIso(s: string): number {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp: ${s}`);
  return ms;
}

/**
 * Return the IDs of rows in `table` that have at least one entry in the
 * given parallel samples table keyed by `fkCol`.
 */
async function idsWithSamples(
  admin: ReturnType<typeof getSupabaseAdmin>,
  samplesTable: string,
  fkCol: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from(samplesTable)
    .select(fkCol)
    .in(fkCol, ids);
  if (error) {
    console.warn(`[backfill] ${samplesTable} sample check failed:`, error.message);
    return new Set();
  }
  return new Set((data as Record<string, string>[]).map((r) => r[fkCol]));
}

/**
 * Return the log IDs that already have a `cgm_fetch_jobs` row for the
 * given fetch_type (status = any — pending/fetched/skipped all count).
 */
async function idsWithJob(
  admin: ReturnType<typeof getSupabaseAdmin>,
  fetchType: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("cgm_fetch_jobs")
    .select("log_id")
    .eq("fetch_type", fetchType)
    .in("log_id", ids);
  if (error) {
    console.warn(`[backfill] cgm_fetch_jobs check failed for ${fetchType}:`, error.message);
    return new Set();
  }
  return new Set((data as { log_id: string }[]).map((r) => r.log_id));
}

// ── bolus backfill ────────────────────────────────────────────────────────────

async function backfillBolus(admin: ReturnType<typeof getSupabaseAdmin>): Promise<{
  scanned: number;
  alreadyDone: number;
  enqueued: number;
  errors: number;
}> {
  let scanned = 0, alreadyDone = 0, enqueued = 0, errors = 0, from = 0;

  console.log("[backfill:bolus] starting…");

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error } = await admin
      .from("insulin_logs")
      .select("id, user_id, created_at, insulin_type")
      .eq("insulin_type", "bolus")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`[backfill:bolus] page fetch failed at offset ${from}:`, error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    // Only process logs whose 180-min window is fully in the past.
    type BolusRow = { id: string; user_id: string; created_at: string; insulin_type: string };
    const eligible = (rows as BolusRow[]).filter((r) => {
      try {
        return parseIso(r.created_at) + 180 * 60_000 <= nowMs;
      } catch {
        return false;
      }
    });
    scanned += eligible.length;

    const ids = eligible.map((r) => r.id);

    // Skip logs that already have samples or an existing job.
    const [haveSamples, haveJob] = await Promise.all([
      idsWithSamples(admin, "bolus_glucose_samples", "log_id", ids),
      idsWithJob(admin, "bolus_curve_180", ids),
    ]);

    const toInsert = eligible.filter((r) => {
      if (haveSamples.has(r.id) || haveJob.has(r.id)) {
        alreadyDone++;
        return false;
      }
      return true;
    });

    if (toInsert.length > 0) {
      const inserts = toInsert.map((r) => ({
        user_id:    r.user_id,
        log_id:     r.id,
        log_type:   "bolus" as const,
        fetch_type: "bolus_curve_180" as const,
        fetch_time: new Date(parseIso(r.created_at) + 180 * 60_000).toISOString(),
        status:     "pending" as const,
      }));

      if (!DRY_RUN) {
        const { error: insErr } = await admin.from("cgm_fetch_jobs").insert(inserts);
        if (insErr) {
          console.error(`[backfill:bolus] insert failed:`, insErr.message);
          errors += toInsert.length;
        } else {
          enqueued += toInsert.length;
        }
      } else {
        enqueued += toInsert.length;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    console.log(`[backfill:bolus] scanned ${scanned} eligible rows so far…`);
  }

  return { scanned, alreadyDone, enqueued, errors };
}

// ── exercise backfill ─────────────────────────────────────────────────────────

async function backfillExercise(admin: ReturnType<typeof getSupabaseAdmin>): Promise<{
  scanned: number;
  alreadyDone: number;
  enqueued: number;
  errors: number;
}> {
  let scanned = 0, alreadyDone = 0, enqueued = 0, errors = 0, from = 0;

  console.log("[backfill:exercise] starting…");

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error } = await admin
      .from("exercise_logs")
      .select("id, user_id, created_at, duration_minutes")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`[backfill:exercise] page fetch failed at offset ${from}:`, error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    type ExRow = { id: string; user_id: string; created_at: string; duration_minutes: number | null };
    const eligible = (rows as ExRow[]).filter((r) => {
      try {
        const start = parseIso(r.created_at);
        const dur = Number(r.duration_minutes ?? 0);
        const end = start + (Number.isFinite(dur) ? dur : 0) * 60_000;
        return end + 180 * 60_000 <= nowMs;
      } catch {
        return false;
      }
    });
    scanned += eligible.length;

    const ids = eligible.map((r) => r.id);

    const [haveSamples, haveJob] = await Promise.all([
      idsWithSamples(admin, "exercise_glucose_samples", "log_id", ids),
      idsWithJob(admin, "exercise_curve_180", ids),
    ]);

    const toInsert = eligible.filter((r) => {
      if (haveSamples.has(r.id) || haveJob.has(r.id)) {
        alreadyDone++;
        return false;
      }
      return true;
    });

    if (toInsert.length > 0) {
      const inserts = toInsert.map((r) => {
        const start = parseIso(r.created_at);
        const dur = Number(r.duration_minutes ?? 0);
        const end = start + (Number.isFinite(dur) ? dur : 0) * 60_000;
        return {
          user_id:    r.user_id,
          log_id:     r.id,
          log_type:   "exercise" as const,
          fetch_type: "exercise_curve_180" as const,
          fetch_time: new Date(end + 180 * 60_000).toISOString(),
          status:     "pending" as const,
        };
      });

      if (!DRY_RUN) {
        const { error: insErr } = await admin.from("cgm_fetch_jobs").insert(inserts);
        if (insErr) {
          console.error(`[backfill:exercise] insert failed:`, insErr.message);
          errors += toInsert.length;
        } else {
          enqueued += toInsert.length;
        }
      } else {
        enqueued += toInsert.length;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    console.log(`[backfill:exercise] scanned ${scanned} eligible rows so far…`);
  }

  return { scanned, alreadyDone, enqueued, errors };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[backfill] CGM curve job backfill starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  );
  console.log(`[backfill] now = ${new Date(nowMs).toISOString()}\n`);

  const admin = getSupabaseAdmin();

  const [bolusResult, exerciseResult] = await Promise.all([
    backfillBolus(admin),
    backfillExercise(admin),
  ]);

  const total = {
    scanned:    bolusResult.scanned    + exerciseResult.scanned,
    alreadyDone: bolusResult.alreadyDone + exerciseResult.alreadyDone,
    enqueued:   bolusResult.enqueued   + exerciseResult.enqueued,
    errors:     bolusResult.errors     + exerciseResult.errors,
  };

  console.log("");
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log("│              CGM curve backfill summary              │");
  console.log("├───────────────────┬──────────┬──────────┬────────────┤");
  console.log("│ type              │ bolus    │ exercise │ total      │");
  console.log("├───────────────────┼──────────┼──────────┼────────────┤");
  console.log(`│ eligible scanned  │ ${String(bolusResult.scanned).padEnd(8)} │ ${String(exerciseResult.scanned).padEnd(8)} │ ${String(total.scanned).padEnd(10)} │`);
  console.log(`│ already done      │ ${String(bolusResult.alreadyDone).padEnd(8)} │ ${String(exerciseResult.alreadyDone).padEnd(8)} │ ${String(total.alreadyDone).padEnd(10)} │`);
  console.log(`│ jobs enqueued     │ ${String(bolusResult.enqueued).padEnd(8)} │ ${String(exerciseResult.enqueued).padEnd(8)} │ ${String(total.enqueued).padEnd(10)} │`);
  console.log(`│ errors            │ ${String(bolusResult.errors).padEnd(8)} │ ${String(exerciseResult.errors).padEnd(8)} │ ${String(total.errors).padEnd(10)} │`);
  console.log("└───────────────────┴──────────┴──────────┴────────────┘");
  console.log("");
  if (DRY_RUN) {
    console.log("[backfill] DRY RUN complete — no rows were written.");
  } else {
    console.log(
      `[backfill] done — ${total.enqueued} job(s) enqueued. The /api/cgm-jobs/process worker`,
    );
    console.log(
      "           will resolve them on the next CGM sync tick per user.",
    );
  }

  if (total.errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
