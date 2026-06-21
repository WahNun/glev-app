import { lookupOpenFoodFacts } from "./openFoodFacts";
import { lookupUSDA } from "./usda";
import { estimateItemNutrition } from "./estimate";
import { categoryDefaultFor } from "./categoryDefaults";
import type {
  AggregatedNutrition,
  AggregateSource,
  NutritionItem,
  NutritionPer100,
  NutritionSource,
  ParsedFoodItem,
} from "./types";
import type { UserFoodHistoryHit } from "./userFoodHistory";
import { normalizeFoodName } from "./userFoodHistory";
import { AggregatorTrace } from "./aggregator-trace";

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

async function resolveItem(
  item: ParsedFoodItem,
  history?: Map<string, UserFoodHistoryHit>,
  trace?: AggregatorTrace,
): Promise<ResolvedItem> {
  // Phase B: per-user food history wins over every other source.
  // The history table is per-user and RLS-protected, so a hit here
  // is by definition the user's own historical data (or their
  // chat-macros correction). Skipping OFF/USDA/GPT for these items
  // is THE main latency + accuracy win of this phase.
  if (history) {
    const key = normalizeFoodName(item.name);
    const hit = key ? history.get(key) : undefined;
    if (hit) {
      // user_confirmed = explicit chat-macros correction, always trusted.
      if (hit.source === "user_confirmed") {
        trace?.recordLookup({ source: "user_history", success: true, latency_ms: 0, hit_count: hit.occurrences });
        return { per100: hit.per100, source: "user_confirmed" };
      }
      // Passive history: require ≥3 occurrences before trusting the cached
      // macros for T1D dosing. A single logged banana could be a typo or
      // a one-off unusual portion — fall through to OFF/USDA/GPT until
      // at least 3 entries have been blended into the average.
      if (hit.occurrences >= 3) {
        trace?.recordLookup({ source: "user_history", success: true, latency_ms: 0, hit_count: hit.occurrences });
        return { per100: hit.per100, source: "user_history" };
      }
      // < 3 occurrences: fall through to OFF / USDA / GPT below.
      trace?.recordLookup({ source: "user_history", success: false, latency_ms: 0, hit_count: hit.occurrences });
    }
  }

  // Phase 3: Promise.any race — both lookups fire simultaneously and the
  // first non-null hit wins. The slower one's in-flight request continues
  // until its own timeout (1.5s), but we don't wait for it. Wall time =
  // min(OFF, USDA) on a hit, max(OFF, USDA) on a full miss — capped at
  // 1.5s per Phase 3 timeout tightening. Priority tiebreak: if both
  // respond within the same tick, branded → prefer OFF; generic → prefer USDA.
  const offTerm  = item.search_term_de || item.name;
  const usdaTerm = item.search_term_en || item.name;

  // Wrap each lookup as a Promise that rejects when the result is null
  // (Promise.any needs a rejection to fall through to the next).
  const offT0 = Date.now();
  const offHit = lookupOpenFoodFacts(offTerm).then((r) => {
    const latency_ms = Date.now() - offT0;
    if (!r) {
      trace?.recordLookup({ source: "open_food_facts", success: false, latency_ms });
      throw new Error("off-miss");
    }
    trace?.recordLookup({ source: "open_food_facts", success: true, latency_ms, response_excerpt: JSON.stringify(r).slice(0, 200) });
    return { per100: r, source: "open_food_facts" as const };
  });

  const usdaT0 = Date.now();
  const usdaHit = lookupUSDA(usdaTerm).then((r) => {
    const latency_ms = Date.now() - usdaT0;
    if (!r) {
      trace?.recordLookup({ source: "usda", success: false, latency_ms });
      throw new Error("usda-miss");
    }
    trace?.recordLookup({ source: "usda", success: true, latency_ms, response_excerpt: JSON.stringify(r).slice(0, 200) });
    return { per100: r, source: "usda" as const };
  });

  // Order the race so the preferred source wins when both resolve simultaneously.
  const raceOrder = item.is_branded ? [offHit, usdaHit] : [usdaHit, offHit];
  try {
    return await Promise.any(raceOrder);
  } catch {
    // Both DBs missed — fall through to GPT / category-default below.
  }

  // Both DBs missed → GPT estimate. estimateItemNutrition THROWS on
  // any failure (config, API, all-zero response, IMPOSSIBLE) per the
  // T1D safety contract — see lib/nutrition/estimate.ts.
  const llmT0 = Date.now();
  try {
    const est = await estimateItemNutrition(item);
    trace?.recordLookup({ source: "llm", success: true, latency_ms: Date.now() - llmT0 });
    return { per100: est, source: "estimated" };
  } catch {
    trace?.recordLookup({ source: "llm", success: false, latency_ms: Date.now() - llmT0 });
    // Option C (2026-05-12 — Lucas): before tagging this item as
    // 'unknown' (which escalates the WHOLE meal to nutritionSource
    // 'unknown' and blocks auto-fill — see topLevelSource), try a
    // deterministic category-default lookup. Common foods like
    // "Sucuk", "Schnitzel", "Pommes" map to broad per-100g averages
    // sourced from USDA SR-Legacy + OFF category medians. Better a
    // ±20% category estimate than zero macros for a single rate-
    // limited / IMPOSSIBLE LLM response.
    const fallback = categoryDefaultFor(item);
    if (fallback) {
      return { per100: fallback.per100, source: "estimated" };
    }
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

  const isDbLike = (s: NutritionSource) =>
    s === "open_food_facts" || s === "usda" ||
    s === "user_history"   || s === "user_confirmed";

  const anyEstimated = items.some((i) => i.source === "estimated");
  if (anyEstimated && items.some((i) => isDbLike(i.source))) return "mixed";
  if (items.every((i) => i.source === "estimated")) return "estimated";

  // All items resolved from a single source — return specific badge so
  // the UI can say "Aus deinen Logs / Open Food Facts / USDA" instead
  // of the generic "Datenbank ✓".
  if (items.every((i) => i.source === "user_history" || i.source === "user_confirmed")) return "user_history";
  if (items.every((i) => i.source === "open_food_facts")) return "open_food_facts";
  if (items.every((i) => i.source === "usda")) return "usda";

  // Mix of different DB sources (e.g. OFF item + USDA item) — generic.
  return "database";
}

export interface AggregateOptions {
  /**
   * Per-user food memory map (Phase B). Build via
   * lookupUserFoodHistory(sb, userId, names). When a parsed item's
   * normalized name is a key in this map, the aggregator uses the
   * cached per-100g values and skips OFF/USDA/GPT entirely.
   *
   * Optional — when absent the aggregator falls back to the
   * pre-Phase-B behaviour (pure OFF/USDA/GPT cascade). Old callers
   * that don't pass this option keep working unchanged.
   */
  userHistory?: Map<string, UserFoodHistoryHit>;
  /** When provided, each lookup stage records timing + success into this trace. Persist is the caller's responsibility. */
  trace?: AggregatorTrace;
}

export async function aggregateNutrition(
  items: ParsedFoodItem[],
  opts: AggregateOptions = {},
): Promise<AggregatedNutrition> {
  const { trace } = opts;

  if (items.length === 0) {
    return {
      items: [],
      totals: { carbs: 0, protein: 0, fat: 0, fiber: 0, calories: 0 },
      nutritionSource: "unknown",
    };
  }

  trace?.setParsedFood(items);

  // Parallel resolve — each item makes at most 2 HTTP calls + 1 GPT call,
  // each with its own 3-4s timeout. With N items the total wall time is
  // bounded by the slowest item, not N × budget. History hits short-
  // circuit before any HTTP call and resolve synchronously.
  const resolved = await Promise.all(
    items.map((it) => resolveItem(it, opts.userHistory, trace)),
  );

  const finalItems: NutritionItem[] = items.map((it, i) => {
    const r = resolved[i];
    // Phase B: substitute the user's typical portion size when the
    // parser indicates the grams came from a global default (e.g.
    // "Banane" → 120g) AND we have a personalised history entry.
    // If the user explicitly typed "150g Banane" we honour that.
    let grams = it.grams;
    if (
      opts.userHistory &&
      it.quantity_specified === false &&
      (r.source === "user_history" || r.source === "user_confirmed")
    ) {
      const hit = opts.userHistory.get(normalizeFoodName(it.name));
      if (hit && hit.typicalGrams > 0) grams = Math.round(hit.typicalGrams);
    }
    const scaled = scale(r.per100, grams);
    return {
      name:    it.name,
      grams,
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

  const nutritionSource = topLevelSource(finalItems);

  // Compute the minimum occurrence count across all user-history-resolved
  // items so the UI badge can show "Basiert auf X vorherigen Einträgen".
  let historyMinOccurrences: number | undefined;
  if (nutritionSource === "user_history" && opts.userHistory) {
    const counts: number[] = [];
    for (const it of finalItems) {
      const hit = opts.userHistory.get(normalizeFoodName(it.name));
      if (hit) counts.push(hit.occurrences);
    }
    if (counts.length > 0) historyMinOccurrences = Math.min(...counts);
  }

  const srcCounts = finalItems.reduce<Record<string, number>>((acc, it) => {
    acc[it.source] = (acc[it.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[nutritionMetrics] items=${finalItems.length} sources=${JSON.stringify(srcCounts)} topLevel=${nutritionSource}`);

  trace?.setFinalSource(nutritionSource);
  trace?.setFinalMacros({ ...totals, calories });

  return {
    items: finalItems,
    totals: { ...totals, calories },
    nutritionSource,
    ...(historyMinOccurrences !== undefined ? { historyMinOccurrences } : {}),
  };
}
