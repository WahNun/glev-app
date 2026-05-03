/**
 * Trend-Klassifikator für Pre-Meal-CGM-Bewegung (Task #195).
 *
 * Reine Hilfsfunktion: nimmt eine Handvoll CGM-Samples (3–5 ist der
 * Sweet Spot für Libre's 1/min-Sampling der letzten 15 min) und liefert
 * eine Trend-Klassifikation auf Basis der mittleren Steigung
 * (mg/dL pro Minute), berechnet via einfacher linearer Regression.
 *
 * Schwellen (sym­metrisch um 0):
 *   |slope| > 1.5 mg/dL/min   → rising_fast / falling_fast
 *   |slope| > 0.5 mg/dL/min   → rising / falling
 *   sonst                       stable
 *
 * Liefert `null`, wenn weniger als 3 valide Samples vorliegen oder die
 * Zeitspanne 0 ist — dann hat die aufrufende Engine schlicht keine
 * Trend-Information und rendert auch keinen Trend-Satz.
 */

export type TrendClass = "rising_fast" | "rising" | "stable" | "falling" | "falling_fast";

export interface TrendSample {
  value: number | null;
  timestamp: string | null;
}

export interface TrendResult {
  trend: TrendClass;
  /** mg/dL pro Minute, gerundet auf 2 Nachkommastellen. */
  slope: number;
  /** Anzahl Samples, die in die Regression eingegangen sind. */
  samples: number;
}

const FAST_THRESHOLD = 1.5;
const SLOW_THRESHOLD = 0.5;

interface Point { t: number; v: number; }

function toPoints(samples: readonly TrendSample[]): Point[] {
  const pts: Point[] = [];
  for (const s of samples) {
    if (s.value == null || !Number.isFinite(s.value)) continue;
    if (!s.timestamp) continue;
    const t = Date.parse(s.timestamp);
    if (!Number.isFinite(t)) continue;
    pts.push({ t, v: s.value });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

/**
 * Lineare Regression der Form v = m*t + b. Liefert die Steigung `m` in
 * mg/dL pro Minute. Erwartet ≥ 2 Punkte mit Streuung in `t`; sonst NaN.
 */
function slopeMgPerMin(pts: Point[]): number {
  const n = pts.length;
  if (n < 2) return Number.NaN;
  let sumT = 0, sumV = 0, sumTV = 0, sumTT = 0;
  for (const p of pts) {
    const tMin = p.t / 60_000;
    sumT  += tMin;
    sumV  += p.v;
    sumTV += tMin * p.v;
    sumTT += tMin * tMin;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return Number.NaN;
  return (n * sumTV - sumT * sumV) / denom;
}

export function classifyTrend(samples: readonly TrendSample[]): TrendResult | null {
  const pts = toPoints(samples);
  if (pts.length < 3) return null;
  const m = slopeMgPerMin(pts);
  if (!Number.isFinite(m)) return null;
  let trend: TrendClass;
  if      (m >  FAST_THRESHOLD) trend = "rising_fast";
  else if (m >  SLOW_THRESHOLD) trend = "rising";
  else if (m < -FAST_THRESHOLD) trend = "falling_fast";
  else if (m < -SLOW_THRESHOLD) trend = "falling";
  else                          trend = "stable";
  return { trend, slope: Math.round(m * 100) / 100, samples: pts.length };
}

/**
 * Auswahl der für die Klassifikation relevanten Pre-Reference-Samples.
 * Behält nur Samples mit gültigem Wert + Zeitstempel STRIKT vor
 * `referenceMs`, beschränkt auf die letzten `windowMin` Minuten und
 * die letzten `maxCount` (Default 5) — das matched die im Task
 * geforderten "letzten 3–5 CGM-Samples vor dem Bezugszeitpunkt".
 *
 * Pure: liefert eine neue, nach Zeit aufsteigend sortierte Liste.
 */
export function selectPreReferenceSamples(
  samples: readonly TrendSample[],
  referenceMs: number,
  windowMin = 15,
  maxCount = 5,
): TrendSample[] {
  const cutoffMs = referenceMs - windowMin * 60_000;
  const filtered: { v: number; t: number; iso: string }[] = [];
  for (const s of samples) {
    if (s.value == null || !Number.isFinite(s.value)) continue;
    if (!s.timestamp) continue;
    const t = Date.parse(s.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t >= referenceMs) continue;
    if (t < cutoffMs) continue;
    filtered.push({ v: s.value, t, iso: s.timestamp });
  }
  filtered.sort((a, b) => a.t - b.t);
  const sliced = filtered.slice(-maxCount);
  return sliced.map(p => ({ value: p.v, timestamp: p.iso }));
}

/**
 * Bequemlichkeits-Wrapper, der `selectPreReferenceSamples` und
 * `classifyTrend` koppelt — die Form, in der die Engine-Seite und
 * die Lifecycle-Pipeline den Trend brauchen.
 */
export function classifyPreReferenceTrend(
  samples: readonly TrendSample[],
  referenceMs: number,
  windowMin = 15,
  maxCount = 5,
): TrendResult | null {
  return classifyTrend(selectPreReferenceSamples(samples, referenceMs, windowMin, maxCount));
}
