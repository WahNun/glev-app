import type { NutritionSource } from "./types";

export interface ConfidenceResult {
  /** Mean value (the macro itself, e.g. carbs in grams). */
  value: number;
  /** Half-width of the ±CI at 68% (approx 1σ). */
  ci: number;
  /** Confidence percentage: 100 − (ci/value × 100), clamped [50, 99]. */
  pct: number;
  /** Source label for the breakdown row. */
  sourceLabel: string;
  /** Optional detail lines explaining the CI (for the modal breakdown list). */
  details: string[];
}

export interface ItemConfidence {
  carbs: ConfidenceResult;
  protein: ConfidenceResult;
  fat: ConfidenceResult;
  fiber: ConfidenceResult;
  /** Aggregate confidence across macros (average of pct values). */
  overallPct: number;
}

interface HistoryEntry {
  /** Previously logged value for this macro in grams. */
  value: number;
}

interface ComputeOpts {
  /** Items from the user's prior history for σ calculation (user_history source). */
  historyEntries?: HistoryEntry[];
  /** Number of OFF/USDA database records that backed this item (affects CI width). */
  dbRecordCount?: number;
  /**
   * True when this item belongs to a meal with 3+ components.
   * Single-item and two-item meals are always "simple" (±15%).
   * Gram weight is NOT a complexity indicator.
   */
  isMultiComponent?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pctFromCi(value: number, ci: number): number {
  if (value <= 0) return 75;
  return clamp(Math.round(100 - (ci / value) * 100), 50, 99);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute confidence interval and percentage for a single macro value
 * given its nutrition source.
 */
export function computeMacroConfidence(
  macroName: "carbs" | "protein" | "fat" | "fiber",
  value: number,
  source: NutritionSource,
  grams: number,
  locale: "de" | "en" = "de",
  opts: ComputeOpts = {},
): ConfidenceResult {
  const isDE = locale === "de";

  if (source === "user_history" || source === "user_confirmed") {
    const entries = opts.historyEntries ?? [];
    const sigma = entries.length >= 3
      ? stddev(entries.map((e) => e.value))
      : value * 0.10;
    const ci = Math.max(0.1, sigma);
    const count = entries.length;
    const sourceLabel = isDE
      ? (source === "user_confirmed" ? "Eigene Korrektur" : "Deine Logs")
      : (source === "user_confirmed" ? "Your correction" : "Your logs");
    const details = count >= 3
      ? [
          isDE
            ? `Standardabweichung aus ${count} Einträgen: ±${ci.toFixed(1)}g`
            : `Std. deviation from ${count} entries: ±${ci.toFixed(1)}g`,
        ]
      : [
          isDE
            ? "Weniger als 3 Einträge — Schätzung ±10%"
            : "Fewer than 3 entries — estimate ±10%",
        ];
    return { value, ci, pct: pctFromCi(value, ci), sourceLabel, details };
  }

  if (source === "open_food_facts" || source === "usda") {
    const n = opts.dbRecordCount ?? 0;
    const frac = n > 100 ? 0.05 : 0.10;
    const baseCi = value * frac;
    const scalingCi = value * 0.03;
    const ci = Math.max(0.1, baseCi + scalingCi);
    const dbName = source === "open_food_facts" ? "Open Food Facts" : "USDA FoodData Central";
    const sourceLabel = dbName;
    const nLabel = n > 0
      ? (isDE ? `n=${n}` : `n=${n}`)
      : (isDE ? "n unbekannt" : "n unknown");
    const details = [
      isDE
        ? `${dbName} (${nLabel}): Datenbank-Varianz ±${(frac * 100).toFixed(0)}%`
        : `${dbName} (${nLabel}): DB variance ±${(frac * 100).toFixed(0)}%`,
      isDE
        ? `Skalierungsfehler ${grams}g: ±${scalingCi.toFixed(1)}g`
        : `Scaling error ${grams}g: ±${scalingCi.toFixed(1)}g`,
    ];
    return { value, ci, pct: pctFromCi(value, ci), sourceLabel, details };
  }

  if (source === "estimated" || source === "unknown") {
    // "complex" only for meals with 3+ components (passed via opts.isMultiComponent).
    // Gram weight and carb value are NOT complexity indicators — a 300g banana
    // is a simple single item and must not be penalised with ±25%.
    const isComplex = opts.isMultiComponent === true;
    const frac = isComplex ? 0.25 : 0.15;
    const ci = Math.max(0.1, value * frac);
    const sourceLabel = isDE ? "KI-Schätzung" : "AI estimate";
    const details = [
      isDE
        ? `Heuristik: ${isComplex ? "komplexes" : "einfaches"} Item · ±${(frac * 100).toFixed(0)}%`
        : `Heuristic: ${isComplex ? "complex" : "simple"} item · ±${(frac * 100).toFixed(0)}%`,
    ];
    return { value, ci, pct: pctFromCi(value, ci), sourceLabel, details };
  }

  // Fallback for unrecognized sources
  const ci = value * 0.15;
  return {
    value,
    ci: Math.max(0.1, ci),
    pct: pctFromCi(value, ci),
    sourceLabel: source,
    details: [],
  };
}

/**
 * Compute confidence for all four macros of a single food item.
 * Returns per-macro CI + an overall confidence percentage.
 */
export function computeItemConfidence(
  item: {
    name: string;
    grams: number;
    carbs: number;
    protein: number;
    fat: number;
    fiber: number;
    source?: string | null;
  },
  locale: "de" | "en" = "de",
  opts: ComputeOpts = {},
): ItemConfidence {
  const src = (item.source ?? "estimated") as NutritionSource;
  const macros = [
    { key: "carbs" as const,   value: item.carbs },
    { key: "protein" as const, value: item.protein },
    { key: "fat" as const,     value: item.fat },
    { key: "fiber" as const,   value: item.fiber },
  ];
  const results = Object.fromEntries(
    macros.map(({ key, value }) => [
      key,
      computeMacroConfidence(key, value, src, item.grams, locale, opts),
    ]),
  ) as { carbs: ConfidenceResult; protein: ConfidenceResult; fat: ConfidenceResult; fiber: ConfidenceResult };

  const avgPct = Math.round(
    (results.carbs.pct + results.protein.pct + results.fat.pct + results.fiber.pct) / 4,
  );

  return { ...results, overallPct: avgPct };
}

/**
 * Inverse-variance-weighted mean CI for "mixed" aggregate sources.
 * Each item's carbs CI is used as the uncertainty for that item.
 */
export function mixedCarbsCI(
  items: Array<{ carbs: number; carbsCi: number }>,
): { weightedMean: number; combinedCi: number; pct: number } {
  if (items.length === 0) return { weightedMean: 0, combinedCi: 0, pct: 75 };
  let weightSum = 0;
  let weightedTotal = 0;
  let varianceSum = 0;
  for (const { carbs, carbsCi } of items) {
    const variance = Math.pow(Math.max(carbsCi, 0.1), 2);
    const w = 1 / variance;
    weightSum += w;
    weightedTotal += w * carbs;
    varianceSum += 1 / w;
  }
  const weightedMean = weightedTotal / weightSum;
  const combinedCi = Math.sqrt(varianceSum);
  return { weightedMean, combinedCi, pct: pctFromCi(weightedMean, combinedCi) };
}
