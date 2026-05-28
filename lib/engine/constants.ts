/**
 * Shared engine constants — single source of truth for the correction
 * factor, target blood glucose, and insulin-to-carb ratio defaults.
 *
 * Centralised here so `calcEagerDose`, `recommendDose`, and
 * `getInsulinSettings` / `DEFAULT_INSULIN_SETTINGS` all agree without
 * any silent per-file drift (e.g. DEFAULT_TARGET = 100 vs 110).
 *
 * All values reflect the clinical starting point for a typical T1D
 * adult on ICT (pen) therapy. Users can override every value in
 * Settings → the DB row is always the authoritative source at runtime.
 */

/** Insulin-to-Carbohydrate Ratio default: 1 U covers 15 g of carbs. */
export const DEFAULT_ICR = 15;

/** Correction Factor default: 1 U drops blood glucose by 50 mg/dL. */
export const DEFAULT_CF = 50;

/** Target blood glucose default (mg/dL) used for correction-dose math. */
export const DEFAULT_TARGET_BG = 110;

/**
 * Basal insulin action-window presets (hours).
 *
 * Each entry maps a human-readable brand/type label to the typical
 * duration of action used for the linear-decay Restwert model in
 * IOBCard / calcBasalRemaining. Sources: SmPC / clinical consensus.
 *
 * Key = canonical label shown in Settings UI.
 * Value = typical action window in hours (rounded conservatively).
 */
export const BASAL_WINDOW_PRESETS: Record<string, number> = {
  "Lantus (Glargin U100)":   24,
  "Toujeo (Glargin U300)":   36,
  "Tresiba (Degludec)":      42,
  "Levemir (Detemir)":       20,
  "Basaglar (Glargin U100)": 24,
  "Abasaglar (Glargin)":     24,
  "Semglee (Glargin)":       24,
};

/** Default basal action window in hours (Lantus/Glargin U100 = 24 h). */
export const DEFAULT_BASAL_WINDOW_H = 24;

/**
 * Fraction of the basal action window during which the dose is at full
 * effectiveness (ring stays at 1.0 / full).  After this point the ring
 * begins its visible decay towards empty.
 *
 * Long-acting insulins (Lantus/Glargin, Tresiba/Degludec, Toujeo) have a
 * relatively flat absorption plateau covering roughly the first 60 % of
 * their labelled action window.  The tail decline covers the remaining 40 %.
 * Source: SmPC / ATTD consensus — used as a UX approximation only;
 * not a substitute for clinical guidance.
 *
 * Used as the fallback when the brand is not listed in BASAL_PK_PRESETS.
 */
export const BASAL_PK_PEAK_FRACTION = 0.60;

/**
 * Per-brand plateau fractions for the two-phase basal ring model.
 *
 * Keys must match exactly the labels in BASAL_WINDOW_PRESETS (= the labels
 * shown in Settings → Insulin → Basal brand).
 *
 * Physiological rationale (SmPC / ATTD consensus, UX approximation only):
 *   • Tresiba (Degludec, 42 h)  — extremely flat ultra-long profile; the dose
 *     stays at near-full effectiveness for ~78 % of its window before the
 *     visible tail begins.
 *   • Toujeo (Glargin U300, 36 h) — slightly more extended plateau than U100
 *     due to slower subcutaneous depot dissolution; ~65 %.
 *   • Levemir (Detemir, 20 h) — mild peak around hours 6–10 followed by a
 *     longer tail; plateau covers only ~50 % of the window.
 *   • All Glargin U100 variants (Lantus, Basaglar, Abasaglar, Semglee) — share
 *     the same flat-plateau profile; ~60 % (= global default).
 *
 * Falls back to BASAL_PK_PEAK_FRACTION (0.60) for unknown brands.
 */
export const BASAL_PK_PRESETS: Record<string, number> = {
  "Lantus (Glargin U100)":   0.60,
  "Toujeo (Glargin U300)":   0.65,
  "Tresiba (Degludec)":      0.78,
  "Levemir (Detemir)":       0.50,
  "Basaglar (Glargin U100)": 0.60,
  "Abasaglar (Glargin)":     0.60,
  "Semglee (Glargin)":       0.60,
};
