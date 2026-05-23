/**
 * calcEagerDose — pure function extracted from the engine page's
 * `eagerDoses` useMemo so the carb+correction formula can be
 * unit-tested without a browser.
 *
 * Formula:
 *   carbDose      = cGrams / icr                         (if icr > 0)
 *   correctionDose = (glucoseMgDl - target) / cf         (only when glucoseMgDl > target)
 *   result         = round(carbDose + correctionDose, 1)
 *
 * Returns null when:
 *   - icr is 0 or negative (no valid ratio available)
 *   - there is no meaningful input (cGrams ≤ 0 AND glucose ≤ target)
 *
 * Negative glucose values are clamped to 0 before the target comparison,
 * so they never produce a negative correction dose.
 *
 * @param cGrams      Carbohydrate amount already converted to grams.
 * @param glucoseMgDl Current blood glucose in mg/dL.
 * @param icr         Insulin-to-Carbohydrate Ratio (g carbs per 1 U insulin).
 * @param cf          Correction Factor in mg/dL per 1 U insulin. Default 50.
 * @param target      Target blood glucose in mg/dL. Default 110.
 */
export function calcEagerDose(
  cGrams: number,
  glucoseMgDl: number,
  icr: number,
  cf = 50,
  target = 110
): number | null {
  if (icr <= 0) return null;

  const safeGlucose = Math.max(0, glucoseMgDl);
  const hasInput = cGrams > 0 || safeGlucose > target;
  if (!hasInput) return null;

  const carbDose = cGrams / icr;
  const corrDose = safeGlucose > target ? (safeGlucose - target) / cf : 0;
  return Math.round((carbDose + corrDose) * 10) / 10;
}
