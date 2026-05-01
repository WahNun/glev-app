/**
 * scripts/backfillMealEvaluations.ts
 *
 * One-shot (idempotent) backfill of `meals.evaluation` using the
 * unified `lifecycleFor` engine introduced in Task #15.
 *
 * Why this exists
 * ---------------
 * Task #15 changed how meal outcomes are decided (the unified
 * `lifecycleFor` engine in `lib/engine/lifecycle.ts`), but per the
 * original spec only newly-written or recomputed-on-read rows use the
 * new path. Historical rows in the `meals` table keep whatever
 * `evaluation` value they had — so the Dashboard's Control Score /
 * Good Rate / Spike Rate / Hypo Rate continue to show pre-refactor
 * numbers for older entries (including the legacy "GOOD" defaults
 * that the import path used to invent).
 *
 * What it does
 * ------------
 *  1. Pages through every row in `meals` (service-role, bypasses RLS).
 *  2. Fetches each user's personal insulin settings from the
 *     `user_settings` table once and caches them — falling back to
 *     `DEFAULT_INSULIN_SETTINGS` when the row is absent — so the
 *     no-bgAfter ICR-ratio fallback uses the user's real ratios
 *     (mirroring the async writeback paths in lib/meals).
 *  3. Calls `lifecycleFor(row, new Date(), settings)` exactly as the
 *     UI does on read.
 *  4. Writes `evaluation = lc.outcome` when `state === "final"`,
 *     else `evaluation = null`. Only issues an UPDATE when the value
 *     actually changes (idempotent: re-running is a no-op).
 *  5. Prints a per-bucket diff matrix at the end (old → new) so the
 *     user can verify the refactor's impact.
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  npx tsx \
 *     scripts/backfillMealEvaluations.ts [--dry-run]
 *
 *   --dry-run   Compute the diff matrix without issuing any UPDATEs.
 */

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { lifecycleFor } from "@/lib/engine/lifecycle";
import {
  DEFAULT_INSULIN_SETTINGS,
  type InsulinSettings,
} from "@/lib/userSettings";
import type { Meal } from "@/lib/meals";

const PAGE_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry-run");

type EvalKey = string; // "GOOD" | "SPIKE" | ... | "(null)" — incl. unknown legacy values
const NULL_KEY: EvalKey = "(null)";

function bucketOf(v: string | null | undefined): EvalKey {
  if (v == null || v === "") return NULL_KEY;
  return v;
}

async function loadSettingsFor(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  cache: Map<string, InsulinSettings>,
): Promise<InsulinSettings> {
  const cached = cache.get(userId);
  if (cached) return cached;

  const { data, error } = await admin
    .from("user_settings")
    .select("icr_g_per_unit, cf_mgdl_per_unit, target_bg_mgdl")
    .eq("user_id", userId)
    .maybeSingle();

  let settings: InsulinSettings = { ...DEFAULT_INSULIN_SETTINGS };
  if (!error && data) {
    const isPos = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n > 0;
    if (isPos(data.icr_g_per_unit))   settings.icr      = data.icr_g_per_unit;
    if (isPos(data.cf_mgdl_per_unit)) settings.cf       = data.cf_mgdl_per_unit;
    if (isPos(data.target_bg_mgdl))   settings.targetBg = data.target_bg_mgdl;
  }
  cache.set(userId, settings);
  return settings;
}

async function main() {
  const admin = getSupabaseAdmin();
  const settingsCache = new Map<string, InsulinSettings>();

  // diff[oldBucket][newBucket] = count
  const diff: Map<EvalKey, Map<EvalKey, number>> = new Map();
  const bump = (oldB: EvalKey, newB: EvalKey) => {
    let row = diff.get(oldB);
    if (!row) { row = new Map(); diff.set(oldB, row); }
    row.set(newB, (row.get(newB) ?? 0) + 1);
  };

  let scanned   = 0;
  let attempted = 0; // rows whose value differs from the freshly-computed one
  let applied   = 0; // UPDATEs that actually succeeded (== attempted in --dry-run)
  let errors    = 0;
  let from      = 0;

  console.log(
    `[backfill] starting${DRY_RUN ? " (DRY RUN — no writes)" : ""} — page size ${PAGE_SIZE}`,
  );

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error } = await admin
      .from("meals")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`[backfill] page fetch failed at offset ${from}:`, error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const raw of rows) {
      const m = raw as unknown as Meal;
      scanned++;
      const oldBucket = bucketOf(m.evaluation);
      let newEval: string | null;
      try {
        const settings = await loadSettingsFor(admin, m.user_id, settingsCache);
        const lc = lifecycleFor(m, new Date(), settings);
        newEval = lc.state === "final" ? (lc.outcome ?? null) : null;
      } catch (e) {
        errors++;
        console.error(
          `[backfill] lifecycleFor failed for meal ${m.id}:`,
          (e as Error).message,
        );
        continue;
      }
      const newBucket = bucketOf(newEval);
      bump(oldBucket, newBucket);

      // Strict equality on the raw DB value (not the bucket) so legacy
      // edge cases like `evaluation = ""` get normalised to SQL NULL
      // instead of being silently treated as "already null".
      const currentRaw = (m.evaluation ?? null) as string | null;
      if (currentRaw === newEval) continue;
      attempted++;

      if (DRY_RUN) {
        applied++;
        continue;
      }
      const { error: updErr } = await admin
        .from("meals")
        .update({ evaluation: newEval })
        .eq("id", m.id);
      if (updErr) {
        errors++;
        console.error(
          `[backfill] update failed for meal ${m.id}:`,
          updErr.message,
        );
        continue;
      }
      applied++;
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    console.log(`[backfill] scanned ${scanned} rows so far…`);
  }

  // Render diff matrix.
  const allBuckets = new Set<EvalKey>();
  for (const [oldB, row] of diff) {
    allBuckets.add(oldB);
    for (const newB of row.keys()) allBuckets.add(newB);
  }
  const sorted = [...allBuckets].sort((a, b) => {
    if (a === NULL_KEY) return 1;
    if (b === NULL_KEY) return -1;
    return a.localeCompare(b);
  });

  const colW = Math.max(12, ...sorted.map((b) => b.length + 2));
  const pad = (s: string) => s.padStart(colW);

  console.log("");
  console.log(`[backfill] ── per-bucket diff (rows: old → new) ──`);
  console.log(["old\\new".padStart(colW), ...sorted.map(pad)].join(""));
  for (const oldB of sorted) {
    const row = diff.get(oldB);
    const cells = sorted.map((newB) => pad(String(row?.get(newB) ?? 0)));
    console.log([pad(oldB), ...cells].join(""));
  }

  console.log("");
  console.log(
    `[backfill] done — scanned ${scanned}, attempted ${attempted}, applied ${applied}, errors ${errors}` +
      (DRY_RUN ? " (DRY RUN — no rows were written)" : ""),
  );
}

main().catch((e) => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
