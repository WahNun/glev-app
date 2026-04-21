export type MealType = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";

export interface ClassificationResult {
  mealType: MealType;
  reasoning: string;
  fastSugarMatch: string | null;
  carbPct: number;
  fatPct: number;
  proteinPct: number;
}

const FAST_SUGAR_KEYWORDS = [
  "granola", "juice", "dessert", "cake", "candy", "soda", "syrup",
  "white bread", "donut", "doughnut", "cookie", "muffin", "bagel",
  "pretzel", "pancake", "waffle", "cereal", "pop-tart", "poptart",
  "smoothie", "milkshake", "ice cream", "gelato", "sorbet", "jam",
  "honey", "caramel", "chocolate milk",
];

const MEAL_LABELS: Record<MealType, string> = {
  FAST_CARBS:   "Fast Carbs",
  HIGH_FAT:     "High Fat",
  HIGH_PROTEIN: "High Protein",
  BALANCED:     "Balanced",
};

export { MEAL_LABELS };

export function classifyMeal(
  carbs: number,
  protein: number,
  fat: number,
  description?: string,
): ClassificationResult {
  // Caloric energy per macro (g × kcal/g)
  const carbCals    = carbs * 4;
  const proteinCals = protein * 4;
  const fatCals     = fat * 9;
  const totalCals   = carbCals + proteinCals + fatCals;

  const carbPct    = totalCals > 0 ? (carbCals    / totalCals) * 100 : 0;
  const fatPct     = totalCals > 0 ? (fatCals     / totalCals) * 100 : 0;
  const proteinPct = totalCals > 0 ? (proteinCals / totalCals) * 100 : 0;

  // ─── Fast sugar keyword override ────────────────────────────────
  if (description && description.trim().length > 0) {
    const lc = description.toLowerCase();
    const matched = FAST_SUGAR_KEYWORDS.find((kw) => lc.includes(kw));
    if (matched) {
      return {
        mealType: "FAST_CARBS",
        reasoning: `Fast sugar detected ("${matched}") → forced FAST CARBS. Expect rapid spike; take full dose 10–15 min before eating.`,
        fastSugarMatch: matched,
        carbPct, fatPct, proteinPct,
      };
    }
  }

  if (totalCals === 0) {
    return {
      mealType: "BALANCED",
      reasoning: "Enter protein and fat to enable auto-classification.",
      fastSugarMatch: null,
      carbPct: 0, fatPct: 0, proteinPct: 0,
    };
  }

  // ─── HIGH FAT: fat > 30 g  OR  fat% > 40% ───────────────────────
  if (fat > 30 || fatPct > 40) {
    const trigger = fat > 30
      ? `fat ${fat}g exceeds 30 g`
      : `fat ${fatPct.toFixed(0)}% of calories (threshold: 40%)`;
    return {
      mealType: "HIGH_FAT",
      reasoning: `HIGH FAT — ${trigger}. Insulin absorption may be delayed; consider a split dose.`,
      fastSugarMatch: null,
      carbPct, fatPct, proteinPct,
    };
  }

  // ─── FAST CARBS: carbs% > 60% AND fat < 20 g AND protein < 25 g ─
  if (carbPct > 60 && fat < 20 && protein < 25) {
    return {
      mealType: "FAST_CARBS",
      reasoning: `FAST CARBS — carbs ${carbPct.toFixed(0)}% of calories with low fat (${fat}g) and protein (${protein}g). Expect peak at 30–60 min.`,
      fastSugarMatch: null,
      carbPct, fatPct, proteinPct,
    };
  }

  // ─── HIGH PROTEIN: protein > 40 g AND carbs < 40 g ─────────────
  if (protein > 40 && carbs < 40) {
    return {
      mealType: "HIGH_PROTEIN",
      reasoning: `HIGH PROTEIN — protein ${protein}g with low carbs (${carbs}g). Glucose effect may be delayed 2–3 h.`,
      fastSugarMatch: null,
      carbPct, fatPct, proteinPct,
    };
  }

  // ─── BALANCED ────────────────────────────────────────────────────
  return {
    mealType: "BALANCED",
    reasoning: `BALANCED — carbs ${carbPct.toFixed(0)}%, protein ${proteinPct.toFixed(0)}%, fat ${fatPct.toFixed(0)}% of calories. Standard pre-meal bolus.`,
    fastSugarMatch: null,
    carbPct, fatPct, proteinPct,
  };
}
