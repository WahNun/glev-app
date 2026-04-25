// lib/insulinEval.ts
import type { InsulinLog } from "./insulin";

/** Five user-facing outcome states for a bolus injection. Basal logs
 *  are NOT scored (they get the expanded view + 6h CGM trend, no badge). */
export type BolusOutcome =
  | "ON_TARGET"
  | "UNDER_CORRECTED"
  | "OVER_CORRECTED"
  | "SPIKED"
  | "PENDING";

const COLORS: Record<BolusOutcome, string> = {
  ON_TARGET:       "#22C55E",
  UNDER_CORRECTED: "#F59E0B",
  OVER_CORRECTED:  "#EF4444",
  SPIKED:          "#F97316",
  PENDING:         "rgba(255,255,255,0.45)",
};

const LABELS: Record<BolusOutcome, string> = {
  ON_TARGET:       "ON TARGET",
  UNDER_CORRECTED: "UNDER CORRECTED",
  OVER_CORRECTED:  "OVER CORRECTED",
  SPIKED:          "SPIKED",
  PENDING:         "PENDING",
};

export const HYPO_THRESHOLD = 70;
export const HIGH_THRESHOLD = 180;
/** Mirrors ABANDON_AFTER_MS for non-exercise jobs in the process route
 *  (1 h past fetch_time → marked failed). The per-reading "Skipped" hint
 *  in the Glucose tracking panel uses this same cutoff. */
export const BOLUS_NO_DATA_AFTER_MS = 60 * 60 * 1000;

/** Significant rise vs baseline that flags meal under-bolusing. */
const SPIKE_DELTA_MGDL = 50;
/** Big drop (without crossing into hypo) that flags over-correction. */
const OVER_CORRECTED_DELTA_MGDL = -100;

export interface BolusOutcomeInfo {
  outcome: BolusOutcome;
  label: string;
  color: string;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Score a bolus log into one of the 5 outcomes.
 *
 * Decision order (the +2h reading is the resolution gate):
 *   1. PENDING precedence — until at_2h is fetched, badge stays PENDING.
 *      The badge keeps reading PENDING even past the 1 h CGM job cutoff;
 *      the per-reading "Skipped" hint surfaces inside the Glucose
 *      tracking panel via {@link bolusPendingLabel}, not on the badge.
 *   2. OVER_CORRECTED — any hypo (<70) at +1h or +2h.
 *   3. Without baseline: only the absolute end value can be judged.
 *      → UNDER_CORRECTED if at_2h > 180, else ON_TARGET.
 *   4. With baseline:
 *      a. SPIKED          — at_2h ≥ baseline + 50  (meal larger than bolus covers)
 *      b. UNDER_CORRECTED — at_2h > 180             (still high, bolus too small)
 *      c. OVER_CORRECTED  — at_2h ≤ baseline − 100  (big drop without hypo)
 *      d. ON_TARGET       — otherwise.
 */
export function evaluateBolus(log: InsulinLog): BolusOutcomeInfo {
  const before = numOrNull(log.cgm_glucose_at_log);
  const at1h   = numOrNull(log.glucose_after_1h);
  const at2h   = numOrNull(log.glucose_after_2h);

  const mk = (o: BolusOutcome): BolusOutcomeInfo => ({
    outcome: o, label: LABELS[o], color: COLORS[o],
  });

  if (at2h == null) return mk("PENDING");

  if (at2h < HYPO_THRESHOLD) return mk("OVER_CORRECTED");
  if (at1h != null && at1h < HYPO_THRESHOLD) return mk("OVER_CORRECTED");

  if (before == null) {
    if (at2h > HIGH_THRESHOLD) return mk("UNDER_CORRECTED");
    return mk("ON_TARGET");
  }

  const delta = at2h - before;
  if (delta >= SPIKE_DELTA_MGDL)        return mk("SPIKED");
  if (at2h > HIGH_THRESHOLD)            return mk("UNDER_CORRECTED");
  if (delta <= OVER_CORRECTED_DELTA_MGDL) return mk("OVER_CORRECTED");
  return mk("ON_TARGET");
}

/** Coloured Δ-pill colour used in the Glucose tracking panel. Mirrors
 *  the bolus outcome thresholds so the visual stays consistent. */
export function bolusDeltaColor(delta: number | null): string {
  if (delta == null) return "rgba(255,255,255,0.45)";
  if (delta >= SPIKE_DELTA_MGDL)          return "#F97316"; // SPIKED
  if (delta <= OVER_CORRECTED_DELTA_MGDL) return "#EF4444"; // OVER_CORRECTED
  if (delta > 15)  return "#F59E0B";                         // mild rise
  if (delta < -50) return "#F59E0B";                         // moderate drop
  return "#22C55E";                                          // stable / good
}

/** Interim copy for the +1h evaluation block (before +2h is in). */
export function bolusInterimMessage(log: InsulinLog): string | null {
  const before = numOrNull(log.cgm_glucose_at_log);
  const at1h   = numOrNull(log.glucose_after_1h);
  if (at1h == null) return null;
  if (before == null) {
    return `Nach 1h: ${Math.round(at1h)} mg/dL. Endauswertung folgt nach 2h.`;
  }
  const d = Math.round(at1h - before);
  const sign = d > 0 ? "+" : "";
  return `Nach 1h: ${Math.round(at1h)} mg/dL (${sign}${d} vs Start). Endauswertung folgt nach 2h.`;
}

/** Final copy for the +2h evaluation block (once at_2h is in). */
export function bolusFinalMessage(log: InsulinLog): string | null {
  const info = evaluateBolus(log);
  if (info.outcome === "PENDING") return null;

  const before = numOrNull(log.cgm_glucose_at_log);
  const at2h   = numOrNull(log.glucose_after_2h);
  const delta  = before != null && at2h != null ? Math.round(at2h - before) : null;
  const at2hTxt = at2h != null ? `${Math.round(at2h)} mg/dL` : "—";

  switch (info.outcome) {
    case "ON_TARGET":
      return `Im Zielbereich nach 2h (${at2hTxt}). Bolus war passend dosiert.`;
    case "UNDER_CORRECTED":
      return `Glucose nach 2h immer noch über 180 mg/dL (${at2hTxt}) — Bolus war zu klein${
        delta != null ? ` (${delta >= 0 ? "+" : ""}${delta} vs Start)` : ""
      }.`;
    case "OVER_CORRECTED":
      return at2h != null && at2h < HYPO_THRESHOLD
        ? `Hypo-Risiko: Glucose unter 70 mg/dL (${at2hTxt}) — Bolus war zu groß oder zu wenig Kohlenhydrate.`
        : `Glucose ist stark gefallen (${at2hTxt}${
            delta != null ? `, ${delta} vs Start` : ""
          }) — Bolus war zu groß.`;
    case "SPIKED":
      return delta != null
        ? `Glucose ist nach 2h um ${delta >= 0 ? "+" : ""}${delta} mg/dL gestiegen (${at2hTxt}) — Mahlzeit war größer als der Bolus abdeckt.`
        : `Glucose ist deutlich gestiegen (${at2hTxt}) — Mahlzeit war größer als der Bolus.`;
  }
}

/** Per-reading "Pending · expected hh:mm" / "Skipped" label inside the
 *  Glucose tracking panel. Mirrors the exercise version but with the
 *  shorter (1 h) bolus job cutoff. */
export function bolusPendingLabel(expectedAt: Date): string {
  if (Date.now() - expectedAt.getTime() > BOLUS_NO_DATA_AFTER_MS) {
    return "Skipped";
  }
  const hh = expectedAt.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  return `Pending · expected ${hh}`;
}
