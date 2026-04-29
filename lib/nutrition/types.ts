/**
 * Shared types for the two-stage nutrition lookup pipeline:
 *   1. GPT parses free-form food text into structured items (no macros)
 *   2. Smart router queries Open Food Facts (branded) or USDA (generic)
 *      per item, falls back to GPT estimation if both DB lookups fail.
 *
 * The output shape is BACKWARD COMPATIBLE with the old direct-GPT
 * parse-food route (items / totals / mealType / summary / description)
 * with two additive fields:
 *   - per-item `source` ('open_food_facts' | 'usda' | 'estimated')
 *   - top-level `nutritionSource` ('database' | 'mixed' | 'estimated')
 */

export type NutritionSource = "open_food_facts" | "usda" | "estimated";

export type AggregateSource = "database" | "mixed" | "estimated";

/**
 * Structured item produced by the GPT parser. NO macros — those are
 * filled in by the DB-lookup stage. The parser's job is purely
 * language understanding: extract name, weight, brand-vs-generic
 * hint, and bilingual search terms for OFF/USDA queries.
 */
export interface ParsedFoodItem {
  name: string;            // Original-language label as the user said it
  grams: number;           // Mass after unit normalization (g for solids,
                           // ml treated as g for liquid lookups)
  is_branded: boolean;     // True for named products ("Bettery shake"),
                           // false for generic foods ("apple", "broccoli")
  search_term_en: string;  // English query for USDA
  search_term_de: string;  // German query for OFF (OFF has solid DE coverage)
}

/**
 * Per-100g/ml nutrition values returned by either DB lookup or GPT
 * estimate. Always normalized to per-100 base units so the aggregator
 * can scale to actual portion size in one place.
 */
export interface NutritionPer100 {
  carbs_g:   number;
  protein_g: number;
  fat_g:     number;
  fiber_g:   number;
}

/**
 * Final per-item nutrition AFTER scaling to actual grams. This is the
 * shape that lands in `parsed_json` and the API response. The `source`
 * field is the new addition vs the legacy ParsedFood (lib/meals.ts).
 */
export interface NutritionItem {
  name:    string;
  grams:   number;
  carbs:   number;
  protein: number;
  fat:     number;
  fiber:   number;
  source:  NutritionSource;
}

export interface NutritionTotals {
  carbs:    number;
  protein:  number;
  fat:      number;
  fiber:    number;
  calories: number;
}

export interface AggregatedNutrition {
  items:           NutritionItem[];
  totals:          NutritionTotals;
  /** Top-level provenance for UI badge: all-DB, mixed, or full GPT-fallback */
  nutritionSource: AggregateSource;
}
