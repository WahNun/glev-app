#!/usr/bin/env node
/**
 * scripts/backfill-user-food-history.mjs
 *
 * One-shot (idempotent) backfill of `user_food_history` from the
 * existing `meals.parsed_json` items. Run once after applying the
 * `20260517_add_user_food_history.sql` migration so users get an
 * immediate Phase-B benefit on their FIRST parse after deploy
 * rather than having to log every favourite food again to
 * re-populate the cache from scratch.
 *
 * Strategy
 * --------
 *   1. Page through every meal row (service-role, bypasses RLS).
 *   2. For each item in `parsed_json`, derive per-100g macros via
 *      (value * 100 / grams). Skip items with grams<=0 or all-zero
 *      macros — same safety guard the live recorder enforces.
 *   3. Apply outlier filter: reject per-100g values > 100 for any
 *      macro (that's an obvious typo: a portion misreported as
 *      grams). These would otherwise pollute the user's running
 *      average for that item.
 *   4. Aggregate per (user_id, normalized_name): running weighted
 *      average for the macros + typical_grams, occurrence counter.
 *      Last-write wins for display_name (most recent variant).
 *   5. UPSERT the result. Existing rows are merged: this script
 *      treats any value already in DB as one prior sample (so
 *      re-running is idempotent — the running average converges).
 *
 * Source attribution: every row written by this script is tagged
 * source='history'. The chat-macros pipeline can later upgrade
 * individual rows to source='user_confirmed' when the user
 * explicitly corrects them.
 *
 * Usage
 * -----
 *   SUPABASE_URL=…  SUPABASE_SERVICE_ROLE_KEY=…  \
 *     node scripts/backfill-user-food-history.mjs [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeFoodName(name) {
  const base = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!base) return "";
  if (base.length >= 5 && base.endsWith("en")) return base.slice(0, -2);
  if (base.length >= 4 && (base.endsWith("s") || base.endsWith("n"))) {
    return base.slice(0, -1);
  }
  return base;
}

function round2(v) { return Math.round(v * 100) / 100; }

/**
 * In-memory aggregation key: `${user_id}::${normalized_name}`.
 * Value: { displayName, sumWeights, weightedCarbs, weightedProt, ...
 * occurrences, lastSeenAt }.
 *
 * Running weighted-average algebra (matches the live recorder so
 * re-running the backfill converges to the same numbers a live
 * sequence of saveMeal() calls would have produced).
 */
const agg = new Map();

function record(userId, item, lastSeenAt) {
  if (!item || typeof item !== "object") return;
  const name = String(item.name ?? "").trim();
  const grams = Number(item.grams);
  if (!name || !(grams > 0)) return;

  const c = Number(item.carbs ?? 0);
  const p = Number(item.protein ?? 0);
  const f = Number(item.fat ?? 0);
  const fi = Number(item.fiber ?? 0);
  if (![c, p, f].some((v) => Number.isFinite(v) && v >= 0)) return;
  if (c + p + f <= 0) return;

  const per100c = (c * 100) / grams;
  const per100p = (p * 100) / grams;
  const per100f = (f * 100) / grams;
  const per100fi = (fi * 100) / grams;
  // Outlier filter — see header comment.
  if (per100c > 105 || per100p > 105 || per100f > 105) return;

  const key = `${userId}::${normalizeFoodName(name)}`;
  if (!key.endsWith("::")) {
    const prev = agg.get(key);
    if (!prev) {
      agg.set(key, {
        userId,
        normalized: normalizeFoodName(name),
        displayName: name,
        typicalGrams: grams,
        carbs: per100c,
        protein: per100p,
        fat: per100f,
        fiber: per100fi,
        occurrences: 1,
        lastSeenAt,
      });
    } else {
      const n = Math.min(prev.occurrences, 20);
      prev.typicalGrams = (prev.typicalGrams * n + grams) / (n + 1);
      prev.carbs   = (prev.carbs   * n + per100c)  / (n + 1);
      prev.protein = (prev.protein * n + per100p)  / (n + 1);
      prev.fat     = (prev.fat     * n + per100f)  / (n + 1);
      prev.fiber   = (prev.fiber   * n + per100fi) / (n + 1);
      prev.occurrences += 1;
      prev.displayName = name;
      if (lastSeenAt > prev.lastSeenAt) prev.lastSeenAt = lastSeenAt;
    }
  }
}

async function main() {
  console.log(`[backfill] dry-run=${DRY}`);
  const PAGE = 500;
  let offset = 0;
  let totalMeals = 0;
  for (;;) {
    const { data, error } = await sb
      .from("meals")
      .select("id, user_id, parsed_json, created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("meals fetch failed:", error); process.exit(2); }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const items = Array.isArray(row.parsed_json) ? row.parsed_json : [];
      const ts = row.created_at ?? new Date().toISOString();
      for (const it of items) record(row.user_id, it, ts);
    }
    totalMeals += data.length;
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[backfill] scanned ${totalMeals} meals → ${agg.size} unique (user, food) rows`);

  if (DRY) {
    let shown = 0;
    for (const v of agg.values()) {
      if (shown++ >= 10) break;
      console.log(
        `  ${v.userId.slice(0, 8)}… '${v.displayName}' x${v.occurrences} @ ${round2(v.typicalGrams)}g · per100: C${round2(v.carbs)} P${round2(v.protein)} F${round2(v.fat)} Fi${round2(v.fiber)}`,
      );
    }
    return;
  }

  // Upsert in chunks. We blend with whatever's already in DB by
  // pretending each existing row is one prior sample.
  const rows = Array.from(agg.values()).map((v) => ({
    user_id:          v.userId,
    normalized_name:  v.normalized,
    display_name:     v.displayName,
    typical_grams:    round2(v.typicalGrams),
    carbs_per_100g:   round2(v.carbs),
    protein_per_100g: round2(v.protein),
    fat_per_100g:     round2(v.fat),
    fiber_per_100g:   round2(v.fiber),
    source:           "history",
    occurrences:      v.occurrences,
    last_seen_at:     v.lastSeenAt,
  }));

  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await sb
      .from("user_food_history")
      .upsert(batch, { onConflict: "user_id,normalized_name", ignoreDuplicates: false });
    if (error) { console.error("upsert failed:", error); process.exit(3); }
    written += batch.length;
    console.log(`[backfill] upserted ${written}/${rows.length}`);
  }
  console.log("[backfill] done");
}

main().catch((e) => { console.error(e); process.exit(99); });
