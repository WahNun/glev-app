export type InsulinType = 'rapid' | 'regular' | 'unknown';

/** Minimal shape of an insulin log entry needed by buildDoses. */
export interface InsulinLike {
  insulin_type: string;
  units: number;
  created_at: string;
  related_entry_id?: string | null;
}

/** Minimal shape of a meal entry needed by buildDoses. */
export interface MealLike {
  id: string;
  insulin_units?: number | null;
  meal_time?: string | null;
  created_at: string;
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
}

export function calcSingleIOB(dose: BolusDose, nowMs: number, diaMinutes: number): number {
  if (!dose.units || dose.units <= 0) return 0;
  const elapsedMin = (nowMs - new Date(dose.administeredAt).getTime()) / 60_000;
  if (elapsedMin <= 0) return dose.units;
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
      result.push({ units: l.units, administeredAt: l.created_at });
    }
  }
  if (meals) {
    for (const m of meals) {
      if ((m.insulin_units ?? 0) > 0 && !linkedMealIds.has(m.id)) {
        result.push({
          units: m.insulin_units!,
          administeredAt: m.meal_time ?? m.created_at,
        });
      }
    }
  }
  return result;
}

export function applyIOBCorrection(recommendation: number, iob: number): number {
  return Math.max(0, Math.round((recommendation - iob) * 10) / 10);
}

export function formatIOBDisplay(iob: number): string | null {
  if (iob < 0.05) return null;
  return `${iob.toFixed(1)} IE`;
}
