/**
 * Feature flags for the Adaptive-ICR engine — read once at module load
 * from NEXT_PUBLIC_* environment variables so both client components and
 * shared lib code resolve the same value without a React hook.
 *
 * Set the variable in your .env.local (dev) or in Vercel Project Settings
 * (production) and redeploy — no code push required.
 */

/**
 * ADAPTIVE_ICR_PAIRING_V2
 *
 * When `true`, callers of `computeAdaptiveICR` fetch the user's 90-day
 * `insulin_logs` and pass them via the `boluses?` parameter so that
 * separately-logged boluses (pre-bolus, correction, split-dose) are
 * paired to meals and folded into the ICR average. Meals with neither
 * a paired bolus nor their own `insulin_units` are excluded from the
 * sample pool (already the legacy behaviour — now explicit + logged).
 * `computeAdaptiveICR` emits a server-visible debug log with pairing
 * statistics whenever this path is active.
 *
 * When `false` (default), the legacy `meal.insulin_units`-only path is
 * preserved and no extra network request is made for the 90-day bolus
 * window. Production rollout is controlled entirely via this flag in
 * Vercel; no code change is required to enable or disable it.
 */
export const ADAPTIVE_ICR_PAIRING_V2: boolean =
  process.env.NEXT_PUBLIC_ADAPTIVE_ICR_PAIRING_V2 === "true";
