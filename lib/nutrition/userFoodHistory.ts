import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutritionItem, NutritionPer100 } from "./types";

/**
 * Per-user food memory — Phase B of the nutrition pipeline.
 *
 * Sits BEFORE the OpenFoodFacts/USDA/GPT cascade in aggregate.ts:
 *   1. lookupUserFoodHistory(...)  → if hit, skip the rest entirely
 *   2. OFF / USDA / GPT  → unchanged
 *
 * Writes happen in two places:
 *   * saveMeal() — every successful insert records each item with
 *     source='history'. Repeat occurrences blend in via a weighted
 *     running average so a typo or one-off oversize portion can't
 *     dominate the cache.
 *   * /api/chat-macros — when the user corrects a meal mid-chat,
 *     each refined item is stored with source='user_confirmed' and
 *     last-wins semantics. user_confirmed rows are "sticky" — a
 *     later 'history' upsert only bumps the occurrence counter and
 *     last_seen_at, never overwriting the corrected values.
 *
 * Safety contract (T1D dosing): rows are scoped per (user_id,
 * normalized_name) and RLS-protected. We REFUSE to emit zero macros
 * (the lookup returns null instead) so the all-zero guard in the
 * downstream evaluator can't be bypassed by a corrupted history row.
 */

export interface UserFoodHistoryRow {
  id: string;
  user_id: string;
  normalized_name: string;
  display_name: string;
  typical_grams: number;
  carbs_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  source: "history" | "user_confirmed";
  occurrences: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface UserFoodHistoryHit {
  per100: NutritionPer100;
  typicalGrams: number;
  source: "history" | "user_confirmed";
  displayName: string;
  occurrences: number;
}

const TABLE = "user_food_history";

/**
 * Same normalisation as the OFF/USDA cache (lib/nutrition/cache.ts)
 * plus a singular-plural stem so "Banane" / "Bananen" hit the same
 * row. Stem only when the word is ≥ 4 chars to avoid mangling short
 * names ("eis" → "ei"). We do NOT strip diacritics on purpose —
 * "Müsli" and "Muesli" SHOULD map to different rows because the
 * underlying products are different.
 */
export function normalizeFoodName(name: string): string {
  const base = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!base) return "";
  // Strip trailing 's' / 'n' (DE plural marker) when long enough.
  if (base.length >= 5 && base.endsWith("en")) return base.slice(0, -2);
  if (base.length >= 4 && (base.endsWith("s") || base.endsWith("n"))) {
    return base.slice(0, -1);
  }
  return base;
}

/**
 * Read-side: fetch a batch of history rows for the given names so
 * the aggregator can look up every parsed item in ONE query. Returns
 * a map keyed by normalized name. Names with no row are simply
 * absent from the map.
 */
export async function lookupUserFoodHistory(
  sb: SupabaseClient,
  userId: string,
  names: string[],
): Promise<Map<string, UserFoodHistoryHit>> {
  const out = new Map<string, UserFoodHistoryHit>();
  if (!userId || names.length === 0) return out;
  const keys = Array.from(
    new Set(names.map(normalizeFoodName).filter((k) => k.length > 0)),
  );
  if (keys.length === 0) return out;

  const { data, error } = await sb
    .from(TABLE)
    .select(
      "normalized_name, display_name, typical_grams, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g, source, occurrences",
    )
    .eq("user_id", userId)
    .in("normalized_name", keys);
  if (error) {
    // Missing table (migration not yet applied) or RLS denial — treat
    // as a cold cache. The pipeline then falls through to OFF/USDA/GPT
    // so nothing breaks for users on an unmigrated environment.
    return out;
  }
  for (const r of (data ?? []) as UserFoodHistoryRow[]) {
    const carbs   = Number(r.carbs_per_100g);
    const protein = Number(r.protein_per_100g);
    const fat     = Number(r.fat_per_100g);
    const fiber   = Number(r.fiber_per_100g) || 0;
    // Safety guard: refuse all-zero rows. Falling through to OFF/USDA
    // is strictly safer than handing the dose engine silent zeros.
    if (carbs + protein + fat <= 0) continue;
    const grams = Number(r.typical_grams);
    if (!(grams > 0)) continue;
    out.set(r.normalized_name, {
      per100: { carbs_g: carbs, protein_g: protein, fat_g: fat, fiber_g: fiber },
      typicalGrams: grams,
      source: r.source,
      displayName: r.display_name,
      occurrences: r.occurrences,
    });
  }
  return out;
}

