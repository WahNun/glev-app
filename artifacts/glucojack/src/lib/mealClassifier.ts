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
  "sugar", "granola", "juice", "dessert", "cake", "candy", "soda", "syrup",
  "white bread", "donut", "doughnut", "cookie", "muffin", "bagel",
  "pretzel", "pancake", "waffle", "cereal", "pop-tart", "poptart",
  "smoothie", "milkshake", "ice cream", "gelato", "sorbet", "jam",
  "honey", "caramel", "chocolate milk", "banana", "cinnamon roll",
  "energy drink", "sports drink", "lemonade", "sweet tea",
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
  fiber = 0,
): ClassificationResult {
  // Net carbs: fiber buffers absorption
  const netCarbs = Math.max(0, carbs - fiber);

  // Caloric energy per macro (g × kcal/g), using NET carbs for classification
  const carbCals    = netCarbs * 4;
  const proteinCals = protein * 4;
  const fatCals     = fat * 9;
  const totalCals   = carbCals + proteinCals + fatCals;

  const carbPct    = totalCals > 0 ? (carbCals    / totalCals) * 100 : 0;
  const fatPct     = totalCals > 0 ? (fatCals     / totalCals) * 100 : 0;
  const proteinPct = totalCals > 0 ? (proteinCals / totalCals) * 100 : 0;

  // ─── Fast sugar keyword override ──────────────────────────────────
  // High fiber (>10g) reduces fast-carbs sensitivity — only override if fiber is low
  if (description && description.trim().length > 0 && fiber < 10) {
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

  // ─── HIGH FIBER BIAS: fiber > 15g → always BALANCED (overrides FAST_CARBS) ─
  if (fiber >= 15) {
    const fiberBonus = `High fiber (${fiber}g) significantly slows carb absorption — classified as BALANCED regardless of carb content.`;
    // Still check for high fat / high protein first
    if (fat > 30 || fatPct > 40) {
      const trigger = fat > 30 ? `fat ${fat}g > 30g` : `fat ${fatPct.toFixed(0)}% of cals > 40%`;
      return {
        mealType: "HIGH_FAT",
        reasoning: `HIGH FAT — ${trigger}. ${fiberBonus} Split dose recommended.`,
        fastSugarMatch: null, carbPct, fatPct, proteinPct,
      };
    }
    if (protein > 40 && netCarbs < 40) {
      return {
        mealType: "HIGH_PROTEIN",
        reasoning: `HIGH PROTEIN — ${protein}g protein with ${netCarbs}g net carbs. ${fiberBonus}`,
        fastSugarMatch: null, carbPct, fatPct, proteinPct,
      };
    }
    return {
      mealType: "BALANCED",
      reasoning: `BALANCED — ${fiberBonus} Net carbs: ${netCarbs}g (${carbs}g − ${fiber}g fiber). Standard bolus timing.`,
      fastSugarMatch: null, carbPct, fatPct, proteinPct,
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
      fastSugarMatch: null, carbPct, fatPct, proteinPct,
    };
  }

  // ─── FAST CARBS: net carbs% > 60% AND fat < 20 g AND protein < 25 g
  // Fiber 10–15g: raise the carb% threshold to 70% (reduced sensitivity)
  const fastCarbThreshold = fiber >= 10 ? 70 : 60;
  if (carbPct > fastCarbThreshold && fat < 20 && protein < 25) {
    const fiberNote = fiber >= 10 ? ` Fiber (${fiber}g) partially buffers absorption.` : "";
    return {
      mealType: fiber >= 10 ? "BALANCED" : "FAST_CARBS",
      reasoning: fiber >= 10
        ? `BALANCED — net carbs ${carbPct.toFixed(0)}% but fiber ${fiber}g reduces spike speed.${fiberNote} Monitor at 60–90 min.`
        : `FAST CARBS — net carbs ${carbPct.toFixed(0)}% of calories, low fat (${fat}g) and protein (${protein}g). Expect peak at 30–60 min.`,
      fastSugarMatch: null, carbPct, fatPct, proteinPct,
    };
  }

  // ─── HIGH PROTEIN: protein > 40 g AND net carbs < 40 g ──────────
  if (protein > 40 && netCarbs < 40) {
    return {
      mealType: "HIGH_PROTEIN",
      reasoning: `HIGH PROTEIN — protein ${protein}g with ${netCarbs}g net carbs. Glucose effect may be delayed 2–3 h.`,
      fastSugarMatch: null, carbPct, fatPct, proteinPct,
    };
  }

  // ─── BALANCED ────────────────────────────────────────────────────
  const fiberSuffix = fiber > 0 ? ` Net carbs: ${netCarbs}g (${carbs}g − ${fiber}g fiber).` : "";
  return {
    mealType: "BALANCED",
    reasoning: `BALANCED — carbs ${carbPct.toFixed(0)}%, protein ${proteinPct.toFixed(0)}%, fat ${fatPct.toFixed(0)}% of calories.${fiberSuffix} Standard pre-meal bolus.`,
    fastSugarMatch: null, carbPct, fatPct, proteinPct,
  };
}
