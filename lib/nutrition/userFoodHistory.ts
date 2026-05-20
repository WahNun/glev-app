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
 * normalized_name, size_modifier) and RLS-protected. We REFUSE to
 * emit zero macros (the lookup returns null instead) so the all-zero
 * guard in the downstream evaluator can't be bypassed by a corrupted
 * history row.
 */

export interface UserFoodHistoryRow {
  id: string;
  user_id: string;
  normalized_name: string;
  display_name: string;
  size_modifier: string | null;
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
  sizeModifier: string | null;
}

const TABLE = "user_food_history";

// ---------------------------------------------------------------------------
// Size modifier and quantity word maps (Phase B: parseFoodName)
// ---------------------------------------------------------------------------

/**
 * Size adjective → multiplier applied to the typical portion.
 * Canonical form (no declension suffix) is the stored `size_modifier` value.
 * Inflected forms (große, kleinen, …) all map to the same canonical key.
 */
export const SIZE_MULTIPLIERS: Record<string, { canonical: string; factor: number }> = {
  // klein / kleine / kleinen / kleiner / kleines → 'klein', ×0.65
  klein:    { canonical: "klein",   factor: 0.65 },
  kleine:   { canonical: "klein",   factor: 0.65 },
  kleinen:  { canonical: "klein",   factor: 0.65 },
  kleiner:  { canonical: "klein",   factor: 0.65 },
  kleines:  { canonical: "klein",   factor: 0.65 },
  // groß / große / großen / großer / großes → 'groß', ×1.35
  groß:     { canonical: "groß",    factor: 1.35 },
  große:    { canonical: "groß",    factor: 1.35 },
  großen:   { canonical: "groß",    factor: 1.35 },
  großer:   { canonical: "groß",    factor: 1.35 },
  großes:   { canonical: "groß",    factor: 1.35 },
  // ASCII variant
  gross:    { canonical: "groß",    factor: 1.35 },
  grosse:   { canonical: "groß",    factor: 1.35 },
  grossen:  { canonical: "groß",    factor: 1.35 },
  grosser:  { canonical: "groß",    factor: 1.35 },
  // mittel / mittlere / mittleren → 'mittel', ×1.0 (no-op, but stored distinctly)
  mittel:   { canonical: "mittel",  factor: 1.0  },
  mittlere: { canonical: "mittel",  factor: 1.0  },
  mittleren:{ canonical: "mittel",  factor: 1.0  },
  mittlerer:{ canonical: "mittel",  factor: 1.0  },
  // halb / halbe / halben → 'halb', ×0.5
  halb:     { canonical: "halb",    factor: 0.5  },
  halbe:    { canonical: "halb",    factor: 0.5  },
  halben:   { canonical: "halb",    factor: 0.5  },
  halber:   { canonical: "halb",    factor: 0.5  },
  halbes:   { canonical: "halb",    factor: 0.5  },
  // doppelt / doppelte / doppelten → 'doppelt', ×2.0
  doppelt:  { canonical: "doppelt", factor: 2.0  },
  doppelte: { canonical: "doppelt", factor: 2.0  },
  doppelten:{ canonical: "doppelt", factor: 2.0  },
  doppelter:{ canonical: "doppelt", factor: 2.0  },
};

/**
 * Quantity word → numeric factor. These fold into `typical_grams` at
 * write time (quantity is not persisted as a separate column).
 * Note: 'halb'/'halbe'/'halben' appear in SIZE_MULTIPLIERS too — the
 * parser checks SIZE_MULTIPLIERS first (position-agnostic adjective),
 * so leading "halb" is treated as a size modifier, NOT a quantity word,
 * and stored as size_modifier='halb'.
 */
export const QUANTITY_WORDS: Record<string, number> = {
  ein:     1,
  eine:    1,
  einen:   1,
  einem:   1,
  zwei:    2,
  drei:    3,
  vier:    4,
  fünf:    5,
  mehrere: 2.5,
  viele:   3,
  paar:    2,
};

