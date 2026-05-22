export type InsulinType = 'rapid' | 'regular' | 'unknown';

/** Minimal shape of an insulin log entry needed by buildDoses. */
export interface InsulinLike {
  id?: string;
  insulin_type: string;
  units: number;
  created_at: string;
  related_entry_id?: string | null;
  /** Display name for the popover (e.g. "Novorapid"). Optional — used only for UI. */
  insulin_name?: string;
}

/** Minimal shape of a meal entry needed by buildDoses. */
export interface MealLike {
  id: string;
  insulin_units?: number | null;
  meal_time?: string | null;
  created_at: string;
  /** Short description for the popover. Optional — used only for UI. */
  input_text?: string;
}

export function getDIAMinutes(insulinType: InsulinType): number {
  switch (insulinType) {
    case 'rapid':   return 180;
    case 'regular': return 300;
    default:        return 180;
  }
}

export interface BolusDose {
  units: number;
  administeredAt: string;
  /** 'insulin' = from an explicit insulin log; 'meal' = inferred from meal.insulin_units */
  source?: 'insulin' | 'meal';
  /** Human-readable label: insulin_name for boluses, first ~30 chars of input_text for meals */
  label?: string;
  /** For meal-sourced doses: the originating meal's UUID. Used to deep-link into /entries#<mealId>. */
  mealId?: string;
  /** For insulin-log-sourced doses: the insulin_log UUID. Used to deep-link into /entries#insulin-<id>. */
  insulinLogId?: string;
}

export function calcSingleIOB(dose: BolusDose, nowMs: number, diaMinutes: number): number {
  if (!dose.units || dose.units <= 0) return 0;
  const elapsedMin = (nowMs - new Date(dose.administeredAt).getTime()) / 60_000;
  if (elapsedMin < 0) return 0;
  if (elapsedMin >= diaMinutes) return 0;
  const ratio = elapsedMin / diaMinutes;
  return dose.units * Math.pow(1 - ratio, 2);
}

export function calcTotalIOB(
  doses: BolusDose[],
  insulinType: InsulinType = 'unknown',
  nowMs = Date.now()
): number {
  const diaMinutes = getDIAMinutes(insulinType);
  const total = doses.reduce(
    (sum, dose) => sum + calcSingleIOB(dose, nowMs, diaMinutes),
    0
  );
  return Math.round(total * 100) / 100;
}

/**
 * Pure function that builds the combined BolusDose list from insulin logs
 * and meal insulin_units, deduplicating meals that are already linked via a
 * bolus log's `related_entry_id` to prevent double-counting.
 *
 * Extracted from IOBCard.tsx so it can be unit-tested independently of React.
 */
export function buildDoses(
  insulin: InsulinLike[],
  meals?: MealLike[],
): BolusDose[] {
  const result: BolusDose[] = [];
  const linkedMealIds = new Set(
    insulin
      .filter(l => l.related_entry_id)
      .map(l => l.related_entry_id as string),
  );
  for (const l of insulin) {
    if (l.insulin_type === 'bolus' && l.units > 0) {
      result.push({
        units: l.units,
        administeredAt: l.created_at,
        source: 'insulin',
        label: l.insulin_name ?? 'Manual bolus',
        insulinLogId: l.id,
      });
    }
  }
  if (meals) {
    for (const m of meals) {
      if ((m.insulin_units ?? 0) > 0 && !linkedMealIds.has(m.id)) {
        const rawLabel = m.input_text?.trim();
        result.push({
          units: m.insulin_units!,
          administeredAt: m.meal_time ?? m.created_at,
          source: 'meal',
          label: rawLabel && rawLabel.length > 30
            ? rawLabel.slice(0, 28) + '…'
            : rawLabel,
          mealId: m.id,
        });
      }
    }
  }
  return result;
}

