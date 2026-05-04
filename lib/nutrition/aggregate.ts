import { lookupOpenFoodFacts } from "./openFoodFacts";
import { lookupUSDA } from "./usda";
import { estimateItemNutrition } from "./estimate";
import type {
  AggregatedNutrition,
  AggregateSource,
  NutritionItem,
  NutritionPer100,
  NutritionSource,
  ParsedFoodItem,
} from "./types";

const ZERO: NutritionPer100 = { carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0 };

/**
 * Smart-routing aggregator: stage 2 of the nutrition pipeline.
 *
 * For each parsed item:
 *   1. Pick PRIMARY source from `is_branded` flag:
 *        branded  → Open Food Facts (then USDA fallback)
 *        generic  → USDA            (then Open Food Facts fallback)
 *   2. If both DB lookups return null, fall back to GPT estimation
 *      and tag the item as `source: 'estimated'`.
 *   3. Scale per-100g values to the item's actual grams.
 *
 * All per-item lookups run in parallel (Promise.all). Each HTTP lookup
 * has its own 3s timeout enforced inside its client; the aggregator
 * itself imposes no extra wall-clock budget.
 *
 * Top-level `nutritionSource`:
 *   - "database"  : every item resolved via OFF or USDA
 *   - "mixed"     : at least one DB hit AND at least one estimate
 *   - "estimated" : every item fell back to GPT estimate
 */

interface ResolvedItem {
  per100: NutritionPer100;
  source: NutritionSource;
}

async function resolveItem(item: ParsedFoodItem): Promise<ResolvedItem> {
  // SPECULATIVE PARALLEL DB lookups — up to 2026-05-04 these ran
  // sequentially (OFF then USDA, or USDA then OFF depending on
  // is_branded). When both DBs MISS, that meant up to 6s of
  // timeout-waiting per item before the GPT estimator even started —
  // driving the voice→form round-trip to 12s+ for multi-item
  // German-branded meals (the user-reported bug).
  //
  // Strategy: kick BOTH lookups off in parallel, then await the
  // PRIMARY first. If primary hits, return immediately — the
  // secondary is already in flight but its result is discarded
  // (Node will still consume the response; that's fine). If primary
  // misses, the secondary is usually already resolved (or close to
  // it), so the await is near-instant. Worst case (both miss) is
  // bounded by max(OFF, USDA) ≈ 2.5s instead of sequential
  // OFF + USDA ≈ 5s — and the happy path stays at primary-only
  // latency (~600ms USDA, ~1.2s OFF).
  const offTerm  = item.search_term_de || item.name;
  const usdaTerm = item.search_term_en || item.name;
  const offP  = lookupOpenFoodFacts(offTerm);
  const usdaP = lookupUSDA(usdaTerm);

  if (item.is_branded) {
    const off = await offP;
    if (off) return { per100: off, source: "open_food_facts" };
    const usda = await usdaP;
    if (usda) return { per100: usda, source: "usda" };
  } else {
    const usda = await usdaP;
    if (usda) return { per100: usda, source: "usda" };
    const off = await offP;
    if (off) return { per100: off, source: "open_food_facts" };
  }

  // Both DBs missed → GPT estimate. estimateItemNutrition THROWS on
  // any failure (config, API, all-zero response) per the T1D safety
  // contract — see lib/nutrition/estimate.ts. We catch here so a
  // single-item failure doesn't kill the whole meal: the failed item
  // becomes 'unknown' (zero macros, surfaced to the UI as a refusal
  // to auto-populate dosing inputs), while items that DID resolve
  // still flow through normally.
  try {
    const est = await estimateItemNutrition(item);
    return { per100: est, source: "estimated" };
  } catch {
    return { per100: ZERO, source: "unknown" };
  }
}

function scale(per100: NutritionPer100, grams: number): {
  carbs: number; protein: number; fat: number; fiber: number;
} {
  const factor = grams / 100;
  return {
    carbs:   Math.round(per100.carbs_g   * factor),
    protein: Math.round(per100.protein_g * factor),
    fat:     Math.round(per100.fat_g     * factor),
    fiber:   Math.round(per100.fiber_g   * factor),
  };
}

function topLevelSource(items: NutritionItem[]): AggregateSource {
  if (items.length === 0) return "unknown";
  // 'unknown' is the most severe verdict — even one item where both
  // DB lookups AND the GPT estimate fell over means the totals can't
  // be trusted for insulin dosing. The UI MUST surface this clearly.
  if (items.some((i) => i.source === "unknown")) return "unknown";
  const allEstimated = items.every((i) => i.source === "estimated");
  if (allEstimated) return "estimated";
  const anyEstimated = items.some((i) => i.source === "estimated");
  return anyEstimated ? "mixed" : "database";
}

export async function aggregateNutrition(
  items: ParsedFoodItem[],
): Promise<AggregatedNutrition> {
  if (items.length === 0) {
    return {
      items: [],
      totals: { carbs: 0, protein: 0, fat: 0, fiber: 0, calories: 0 },
      nutritionSource: "unknown",
    };
  }

  // Parallel resolve — each item makes at most 2 HTTP calls + 1 GPT call,
  // each with its own 3-4s timeout. With N items the total wall time is
  // bounded by the slowest item, not N × budget.
  const resolved = await Promise.all(items.map((it) => resolveItem(it)));

  const finalItems: NutritionItem[] = items.map((it, i) => {
    const r = resolved[i];
    const scaled = scale(r.per100, it.grams);
    return {
      name:    it.name,
      grams:   it.grams,
      carbs:   scaled.carbs,
      protein: scaled.protein,
      fat:     scaled.fat,
      fiber:   scaled.fiber,
      source:  r.source,
    };
  });

  const totals = finalItems.reduce(
    (acc, it) => ({
      carbs:   acc.carbs   + it.carbs,
      protein: acc.protein + it.protein,
      fat:     acc.fat     + it.fat,
      fiber:   acc.fiber   + it.fiber,
    }),
    { carbs: 0, protein: 0, fat: 0, fiber: 0 },
  );
  const calories = Math.round(totals.carbs * 4 + totals.protein * 4 + totals.fat * 9);

  return {
    items: finalItems,
    totals: { ...totals, calories },
    nutritionSource: topLevelSource(finalItems),
  };
}
