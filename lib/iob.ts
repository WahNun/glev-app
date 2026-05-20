export type InsulinType = 'rapid' | 'regular' | 'unknown';

export function getDIAMinutes(insulinType: InsulinType): number {
  switch (insulinType) {
    case 'rapid':   return 180;
    case 'regular': return 300;
    default:        return 180;
  }
}

export interface BolusDose {
  units: number;
  administeredAt: string;
}

export function calcSingleIOB(dose: BolusDose, nowMs: number, diaMinutes: number): number {
  if (!dose.units || dose.units <= 0) return 0;
  const elapsedMin = (nowMs - new Date(dose.administeredAt).getTime()) / 60_000;
  if (elapsedMin <= 0) return dose.units;
  if (elapsedMin >= diaMinutes) return 0;
  const ratio = elapsedMin / diaMinutes;
  return dose.units * Math.pow(1 - ratio, 2);
}

export function calcTotalIOB(
  doses: BolusDose[],
  insulinType: InsulinType = 'unknown',
  nowMs = Date.now()
): number {
  const diaMinutes = getDIAMinutes(insulinType);
  const total = doses.reduce(
    (sum, dose) => sum + calcSingleIOB(dose, nowMs, diaMinutes),
    0
  );
  return Math.round(total * 100) / 100;
}

export function applyIOBCorrection(recommendation: number, iob: number): number {
  return Math.max(0, Math.round((recommendation - iob) * 10) / 10);
}

export function formatIOBDisplay(iob: number): string | null {
  if (iob < 0.05) return null;
  return `${iob.toFixed(1)} IE`;
}