/**
 * Convert a scaled NutritionItem (post-aggregate) back to per-100g
 * values so we can blend it into the cache. Returns null when the
 * item lacks the information to do so safely.
 */
function toPer100(item: NutritionItem): NutritionPer100 | null {
  if (!(item.grams > 0)) return null;
  const carbs = (item.carbs   ?? 0) * 100 / item.grams;
  const prot  = (item.protein ?? 0) * 100 / item.grams;
  const fat   = (item.fat     ?? 0) * 100 / item.grams;
  const fib   = (item.fiber   ?? 0) * 100 / item.grams;
  // Outlier filter: a real food has SOME macros per 100g. Items with
  // source='unknown' carry all-zero macros and must NOT pollute the
  // cache (would later short-circuit the OFF/USDA path with zeros).
  if (carbs + prot + fat <= 0) return null;
  // Sanity cap: per-100g over 100g of any single macro is impossible.
  // Clamp rather than reject so a rounding overflow (e.g. 100.4) still
  // records, but anything wildly out of range (oversize portion + tiny
  // grams typo) is rejected outright.
  if (carbs > 105 || prot > 105 || fat > 105) return null;
  return {
    carbs_g:   Math.min(100, Math.max(0, carbs)),
    protein_g: Math.min(100, Math.max(0, prot)),
    fat_g:     Math.min(100, Math.max(0, fat)),
    fiber_g:   Math.min(100, Math.max(0, fib)),
  };
}

export interface RecordItemsOptions {
  /**
   * 'history' = passive auto-record from saveMeal. Blends via running
   *             weighted average. Will NEVER overwrite an existing
   *             user_confirmed row's values (only bumps occurrence
   *             counter + last_seen_at).
   * 'user_confirmed' = explicit chat-macros correction. Last-wins:
   *             overwrites whatever was there and flips the source
   *             flag so future passive records can't downgrade it.
   */
  source: "history" | "user_confirmed";
}

/**
 * Write-side: upsert a batch of items into the user's history. Skips
 * items whose macros can't be safely converted to per-100g (zero
 * grams, all-zero macros, impossible densities).
 *
 * Best-effort: never throws. Callers wrap their own try/catch but
 * we also swallow inside so a transient DB hiccup can't fail a meal
 * save. The pipeline's correctness does NOT depend on the history
 * being current.
 */
