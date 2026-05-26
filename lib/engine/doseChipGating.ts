/**
 * shouldShowBothChips — pure gate deciding whether the Engine renders
 * TWO ICR chips (Adaptiv + Fixwert) side by side or collapses to one.
 *
 * Both chips are shown whenever:
 *   1. Enough historical data for an adaptive value: icrSampleSize >= 3
 *   2. Both ICR values are available and > 0
 *
 * We no longer suppress based on value similarity — the user explicitly
 * wants to see both options and pick one, even when the numbers are close.
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
  return opts.icrSampleSize >= 3 && opts.adaptedICR > 0 && opts.staticICR > 0;
}
