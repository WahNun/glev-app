// Carb-unit constants + conversion helpers for the BE/KE selector.
//
// Background:
//   * 1 BE (Broteinheit)        = 12g KH  → DE / AT standard
//   * 1 KE (Kohlenhydrateinheit) = 10g KH  → CH standard
//   * g (Gramm)                 = 1g KH   → international default
//
// IMPORTANT: The database always stores carbs in grams (meals.carbs_grams)
// and the engine math (carbs / icr) runs in g/IE. These helpers only
// convert at the presentation layer — input -> grams (unitToG) and
// grams -> display (gToUnit / icrToUnit).

export type CarbUnit = "g" | "BE" | "KE";

export const CARB_UNITS: Record<
  CarbUnit,
  { label: string; gPerUnit: number; description: string; step: number; placeholder: string }
> = {
  g: {
    label: "g KH",
    gPerUnit: 1,
    description: "Gramm Kohlenhydrate (international)",
    step: 1,
    placeholder: "z.B. 60",
  },
  BE: {
    label: "BE",
    gPerUnit: 12,
    description: "Broteinheit — 1 BE = 12g KH (Deutschland, Österreich)",
    step: 0.5,
    placeholder: "z.B. 5",
  },
  KE: {
    label: "KE",
    gPerUnit: 10,
    description: "Kohlenhydrateinheit — 1 KE = 10g KH (Schweiz)",
    step: 0.5,
    placeholder: "z.B. 6",
  },
};

export function isCarbUnit(value: unknown): value is CarbUnit {
  return value === "g" || value === "BE" || value === "KE";
}

// Round helper — 0 decimals for grams, 1 decimal for BE/KE so 24g shows
// as "2 BE" cleanly while 25g shows as "2.1 BE".
function round(value: number, unit: CarbUnit): number {
  if (unit === "g") return Math.round(value);
  return Math.round(value * 10) / 10;
}

// Gramm → gewählte Einheit
export function gToUnit(grams: number, unit: CarbUnit): number {
  if (!Number.isFinite(grams)) return 0;
  return round(grams / CARB_UNITS[unit].gPerUnit, unit);
}

// Gewählte Einheit → Gramm (für interne Berechnung / DB-Save)
export function unitToG(value: number, unit: CarbUnit): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * CARB_UNITS[unit].gPerUnit * 10) / 10;
}

// ICR-Anzeige: g/IE → BE/IE oder KE/IE
// Beispiel: 24 g/IE bei BE → 2 BE/IE; 24 g/IE bei KE → 2.4 KE/IE.
export function icrToUnit(icrGperIE: number, unit: CarbUnit): number {
  if (!Number.isFinite(icrGperIE)) return 0;
  return round(icrGperIE / CARB_UNITS[unit].gPerUnit, unit);
}

// BE/IE oder KE/IE → g/IE (für interne Engine-Berechnung)
export function icrFromUnit(icrInUnit: number, unit: CarbUnit): number {
  if (!Number.isFinite(icrInUnit)) return 0;
  return Math.round(icrInUnit * CARB_UNITS[unit].gPerUnit * 10) / 10;
}

// Pretty display: "60 g KH", "5 BE", "6 KE".
export function formatCarbs(grams: number, unit: CarbUnit): string {
  return `${gToUnit(grams, unit)} ${CARB_UNITS[unit].label}`;
}

// Pretty ICR: "24 g KH/IE", "2 BE/IE", "2.4 KE/IE".
export function formatICR(icrGperIE: number, unit: CarbUnit): string {
  return `${icrToUnit(icrGperIE, unit)} ${CARB_UNITS[unit].label}/IE`;
}
