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
