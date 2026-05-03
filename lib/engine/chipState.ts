import type { Meal } from "@/lib/meals";
import { lifecycleFor, type LifecycleResult } from "./lifecycle";
import type { AdjustmentMessage } from "./adjustment";
import { getEvalColor, getEvalLabel } from "@/lib/mealTypes";
import { parseDbDate } from "@/lib/time";

export type ChipState = {
  state: "pending" | "provisional" | "final";
  color: string;
  /** Localizable label — the engine emits a key, the UI calls `t(label.key)`. */
  label: AdjustmentMessage;
  /** Localizable body (one or more sentences). */
  body: AdjustmentMessage[];
  /** Localizable trend hint (provisional only). */
  trendHint?: AdjustmentMessage;
  /** Cached final-state outcome label (already localized via getEvalLabel). */
  finalOutcomeLabel?: string;
  lc: LifecycleResult;
};

const PENDING_COLOR     = "#6B7280";
const PROVISIONAL_COLOR = "#7C3AED";

function fmtTime(ms: number, locale: string = "de-DE"): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Returns chip metadata for a meal. The chip's textual content is exposed
 * as {@link AdjustmentMessage} entries so the UI can render them with the
 * active locale via next-intl. Time strings are pre-formatted with the
 * supplied BCP-47 locale to keep `lib/engine` free of i18n imports.
 */
export function chipForMeal(meal: Meal, now: Date = new Date(), locale: string = "de-DE"): ChipState {
  const lc = lifecycleFor(meal, now);
  const created = parseDbDate(meal.meal_time ?? meal.created_at).getTime();

  if (lc.state === "pending") {
    const expected1h = fmtTime(created + 60 * 60_000, locale);
    return {
      state: "pending",
      color: PENDING_COLOR,
      label: { key: "engine_chip_pending_label" },
      body: [{ key: "engine_chip_pending_body", params: { expected: expected1h } }],
      lc,
    };
  }

  if (lc.state === "provisional") {
    const expected2h = fmtTime(created + 120 * 60_000, locale);
    const d1 = lc.delta1;
    const body: AdjustmentMessage[] = [];

    if (d1 != null && meal.bg_1h != null) {
      body.push({
        key: "engine_chip_provisional_1h",
        params: { bg1h: meal.bg_1h, delta: `${d1 > 0 ? "+" : ""}${d1}` },
      });
    }
    body.push({ key: "engine_chip_provisional_wait_2h", params: { expected: expected2h } });
    body.push({ key: "engine_chip_provisional_note" });

    let trendHint: AdjustmentMessage = { key: "engine_chip_trend_stable" };
    if (d1 != null) {
      if (d1 > 30) trendHint = { key: "engine_chip_trend_rising" };
      else if (d1 < -30) trendHint = { key: "engine_chip_trend_falling" };
    }

    return {
      state: "provisional",
      color: PROVISIONAL_COLOR,
      label: { key: "engine_chip_provisional_label" },
      body,
      trendHint,
      lc,
    };
  }

  // Final: prefer freshly computed lc.outcome over cached meal.evaluation.
  const outcome = lc.outcome ?? meal.evaluation;
  return {
    state: "final",
    color: getEvalColor(outcome),
    // Final state still surfaces the localized outcome label via
    // `finalOutcomeLabel` for callers that want a quick string; the
    // `label` message is a marker key consumers can ignore in favour of
    // the cached label.
    label: { key: "engine_chip_final_label" },
    finalOutcomeLabel: getEvalLabel(outcome),
    body: lc.messages,
    lc,
  };
}