export interface ParsedFoodName {
  /** Normalized base name — result of normalizeFoodName(rawBase). */
  foodName: string;
  /**
   * Raw base: remaining tokens after stripping qty+size words, joined
   * with spaces (lowercase but NOT yet run through normalizeFoodName).
   * Pass this as the `name` field to recordItemsToHistory so the
   * internal normalization step does not double-stem the already-
   * stemmed foodName.  e.g. "große Banane" → rawBase="banane",
   * foodName="banan".
   */
  rawBase: string;
  /** Canonical size modifier key, or null if none was detected. */
  sizeModifier: string | null;
  /** Quantity multiplier (default 1 when no quantity token found). */
  quantity: number;
}

/**
 * Tokenize a raw ingredient string and extract:
 *   - a leading integer or QUANTITY_WORD → `quantity`
 *   - a SIZE_MULTIPLIERS adjective (anywhere in the string) → `sizeModifier`
 *   - the remainder → `foodName` (then run through normalizeFoodName)
 *
 * Examples:
 *   "große Banane"         → { foodName:"banan", sizeModifier:"groß",   quantity:1 }
 *   "kleine Banane"        → { foodName:"banan", sizeModifier:"klein",  quantity:1 }
 *   "zwei Bananen"         → { foodName:"banan", sizeModifier:null,     quantity:2 }
 *   "zwei große Bananen"   → { foodName:"banan", sizeModifier:"groß",   quantity:2 }
 *   "halbe Banane"         → { foodName:"banan", sizeModifier:"halb",   quantity:1 }
 *   "Banane"               → { foodName:"banan", sizeModifier:null,     quantity:1 }
 *   "3 Eier"               → { foodName:"ei",    sizeModifier:null,     quantity:3 }
 */
export function parseFoodName(raw: string): ParsedFoodName {
  const tokens = (raw ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { foodName: "", rawBase: "", sizeModifier: null, quantity: 1 };
  }

  let quantity = 1;
  let sizeModifier: string | null = null;
  const remaining: string[] = [];

  let i = 0;

  // 1. Leading numeric literal (e.g. "3 Eier", "1.5 Bananen")
  if (i < tokens.length) {
    const numVal = parseFloat(tokens[i]);
    if (!isNaN(numVal) && numVal > 0) {
      quantity = numVal;
      i++;
    } else {
      // Check QUANTITY_WORDS at the leading position
      const qw = QUANTITY_WORDS[tokens[i]];
      if (qw !== undefined) {
        quantity = qw;
        i++;
      }
    }
  }

  // 2. Scan remaining tokens for a SIZE_MULTIPLIER adjective (anywhere)
  for (; i < tokens.length; i++) {
    const sz = SIZE_MULTIPLIERS[tokens[i]];
    if (sz !== undefined && sizeModifier === null) {
      // Consume this token as the size modifier; do not add to remaining
      sizeModifier = sz.canonical;
    } else {
      remaining.push(tokens[i]);
    }
  }

  const rawBase = remaining.join(" ");
  const foodName = normalizeFoodName(rawBase);
  return { foodName, rawBase, sizeModifier, quantity };
}

// ---------------------------------------------------------------------------
// Name normalisation (shared with cache.ts)
// ---------------------------------------------------------------------------

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
  // Strip German plural / declension suffixes, longest first, so that
  // singular and plural forms map to the same key:
  //   Banane / Bananen  → banan
  //   Eier   / Ei       → ei      (via "er" strip)
  //   Apfel  / Apfels   → apfel
  // Minimum result length of 2 characters to avoid over-stemming.
  if (base.length >= 5 && base.endsWith("en")) return base.slice(0, -2);
  if (base.length >= 4 && base.endsWith("er")) return base.slice(0, -2);
  if (base.length >= 5 && base.endsWith("es")) return base.slice(0, -2);
  if (base.length >= 4 && base.endsWith("s"))  return base.slice(0, -1);
  if (base.length >= 4 && base.endsWith("n"))  return base.slice(0, -1);
  if (base.length >= 4 && base.endsWith("e"))  return base.slice(0, -1);
  return base;
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/**
 * Read-side: fetch a batch of history rows for the given names so
 * the aggregator can look up every parsed item in ONE query. Returns
 * a map keyed by normalized name. Names with no row are simply
 * absent from the map.
 *
 * When the table has `size_modifier` rows, multiple rows may share
 * the same normalized_name. The map returns the unmodified (NULL
 * size_modifier) row for backward-compat callers. Callers that care
 * about a specific modifier should use the overloaded form that
 * accepts a sizeModifiers map.
 */