export async function recordItemsToHistory(
  sb: SupabaseClient,
  userId: string,
  items: NutritionItem[],
  opts: RecordItemsOptions,
): Promise<void> {
  if (!userId || items.length === 0) return;

  // 1. Reduce to one (name, per100, grams) candidate per normalized
  //    name within this batch (if the user logs "Banane + Banane" in
  //    one meal we want a single upsert, not a self-cancelling pair).
  const candidates = new Map<string, {
    displayName: string;
    per100: NutritionPer100;
    grams: number;
  }>();
  for (const it of items) {
    const key = normalizeFoodName(it.name);
    if (!key) continue;
    const per100 = toPer100(it);
    if (!per100) continue;
    if (it.source === "unknown") continue; // refuse to learn from unknowns
    const existing = candidates.get(key);
    if (existing) {
      // Average within the batch so identical-name dupes don't double-
      // count toward the running average that's about to land in DB.
      existing.per100 = {
        carbs_g:   (existing.per100.carbs_g   + per100.carbs_g)   / 2,
        protein_g: (existing.per100.protein_g + per100.protein_g) / 2,
        fat_g:     (existing.per100.fat_g     + per100.fat_g)     / 2,
        fiber_g:   (existing.per100.fiber_g   + per100.fiber_g)   / 2,
      };
      existing.grams = (existing.grams + it.grams) / 2;
    } else {
      candidates.set(key, {
        displayName: it.name,
        per100,
        grams: it.grams,
      });
    }
  }
  if (candidates.size === 0) return;

  const keys = Array.from(candidates.keys());

  try {
    // 2. Read current rows so we can compute the merged values
    //    client-side. Could be done in PL/pgSQL but JS-side keeps the
    //    blending logic in one place + unit-testable.
    const { data: existingRows, error: readErr } = await sb
      .from(TABLE)
      .select(
        // display_name MUST be in this list — both the sticky and
        // history-blend branches below write `display_name: prev.display_name`
        // into the upsert payload, and the column is NOT NULL in the
        // migration. Omitting it here would silently break every
        // repeat-occurrence write (caught by the `catch {}` and never
        // surfaced), defeating the whole "learning over time" goal.
        "id, normalized_name, display_name, typical_grams, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g, source, occurrences",
      )
      .eq("user_id", userId)
      .in("normalized_name", keys);
    if (readErr) return; // table missing or RLS — skip silently
    const byKey = new Map<string, UserFoodHistoryRow>();
    for (const r of (existingRows ?? []) as UserFoodHistoryRow[]) {
      byKey.set(r.normalized_name, r);
    }

    const now = new Date().toISOString();
    const upserts: Array<Record<string, unknown>> = [];
    for (const [key, c] of candidates) {
      const prev = byKey.get(key);
      if (!prev) {
        // Brand new row.
        upserts.push({
          user_id:          userId,
          normalized_name:  key,
          display_name:     c.displayName,
          typical_grams:    round2(c.grams),
          carbs_per_100g:   round2(c.per100.carbs_g),
          protein_per_100g: round2(c.per100.protein_g),
          fat_per_100g:     round2(c.per100.fat_g),
          fiber_per_100g:   round2(c.per100.fiber_g),
          source:           opts.source,
          occurrences:      1,
          created_at:       now,
          updated_at:       now,
          last_seen_at:     now,
        });
        continue;
      }

      // user_confirmed is sticky vs passive history writes.
      if (prev.source === "user_confirmed" && opts.source === "history") {
        upserts.push({
          user_id:          userId,
          normalized_name:  key,
          // Preserve every value field. Only bump counters/timestamps.
          display_name:     prev.display_name,
          typical_grams:    prev.typical_grams,
          carbs_per_100g:   prev.carbs_per_100g,
          protein_per_100g: prev.protein_per_100g,
          fat_per_100g:     prev.fat_per_100g,
          fiber_per_100g:   prev.fiber_per_100g,
          source:           "user_confirmed",
          occurrences:      prev.occurrences + 1,
          updated_at:       now,
          last_seen_at:     now,
        });
        continue;
      }

      // user_confirmed incoming → overwrite.
      if (opts.source === "user_confirmed") {
        upserts.push({
          user_id:          userId,
          normalized_name:  key,
          display_name:     c.displayName,
          typical_grams:    round2(c.grams),
          carbs_per_100g:   round2(c.per100.carbs_g),
          protein_per_100g: round2(c.per100.protein_g),
          fat_per_100g:     round2(c.per100.fat_g),
          fiber_per_100g:   round2(c.per100.fiber_g),
          source:           "user_confirmed",
          occurrences:      prev.occurrences + 1,
          updated_at:       now,
          last_seen_at:     now,
        });
        continue;
      }

      // history + existing history → weighted running average.
      // Cap occurrences in the denominator at 20 so the cache stays
      // responsive to genuine behaviour changes (new recipe, new
      // brand). Without a cap the row freezes after ~50 samples.
      const n = Math.min(prev.occurrences, 20);
      const blend = (oldVal: number, newVal: number) =>
        round2((Number(oldVal) * n + newVal) / (n + 1));
      upserts.push({
        user_id:          userId,
        normalized_name:  key,
        display_name:     prev.display_name,
        typical_grams:    blend(prev.typical_grams,    c.grams),
        carbs_per_100g:   blend(prev.carbs_per_100g,   c.per100.carbs_g),
        protein_per_100g: blend(prev.protein_per_100g, c.per100.protein_g),
        fat_per_100g:     blend(prev.fat_per_100g,     c.per100.fat_g),
        fiber_per_100g:   blend(prev.fiber_per_100g,   c.per100.fiber_g),
        source:           "history",
        occurrences:      prev.occurrences + 1,
        updated_at:       now,
        last_seen_at:     now,
      });
    }

    if (upserts.length === 0) return;
    await sb
      .from(TABLE)
      .upsert(upserts, { onConflict: "user_id,normalized_name" });
  } catch {
    // Silent — see contract in JSDoc above.
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
