/**
 * Feature-Tier-Definitionen für Glev.
 *
 * Vier Zugangsstufen:
 *   "all"   — verfügbar für jeden (Free, Smart/Beta, Pro, Plus, aktiver Trial)
 *   "smart" — ab Plan S (Glev Smart) + Pro + Plus + aktiver Free-Trial
 *   "pro"   — ab Plan M (Glev Pro) + Plan L (Glev+) + aktiver Free-Trial
 *   "plus"  — nur Plan L (Glev+)
 *
 * canAccess() ist die einzige Stelle, die diese Tiers auswertet.
 * UI-Komponenten importieren nur canAccess() — nie direkt dieses Record.
 *
 * Plan-Mapping (Stand 2026-05-27):
 *   "free"  = kein Abo (inkl. abgelaufener Trial)
 *   "beta"  = Glev Smart (S, €9/Mo) — Early-Access-Tier
 *   "pro"   = Glev Pro (M, €14,90/Mo)
 *   "plus"  = Glev+ (L, €29/Mo)
 *
 * Trial-Logik:
 *   "free" + trialActive=true → Pro-Level-Zugang (alle Features bis inkl. "pro")
 *   D-023: kein eigener Plan-Typ für Trial in computeEffectivePlan.
 */

import type { EffectivePlan } from "@/lib/admin/effectivePlan";

export type FeatureTier = "all" | "smart" | "pro" | "plus";

/**
 * Kanonische Feature-Keys.
 * Jeder Key entspricht genau einer Zeile im Feature-Table (replit.md / Pricing-Seite).
 */
export const FEATURE_TIERS: Record<string, FeatureTier> = {
  // ── Alle Pläne ──────────────────────────────────────────────────────────
  meal_log_voice:          "all",
  meal_log_manual:         "all",
  insulin_log:             "all",
  fingerstick_bz:          "all",
  activity_log:            "all",
  symptoms_log:            "all",
  cycle_tracking:          "all",
  dashboard_basic:         "all",
  food_memory:             "all",
  history_60d:             "all",

  // ── Ab Plan S (Smart + Pro + Plus + aktiver Trial) ───────────────────────
  cgm_sync:                "smart",
  apple_health_sync:       "smart",
  cgm_autofill:            "smart",
  hypo_warning:            "smart",

  // ── Ab Plan M (Pro + Plus + aktiver Trial) ───────────────────────────────
  hba1c_gmi:               "pro",
  tir_analysis:            "pro",
  control_score:           "pro",
  trends_variability:      "pro",
  meal_type_breakdown:     "pro",
  meal_bz_rating:          "pro",
  engine_bolus_suggestion: "pro",
  adaptive_icr:            "pro",
  bz_pattern_recognition:  "pro",
  settings_tips:           "pro",
  auto_apply_icr:          "pro",
  icr_by_daytime:          "pro",
  custom_target_range:     "pro",
  google_sheets_import:    "pro",
  history_90d:             "pro",
  founder_direct_line:     "pro",

  // ── Nur Plan L (Plus) ────────────────────────────────────────────────────
  caregiver_view:          "plus",
  push_alarm_contacts:     "plus",
  pdf_report:              "plus",
  csv_export:              "plus",
  doctor_appointment_tracker: "plus",
  since_last_appointment:  "plus",
  unlimited_history:       "plus",
  early_feature_access:    "plus",
};

/**
 * Gibt zurück ob ein User mit dem gegebenen Plan + Trial-Status auf ein
 * Feature zugreifen darf.
 *
 * @param feature    Ein Key aus FEATURE_TIERS. Unbekannte Keys → true (fail-open).
 * @param plan       Das Ergebnis von computeEffectivePlan().
 * @param trialActive  true wenn profiles.trial_end_at in der Zukunft liegt.
 */
export function canAccess(
  feature: string,
  plan: EffectivePlan,
  trialActive: boolean,
): boolean {
  const tier = FEATURE_TIERS[feature];
  if (!tier) return true; // unbekanntes Feature → kein Gate

  // Während aktivem Trial: Pro-Level-Zugang (D-023)
  const effectivePlan: EffectivePlan =
    plan === "free" && trialActive ? "pro" : plan;

  switch (tier) {
    case "all":
      return true;
    case "smart":
      return (
        effectivePlan === "beta" ||
        effectivePlan === "pro" ||
        effectivePlan === "plus"
      );
    case "pro":
      return effectivePlan === "pro" || effectivePlan === "plus";
    case "plus":
      return effectivePlan === "plus";
    default:
      return false;
  }
}

/**
 * Gibt die minimale Plan-Bezeichnung für einen Feature-Tier zurück —
 * nützlich für Upgrade-Hinweise in der UI.
 */
export function requiredPlanLabel(tier: FeatureTier): string {
  if (tier === "smart") return "Glev Smart";
  if (tier === "pro")   return "Glev Pro";
  if (tier === "plus")  return "Glev+";
  return "";
}