/**
 * Returns the subset of doses that still have active IOB at the given
 * sample time — i.e. the dose was already given AND hasn't fully decayed yet.
 * Used by the peak-marker popover to show which doses caused a spike.
 */
export function getActiveDosesAtTime(
  doses: BolusDose[],
  tMs: number,
  diaMin: number,
): BolusDose[] {
  return doses.filter(d => {
    const doseMs = new Date(d.administeredAt).getTime();
    const elapsedMin = (tMs - doseMs) / 60_000;
    return elapsedMin >= 0 && elapsedMin < diaMin;
  });
}

export interface IOBSample {
  tMs: number;
  iob: number;
}

/**
 * Builds a historical IOB timeline by sampling total active insulin at
 * regular `intervalMin`-minute intervals over the past `hours` hours.
 *
 * Key invariant: doses that have not yet been administered at a given sample
 * time contribute ZERO IOB — even though `calcSingleIOB` returns `dose.units`
 * for elapsedMin ≤ 0 (that branch is correct for forward-looking predictions
 * but wrong for historical reconstruction).  We guard explicitly here so the
 * timeline is physiologically accurate.
 */
export function buildIOBHistory(
  doses: BolusDose[],
  diaMin: number,
  hours: number,
  nowMs: number,
  intervalMin = 15,
): IOBSample[] {
  const steps = Math.round((hours * 60) / intervalMin);
  const startMs = nowMs - hours * 60 * 60_000;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const tMs = startMs + (i / steps) * (nowMs - startMs);
    const iob = doses.reduce((sum, d) => {
      const doseTimeMs = new Date(d.administeredAt).getTime();
      // Skip doses that haven't been administered yet at this sample time.
      if (tMs < doseTimeMs) return sum;
      return sum + calcSingleIOB(d, tMs, diaMin);
    }, 0);
    return { tMs, iob: Math.round(iob * 100) / 100 };
  });
}

/**
 * A detected local-maximum in an IOB timeline.
 */
export interface IOBPeak {
  iob: number;
  tMs: number;
}

/**
 * Detects local-maximum peaks in an IOB sample array.
 *
 * A sample qualifies as a peak when:
 *   - it is strictly greater than both its immediate neighbours, AND
 *   - its value exceeds the lower of the two neighbours by at least 0.5 IE
 *     (suppresses minor bumps on a long plateau).
 *
 * At most 3 peaks are returned, ranked by descending IOB value.
 * Samples at index 0 and the last index can never be peaks.
 */
export function detectIOBPeaks(samples: IOBSample[]): IOBPeak[] {
  if (samples.length < 3) return [];
  const found: IOBPeak[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const cur  = samples[i].iob;
    const prev = samples[i - 1].iob;
    const next = samples[i + 1].iob;
    if (cur > prev && cur > next && cur - Math.min(prev, next) >= 0.5) {
      found.push({ iob: cur, tMs: samples[i].tMs });
    }
  }
  return found.sort((a, b) => b.iob - a.iob).slice(0, 3);
}

export function applyIOBCorrection(recommendation: number, iob: number): number {
  return Math.max(0, Math.round((recommendation - iob) * 10) / 10);
}

/**
 * Returns true when `applyIOBCorrection` produces 0 because the pre-rounding
 * result (recommendation − iob) is positive but smaller than 0.05 — i.e. the
 * algorithm computed a real, non-zero suggestion that was silently lost to
 * rounding rather than being zeroed out by the Math.max(0, …) clamp.
 *
 * Use this in the UI to show a brief note like
 * "Recommendation < 0.1 u — no bolus needed" so users understand why they
 * see no dose suggestion.
 */
export function iobCorrectionRoundedToZero(recommendation: number, iob: number): boolean {
  const raw = recommendation - iob;
  return raw > 0 && applyIOBCorrection(recommendation, iob) === 0;
}

export function formatIOBDisplay(iob: number): string | null {
  if (iob < 0.05) return null;
  return `${iob.toFixed(1)} IE`;
}