export async function lookupUserFoodHistory(
  sb: SupabaseClient,
  userId: string,
  names: string[],
  sizeModifiers?: Map<string, string | null>,
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
      "normalized_name, display_name, size_modifier, typical_grams, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g, source, occurrences",
    )
    .eq("user_id", userId)
    .in("normalized_name", keys);
  if (error) {
    // Missing table (migration not yet applied) or RLS denial — treat
    // as a cold cache. The pipeline then falls through to OFF/USDA/GPT
    // so nothing breaks for users on an unmigrated environment.
    return out;
  }

  // Build a nested map: normalized_name → (size_modifier|'' → row)
  const byNameMod = new Map<string, Map<string, UserFoodHistoryRow>>();
  for (const r of (data ?? []) as UserFoodHistoryRow[]) {
    if (!byNameMod.has(r.normalized_name)) {
      byNameMod.set(r.normalized_name, new Map());
    }
    byNameMod.get(r.normalized_name)!.set(r.size_modifier ?? "", r);
  }

  for (const key of keys) {
    const modMap = byNameMod.get(key);
    if (!modMap) continue;

    // Preferred modifier: use the caller-supplied value when available.
    // Fall back to NULL (unmodified portion) if no match. Skip entirely
    // when the requested modifier has no row and no fallback exists.
    const requestedMod = sizeModifiers?.get(key) ?? null;
    const modKey = requestedMod ?? "";
    const r = modMap.get(modKey) ?? modMap.get("") ?? undefined;
    if (!r) continue;

    const carbs   = Number(r.carbs_per_100g);
    const protein = Number(r.protein_per_100g);
    const fat     = Number(r.fat_per_100g);
    const fiber   = Number(r.fiber_per_100g) || 0;
    // Safety guard: refuse all-zero rows. Falling through to OFF/USDA
    // is strictly safer than handing the dose engine silent zeros.
    if (carbs + protein + fat <= 0) continue;
    const grams = Number(r.typical_grams);
    if (!(grams > 0)) continue;

    out.set(key, {
      per100: { carbs_g: carbs, protein_g: protein, fat_g: fat, fiber_g: fiber },
      typicalGrams: grams,
      source: r.source,
      displayName: r.display_name,
      occurrences: r.occurrences,
      sizeModifier: r.size_modifier,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write path helpers
// ---------------------------------------------------------------------------

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

/** NutritionItem extended with optional size_modifier for Phase-B write path. */
export interface RecordItemInput extends NutritionItem {
  /** Canonical size modifier key (e.g. 'klein', 'groß', 'halb') or null. */
  sizeModifier?: string | null;
  /**
   * Human-readable display name override. When provided, this is stored
   * in the `display_name` column instead of `name`. Use this when `name`
   * is a normalized base string (e.g. parseFoodName's rawBase) and you
   * still want the original display text in the DB.
   */
  displayName?: string;
}

/**
 * Write-side: upsert a batch of items into the user's history. Skips
 * items whose macros can't be safely converted to per-100g (zero
 * grams, all-zero macros, impossible densities).
 *
 * When `sizeModifier` is provided on an item the typical_grams stored
 * already includes the quantity multiplier (caller responsibility —
 * see parseFoodName / callers in lib/meals.ts and chat-macros route).
 *
 * Best-effort: never throws. Callers wrap their own try/catch but
 * we also swallow inside so a transient DB hiccup can't fail a meal
 * save. The pipeline's correctness does NOT depend on the history
 * being current.
 */
export async function recordItemsToHistory(
  sb: SupabaseClient,
  userId: string,
  items: RecordItemInput[],
  opts: RecordItemsOptions,
): Promise<void> {
  if (!userId || items.length === 0) return;

  // 1. Reduce to one (name+modifier, per100, grams) candidate per
  //    (normalized_name, size_modifier) pair within this batch.
  //    `normName`    → the DB key (normalized_name column)
  //    `displayName` → human-readable text (display_name column);
  //                   callers may pass RecordItemInput.displayName to
  //                   override when `name` is a pre-stemmed rawBase.
  const candidates = new Map<string, {
    normName:    string;
    displayName: string;
    per100:      NutritionPer100;
    grams:       number;
    sizeModifier: string | null;
  }>();

  for (const it of items) {
    const normName = normalizeFoodName(it.name);
    if (!normName) continue;
    const mod = it.sizeModifier ?? null;
    const key = `${normName}\x00${mod ?? ""}`;
    const per100 = toPer100(it);
    if (!per100) continue;
    if (it.source === "unknown") continue; // refuse to learn from unknowns
    const existing = candidates.get(key);
    if (existing) {
      existing.per100 = {
        carbs_g:   (existing.per100.carbs_g   + per100.carbs_g)   / 2,
        protein_g: (existing.per100.protein_g + per100.protein_g) / 2,
        fat_g:     (existing.per100.fat_g     + per100.fat_g)     / 2,
        fiber_g:   (existing.per100.fiber_g   + per100.fiber_g)   / 2,
      };
      existing.grams = (existing.grams + it.grams) / 2;
    } else {
      candidates.set(key, {
        normName,
        displayName: it.displayName ?? it.name,
        per100,
        grams: it.grams,
        sizeModifier: mod,
      });
    }
  }
  if (candidates.size === 0) return;

  // Group candidate keys by normalized_name for the batch read.
  // Use the pre-computed normName (not re-derived from displayName).
  const normNames = Array.from(
    new Set(Array.from(candidates.values()).map((c) => c.normName))
  );

  try {
    // 2. Read current rows so we can compute the merged values
    //    client-side. Could be done in PL/pgSQL but JS-side keeps the
    //    blending logic in one place + unit-testable.
    const { data: existingRows, error: readErr } = await sb
      .from(TABLE)
      .select(
        "id, normalized_name, display_name, size_modifier, typical_grams, " +
        "carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g, " +
        "source, occurrences",
      )
      .eq("user_id", userId)
      .in("normalized_name", normNames);
    if (readErr) return; // table missing or RLS — skip silently
    const byKey = new Map<string, UserFoodHistoryRow>();
    for (const r of (existingRows ?? []) as unknown as UserFoodHistoryRow[]) {
      byKey.set(`${r.normalized_name}\x00${r.size_modifier ?? ""}`, r);
    }

    const now = new Date().toISOString();
    const toInsert: Array<Record<string, unknown>> = [];
    const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];

    for (const [key, c] of candidates) {
      const normName = c.normName;
      const prev = byKey.get(key);

      if (!prev) {
        // Brand new row.
        toInsert.push({
          user_id:          userId,
          normalized_name:  normName,
          display_name:     c.displayName,
          size_modifier:    c.sizeModifier,
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
        toUpdate.push({ id: prev.id, patch: {
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
        }});
        continue;
      }

      // user_confirmed incoming → overwrite.
      if (opts.source === "user_confirmed") {
        toUpdate.push({ id: prev.id, patch: {
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
        }});
        continue;
      }

      // history + existing history → weighted running average.
      // Cap occurrences in the denominator at 20 so the cache stays
      // responsive to genuine behaviour changes.
      const n = Math.min(prev.occurrences, 20);
      const blend = (oldVal: number, newVal: number) =>
        round2((Number(oldVal) * n + newVal) / (n + 1));
      toUpdate.push({ id: prev.id, patch: {
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
      }});
    }

    // Execute inserts and updates independently — avoids the onConflict
    // complexity with the COALESCE-based partial unique index.
    if (toInsert.length > 0) {
      await sb.from(TABLE).insert(toInsert);
    }
    for (const { id, patch } of toUpdate) {
      await sb.from(TABLE).update(patch).eq("id", id).eq("user_id", userId);
    }
  } catch {
    // Silent — see contract in JSDoc above.
  }
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

interface BackfillItem {
  name: string;
  grams: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  source?: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Scan the user's historical `meals.parsed_json` items, compute the
 * median grams per food name, discard outliers above 3× median, then
 * seed `user_food_history` with the surviving samples.
 *
 * Idempotent: returns 0 immediately when the table already has rows
 * for this user (no double-seeding). This is intentional — the passive
 * saveMeal path keeps the cache fresh on every new meal; backfill is
 * only for the cold-start scenario.
 *
 * Returns the number of rows seeded (0 if already populated).
 */
export async function backfillFoodHistory(
  sb: SupabaseClient,
  userId: string,
): Promise<number> {
  if (!userId) return 0;

  // Early-return if the user already has rows (idempotent guard).
  const { count } = await sb
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return 0;

  // Fetch all meals with non-empty parsed_json.
  const { data: meals, error: mealsErr } = await sb
    .from("meals")
    .select("parsed_json")
    .eq("user_id", userId)
    .not("parsed_json", "is", null);
  if (mealsErr || !meals || meals.length === 0) return 0;

  // Flatten items, group by (normalized_name, size_modifier) composite key.
  // parseFoodName extracts any quantity/size prefix before normalization so
  // "große Banane" lands in a separate bucket from plain "Banane", and
  // "zwei Bananen" folds the ×2 quantity into the grams value rather than
  // creating a quantity-specific row.
  interface BackfillBucket {
    rawBase:      string;   // name field to pass to recordItemsToHistory
    displayName:  string;   // original text → display_name column
    sizeModifier: string | null;
    items:        BackfillItem[];
  }
  const byComposite = new Map<string, BackfillBucket>();

  for (const meal of meals) {
    const items: BackfillItem[] = Array.isArray(meal.parsed_json) ? meal.parsed_json : [];
    for (const it of items) {
      if (!it || typeof it.name !== "string") continue;
      if (it.source === "unknown") continue;
      const rawGrams = Number(it.grams);
      if (!(rawGrams > 0)) continue;

      const parsed = parseFoodName(it.name);
      if (!parsed.foodName) continue;

      // Fold quantity into grams so "zwei Bananen" (q=2, grams=200)
      // stores a 400 g portion rather than a 200 g portion × 2.
      const grams = rawGrams * parsed.quantity;

      const compositeKey = `${parsed.foodName}\x00${parsed.sizeModifier ?? ""}`;
      if (!byComposite.has(compositeKey)) {
        byComposite.set(compositeKey, {
          rawBase:      parsed.rawBase || it.name,
          displayName:  it.name,
          sizeModifier: parsed.sizeModifier,
          items:        [],
        });
      }
      byComposite.get(compositeKey)!.items.push({
        name:    it.name,
        grams,
        carbs:   Number(it.carbs   ?? 0) * parsed.quantity,
        protein: Number(it.protein ?? 0) * parsed.quantity,
        fat:     Number(it.fat     ?? 0) * parsed.quantity,
        fiber:   Number(it.fiber   ?? 0) * parsed.quantity,
        source:  it.source,
      });
    }
  }
  if (byComposite.size === 0) return 0;

  // Compute median grams per group and discard outliers > 3× median.
  const BATCH = 50;
  let total = 0;
  const batch: RecordItemInput[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await recordItemsToHistory(sb, userId, [...batch], { source: "history" });
    total += batch.length;
    batch.length = 0;
  };

  for (const [, bucket] of byComposite) {
    const { rawBase, displayName, sizeModifier, items } = bucket;
    const gramValues = items.map((i) => i.grams);
    const med = median(gramValues);
    const threshold = med * 3;
    const valid = items.filter((i) => i.grams <= threshold || med === 0);
    if (valid.length === 0) continue;

    // Average macros over surviving items for better fidelity.
    const avgGrams   = valid.reduce((s, i) => s + i.grams,   0) / valid.length;
    const avgCarbs   = valid.reduce((s, i) => s + i.carbs,   0) / valid.length;
    const avgProtein = valid.reduce((s, i) => s + i.protein, 0) / valid.length;
    const avgFat     = valid.reduce((s, i) => s + i.fat,     0) / valid.length;
    const avgFiber   = valid.reduce((s, i) => s + i.fiber,   0) / valid.length;

    batch.push({
      name:         rawBase,
      displayName,
      sizeModifier,
      grams:        avgGrams,
      carbs:        avgCarbs,
      protein:      avgProtein,
      fat:          avgFat,
      fiber:        avgFiber,
      source:       "open_food_facts", // treat as non-unknown for recording
    });

    if (batch.length >= BATCH) await flush();
  }
  await flush();

  return total;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
