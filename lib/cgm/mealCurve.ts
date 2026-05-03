/**
 * Pure helpers for the meal-glucose-samples curve introduced by
 * Task #187. Kept separate from the route so they can be unit-tested
 * without spinning up Supabase / Next handlers.
 */

export interface MealSample {
  t_offset_min: number;
  value_mgdl: number;
}

export interface DerivedCurveFields {
  min_bg_180: number | null;
  max_bg_180: number | null;
  time_to_peak_min: number | null;
  auc_180: number | null;
  had_hypo_window: boolean | null;
  min_bg_60_180: number | null;
}

/** Hypoglycemia threshold (mg/dL). */
export const HYPO_THRESHOLD = 70;

/**
 * Compute the window-level aggregates the engine reads as inputs.
 * Returns all-null if the sample set is empty (caller can leave the
 * derived columns untouched). AUC is integrated via the trapezoidal
 * rule across the (sorted) sample set in mg/dL · min.
 */
export function computeDerivedCurveFields(samples: MealSample[]): DerivedCurveFields {
  if (!samples.length) {
    return {
      min_bg_180: null, max_bg_180: null, time_to_peak_min: null,
      auc_180: null, had_hypo_window: null, min_bg_60_180: null,
    };
  }
  const sorted = [...samples].sort((a, b) => a.t_offset_min - b.t_offset_min);
  let min = Infinity, max = -Infinity, peakAt = sorted[0].t_offset_min;
  let min60 = Infinity, hadHypo = false;
  for (const s of sorted) {
    if (s.value_mgdl < min) min = s.value_mgdl;
    if (s.value_mgdl > max) { max = s.value_mgdl; peakAt = s.t_offset_min; }
    if (s.value_mgdl < HYPO_THRESHOLD) hadHypo = true;
    if (s.t_offset_min >= 60 && s.t_offset_min <= 180 && s.value_mgdl < min60) {
      min60 = s.value_mgdl;
    }
  }
  // Trapezoidal AUC across the sorted sample set (mg/dL · min).
  let auc = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].t_offset_min - sorted[i - 1].t_offset_min;
    auc += ((sorted[i].value_mgdl + sorted[i - 1].value_mgdl) / 2) * dt;
  }
  return {
    min_bg_180:        min === Infinity  ? null : min,
    max_bg_180:        max === -Infinity ? null : max,
    time_to_peak_min:  peakAt,
    auc_180:           Math.round(auc * 100) / 100,
    had_hypo_window:   hadHypo,
    min_bg_60_180:     min60 === Infinity ? null : min60,
  };
}

/**
 * Pick the nearest sample to `targetMin` within `±toleranceMin` minutes.
 * Used to populate the legacy `bg_1h` / `bg_2h` columns from the curve
 * so existing UI / PDF / export paths keep working. Returns null when
 * no sample falls inside the tolerance window.
 */
export function pickSlotValue(
  samples: MealSample[],
  targetMin: number,
  toleranceMin = 15,
): MealSample | null {
  let best: MealSample | null = null;
  let bestDiff = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.t_offset_min - targetMin);
    if (d <= toleranceMin && d < bestDiff) {
      best = s;
      bestDiff = d;
    }
  }
  return best;
}
