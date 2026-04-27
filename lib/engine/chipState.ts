import type { Meal } from "@/lib/meals";
import { lifecycleFor, type LifecycleResult } from "./lifecycle";
import { getEvalColor, getEvalLabel } from "@/lib/mealTypes";
import { parseDbDate } from "@/lib/time";

export type ChipState = {
  state: "pending" | "provisional" | "final";
  color: string;
  label: string;
  body: string;
  trendHint?: string;
  lc: LifecycleResult;
};

const PENDING_COLOR     = "#6B7280";
const PROVISIONAL_COLOR = "#7C3AED";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function chipForMeal(meal: Meal, now: Date = new Date()): ChipState {
  const lc = lifecycleFor(meal, now);
  const created = parseDbDate(meal.meal_time ?? meal.created_at).getTime();

  if (lc.state === "pending") {
    const expected1h = fmtTime(created + 60 * 60_000);
    return {
      state: "pending",
      color: PENDING_COLOR,
      label: "WARTET AUF WERTE",
      body: `Wartet auf 1H-Glukosewert (erwartet ${expected1h}).`,
      lc,
    };
  }

  if (lc.state === "provisional") {
    const expected2h = fmtTime(created + 120 * 60_000);
    const d1 = lc.delta1;
    const lines: string[] = [];

    if (d1 != null && meal.bg_1h != null) {
      const sign = d1 > 0 ? "+" : "";
      lines.push(`1H-Wert: ${meal.bg_1h} mg/dL (Δ ${sign}${d1} mg/dL).`);
    }
    lines.push(`Wartet auf 2H-Glukosewert (erwartet ${expected2h}).`);
    lines.push("Hinweis: Der 2H-Wert ist der abschließende Outcome-Indikator.");

    let trendHint = "Tendenz: BG stabil im ersten Verlauf.";
    if (d1 != null) {
      if (d1 > 30) trendHint = "Tendenz: BG steigt — vorläufig erhöht.";
      else if (d1 < -30) trendHint = "Tendenz: BG fällt — vorläufig stabil oder fallend.";
    }

    return {
      state: "provisional",
      color: PROVISIONAL_COLOR,
      label: "VORLÄUFIG",
      body: lines.join(" "),
      trendHint,
      lc,
    };
  }

  // Final: prefer the freshly computed lc.outcome over the cached
  // meal.evaluation column. The cache is only refreshed on saveMeal,
  // so existing rows whose 2h reading came in outside the legacy
  // ±30 min window still have evaluation=null in the DB. Reading
  // lc.outcome here makes the chip flip to GOOD / HIGH / LOW the
  // moment a 2h value is present, without requiring a re-save.
  const outcome = lc.outcome ?? meal.evaluation;
  return {
    state: "final",
    color: getEvalColor(outcome),
    label: getEvalLabel(outcome),
    body: lc.reasoning,
    lc,
  };
}
