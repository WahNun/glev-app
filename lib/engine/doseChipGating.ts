/**
 * shouldShowBothChips — pure gate deciding whether the Engine renders
 * TWO ICR chips (Adaptiv + Fixwert) side by side or collapses to one.
 *
 * Two chips are shown only when BOTH conditions hold:
 *   1. Enough historical data: icrSampleSize >= 3
 *   2. The ICR values differ meaningfully: |adaptedICR − staticICR| > 0.5
 *   3. When both doses are calculable: the doses also differ by >= 0.2 IE
 *      (prevents confusing identical numbers after rounding, e.g. both
 *      showing "1.3 IE" for 10g carbs and ICRs of 7.5 vs 8.0).
 *
 * When either dose is null (no carbs / BG not yet entered), condition 3
 * is waived — we show both chips based on the ICR diff alone, since the
 * chips are also ICR-source selectors, not just dose displays.
 */
export function shouldShowBothChips(opts: {
  icrSampleSize: number;
  adaptedICR: number;
  staticICR: number;
  /** Eager dose for the adaptive ICR, or null if not yet calculable. */
  adaptiveDose: number | null;
  /** Eager dose for the static ICR, or null if not yet calculable. */
  staticDose: number | null;
}): boolean {
  if (opts.icrSampleSize < 3) return false;
  if (Math.abs(opts.adaptedICR - opts.staticICR) <= 0.5) return false;

  if (opts.adaptiveDose != null && opts.staticDose != null) {
    return Math.abs(opts.adaptiveDose - opts.staticDose) >= 0.2;
  }

  return true;
}
