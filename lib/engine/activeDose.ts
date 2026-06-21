/**
 * resolveActiveDose — pure function extracted from the engine page's
 * `activeDose` useMemo so it can be unit-tested without a browser.
 *
 * Priority chain:
 *   1. manualDose (user override) — if non-empty, finite, and >= 0
 *   2. result.dose (engine run result) — only when resultICRSource matches selectedICR
 *   3. eagerDoses[selectedICR] — instant ICR-based estimate before/after a run
 *
 * IOB correction is applied to cases 2 and 3 via `applyIOBCorrection`.
 * manualDose is returned as-is (the user typed the final number intentionally).
 */

import { applyIOBCorrection } from "@/lib/iob";

export function resolveActiveDose(
  result: { dose: number } | null,
  resultICRSource: "adaptive" | "static" | null,
  selectedICR: "adaptive" | "static",
  eagerDoses: { adaptive: number | null; static: number | null },
  manualDose: string,
  iob: number
): number | null {
  const manualNum = parseFloat(manualDose.replace(",", "."));
  if (manualDose.trim() !== "" && Number.isFinite(manualNum) && manualNum >= 0) {
    return manualNum;
  }

  if (result && resultICRSource === selectedICR) {
    return applyIOBCorrection(result.dose, iob);
  }

  const rawEager = selectedICR === "adaptive" ? eagerDoses.adaptive : eagerDoses.static;
  return rawEager !== null ? applyIOBCorrection(rawEager, iob) : null;
}
