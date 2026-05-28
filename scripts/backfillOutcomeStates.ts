/**
 * scripts/backfillOutcomeStates.ts
 *
 * One-shot (idempotent) backfill of `meals.outcome_state` using the
 * `state` field returned by `lifecycleFor` — the same function that
 * drives the "pending / provisional / final" lifecycle pill in the
 * entries page and the CSV export.
 *
 * Why this exists
 * ---------------
 * `scripts/backfillMealEvaluations.ts` re-ran `lifecycleFor` over every
 * historical meal and rewrote `evaluation`, but it did NOT write the
 * lifecycle's `state` field back into `meals.outcome_state`.  That column
 * is read directly from the DB by the entries page (via `lib/meals.ts`
 * `FULL_COLS`) and `lib/export.ts`, so the status pill and the CSV export
 * can show a stale or null state even after the evaluation backfill ran.
 *
 * This script does the second pass: for every meal row it computes
 * `lifecycleFor(row, new Date(), settings).state` and writes it back
 * when the DB value differs.  Re-running is safe (the UPDATE is skipped
 * when old === new).
 *
 * What it does
 * ------------
 *  1. Pages through every row in `meals` (service-role, bypasses RLS).
 *  2. Fetches each user's personal insulin settings from `user_settings`
 *     once and caches them (mirrors `backfillMealEvaluations.ts`).
 *  3. Calls `lifecycleFor(row, new Date(), settings)` and reads `.state`.
 *  4. Issues an UPDATE only when `outcome_state` differs from the
 *     computed state (idempotent: re-running is a no-op once all rows
 *     are correct).
 *  5. Prints a per-bucket diff matrix at the end
 *     (pending ↔ provisional ↔ final ↔ null) so the operator can verify
 *     the impact.
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  npx tsx \
 *     scripts/backfillOutcomeStates.ts [--dry-run]
 *
 *   --dry-run   Compute the diff matrix without issuing any UPDATEs.
 *
 * npm shortcut
 * ------------
 *   pnpm backfill:outcome-states           # live run
 *   pnpm backfill:outcome-states -- --dry-run
 */

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { lifecycleFor, type OutcomeState } from "@/lib/engine/lifecycle";
import {
  DEFAULT_INSULIN_SETTINGS,
  type InsulinSettings,
} from "@/lib/userSettings";
import type { Meal } from "@/lib/meals";

const PAGE_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry-run");

type StateKey = OutcomeState | "(null)";
const NULL_KEY: StateKey = "(null)";

function bucketOf(v: string | null | undefined): StateKey {
  if (v == null || v === "") return NULL_KEY;
  return v as StateKey;
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
  const diff: Map<StateKey, Map<StateKey, number>> = new Map();
  const bump = (oldB: StateKey, newB: StateKey) => {
    let row = diff.get(oldB);
    if (!row) { row = new Map(); diff.set(oldB, row); }
    row.set(newB, (row.get(newB) ?? 0) + 1);
  };

  let scanned   = 0;
  let attempted = 0; // rows whose outcome_state differs from freshly-computed state
  let applied   = 0; // UPDATEs that actually succeeded (== attempted in --dry-run)
  let errors    = 0;
  let from      = 0;

  console.log(
    `[backfill:outcome-states] starting${DRY_RUN ? " (DRY RUN — no writes)" : ""} — page size ${PAGE_SIZE}`,
  );

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error } = await admin
      .from("meals")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.error(
        `[backfill:outcome-states] page fetch failed at offset ${from}:`,
        error.message,
      );
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const raw of rows) {
      const m = raw as unknown as Meal;
      scanned++;
      const oldBucket = bucketOf(m.outcome_state);

      let newState: OutcomeState;
      try {
        const settings = await loadSettingsFor(admin, m.user_id, settingsCache);
        const lc = lifecycleFor(m, new Date(), settings);
        newState = lc.state;
      } catch (e) {
        errors++;
        console.error(
          `[backfill:outcome-states] lifecycleFor failed for meal ${m.id}:`,
          (e as Error).message,
        );
        continue;
      }

      const newBucket = bucketOf(newState);
      bump(oldBucket, newBucket);

      // Strict equality: null/"" in DB both become NULL_KEY above but we
      // compare against the raw DB value so that legacy empty-string rows
      // get normalised to a real state string on the first run.
      const currentRaw = (m.outcome_state ?? null) as string | null;
      if (currentRaw === newState) continue;
      attempted++;

      if (DRY_RUN) {
        applied++;
        continue;
      }

      const { error: updErr } = await admin
        .from("meals")
        .update({ outcome_state: newState })
        .eq("id", m.id);

      if (updErr) {
        errors++;
        console.error(
          `[backfill:outcome-states] update failed for meal ${m.id}:`,
          updErr.message,
        );
        continue;
      }
      applied++;
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    console.log(`[backfill:outcome-states] scanned ${scanned} rows so far…`);
  }

  // Render diff matrix.
  const ORDER: StateKey[] = ["pending", "provisional", "final", NULL_KEY];
  const allBuckets = new Set<StateKey>();
  for (const [oldB, row] of diff) {
    allBuckets.add(oldB);
    for (const newB of row.keys()) allBuckets.add(newB);
  }
  const sorted = [...allBuckets].sort((a, b) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const colW = Math.max(12, ...sorted.map((b) => b.length + 2));
  const pad = (s: string) => s.padStart(colW);

  console.log("");
  console.log(`[backfill:outcome-states] ── per-state diff (rows: old → new) ──`);
  console.log(["old\\new".padStart(colW), ...sorted.map(pad)].join(""));
  for (const oldB of sorted) {
    const row = diff.get(oldB);
    const cells = sorted.map((newB) => pad(String(row?.get(newB) ?? 0)));
    console.log([pad(oldB), ...cells].join(""));
  }

  console.log("");
  console.log(
    `[backfill:outcome-states] done — scanned ${scanned}, attempted ${attempted}, applied ${applied}, errors ${errors}` +
      (DRY_RUN ? " (DRY RUN — no rows were written)" : ""),
  );
}

main().catch((e) => {
  console.error("[backfill:outcome-states] fatal:", e);
  process.exit(1);
});
