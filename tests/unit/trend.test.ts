// Trend-Klassifikator (Task #195) — `lib/engine/trend.classifyTrend`.
//
// Lockt die Schwellen ±0.5 / ±1.5 mg/dL/min sowie das Verhalten bei
// degenerierten Inputs (zu wenige Samples, alle Werte null, identische
// Zeitstempel) fest. Die Pre-Meal-Trend-Annotation der Engine hängt an
// genau diesen Klassen.

import { test, expect } from "@playwright/test";

import {
  classifyTrend,
  classifyPreReferenceTrend,
  selectPreReferenceSamples,
  type TrendSample,
} from "@/lib/engine/trend";

function samplesAt(values: number[], stepMin = 5, startIso = "2026-04-30T07:45:00Z"): TrendSample[] {
  const startMs = Date.parse(startIso);
  return values.map((v, i) => ({
    value: v,
    timestamp: new Date(startMs + i * stepMin * 60_000).toISOString(),
  }));
}

test("classifyTrend: stable BG (drift < 0.5 mg/dL/min) → stable", () => {
  // 100 → 102 → 104 in 15 min = 0.27 mg/dL/min.
  const r = classifyTrend(samplesAt([100, 102, 104, 103, 105]));
  expect(r?.trend).toBe("stable");
});

test("classifyTrend: gentle rise (>0.5 mg/dL/min) → rising", () => {
  // 100 → 105 → 110 → 115 in 15 min = 1.0 mg/dL/min.
  const r = classifyTrend(samplesAt([100, 105, 110, 115]));
  expect(r?.trend).toBe("rising");
});

test("classifyTrend: rapid rise (>1.5 mg/dL/min) → rising_fast", () => {
  // 90 → 110 → 130 in 10 min = 4.0 mg/dL/min.
  const r = classifyTrend(samplesAt([90, 110, 130], 5));
  expect(r?.trend).toBe("rising_fast");
});

test("classifyTrend: gentle fall (>-0.5 mg/dL/min) → falling", () => {
  const r = classifyTrend(samplesAt([130, 125, 120, 115]));
  expect(r?.trend).toBe("falling");
});

test("classifyTrend: rapid fall (<-1.5 mg/dL/min) → falling_fast", () => {
  // 170 → 150 → 130 in 10 min = -4.0 mg/dL/min.
  const r = classifyTrend(samplesAt([170, 150, 130], 5));
  expect(r?.trend).toBe("falling_fast");
});

test("classifyTrend: < 3 valid samples → null (no trend info)", () => {
  expect(classifyTrend(samplesAt([100, 110]))).toBeNull();
  expect(classifyTrend([])).toBeNull();
});

test("classifyTrend: nullable values + missing timestamps are filtered", () => {
  const mixed: TrendSample[] = [
    { value: null, timestamp: "2026-04-30T07:45:00Z" },
    { value: 100, timestamp: null },
    { value: 100, timestamp: "2026-04-30T07:50:00Z" },
    { value: 110, timestamp: "2026-04-30T07:55:00Z" },
    { value: 120, timestamp: "2026-04-30T08:00:00Z" },
  ];
  const r = classifyTrend(mixed);
  // 3 valid points, +2 mg/dL/min slope → rising_fast.
  expect(r?.trend).toBe("rising_fast");
  expect(r?.samples).toBe(3);
});

test("classifyTrend: identical timestamps → null (cannot solve regression)", () => {
  const same: TrendSample[] = [
    { value: 100, timestamp: "2026-04-30T07:50:00Z" },
    { value: 110, timestamp: "2026-04-30T07:50:00Z" },
    { value: 120, timestamp: "2026-04-30T07:50:00Z" },
  ];
  expect(classifyTrend(same)).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────
// Pre-reference slicing (Task #195) — die Engine ruft den Trend pro
// Empfehlung gegen die jeweilige Bezugszeit (mealTime oder meal_time
// der bestätigten Mahlzeit) auf. Diese Tests sperren das Verhalten so
// fest, dass derselbe Sample-Stream je nach Bezugszeit eine andere
// Klasse liefert — sonst würde ein einmal beim Mount berechneter Trend
// stehen bleiben.
// ─────────────────────────────────────────────────────────────────────────

test("selectPreReferenceSamples: drops samples after referenceMs and outside 15-min window", () => {
  // 6 Samples im 5-min-Raster: 07:30, 07:35, 07:40, 07:45, 07:50, 07:55.
  const all = samplesAt([90, 95, 100, 105, 110, 115], 5, "2026-04-30T07:30:00Z");
  const ref = Date.parse("2026-04-30T07:50:00Z"); // strict <
  const sliced = selectPreReferenceSamples(all, ref);
  // Erwartet: 07:35, 07:40, 07:45 (07:30 fällt aus dem 15-min-Fenster,
  // 07:50/07:55 liegen ≥ ref).
  expect(sliced.map(s => s.timestamp)).toEqual([
    "2026-04-30T07:35:00.000Z",
    "2026-04-30T07:40:00.000Z",
    "2026-04-30T07:45:00.000Z",
  ]);
});

test("selectPreReferenceSamples: keeps only the last 5 samples within window", () => {
  // 7 Samples im 2-min-Raster, alle innerhalb von 15 min vor 08:00.
  const all = samplesAt([100, 102, 104, 106, 108, 110, 112], 2, "2026-04-30T07:46:00Z");
  const ref = Date.parse("2026-04-30T08:00:00Z");
  const sliced = selectPreReferenceSamples(all, ref);
  expect(sliced).toHaveLength(5);
  expect(sliced[0]?.value).toBe(104);
  expect(sliced[4]?.value).toBe(112);
});

test("classifyPreReferenceTrend: same samples, different reference time → different class", () => {
  // Sample-Stream: erst 5 min flach (100, 100, 100), dann steiler Anstieg
  // (110, 130). Wer die Bezugszeit VOR dem Anstieg setzt, sieht "stable".
  // Wer sie danach setzt, sieht "rising_fast".
  const stream = samplesAt([100, 100, 100, 110, 130], 5, "2026-04-30T07:30:00Z");
  // Samples bei 07:30, 07:35, 07:40, 07:45, 07:50.
  const earlyRef = Date.parse("2026-04-30T07:43:00Z");
  const lateRef  = Date.parse("2026-04-30T07:55:00Z");
  const early = classifyPreReferenceTrend(stream, earlyRef);
  const late  = classifyPreReferenceTrend(stream, lateRef);
  expect(early?.trend).toBe("stable");
  expect(late?.trend).toBe("rising_fast");
});

test("classifyPreReferenceTrend: returns null when fewer than 3 samples lie before reference", () => {
  const stream = samplesAt([100, 105, 110, 115], 5, "2026-04-30T07:50:00Z");
  // Nur 07:50 liegt strict-vor 07:51 → 1 Sample → null.
  const ref = Date.parse("2026-04-30T07:51:00Z");
  expect(classifyPreReferenceTrend(stream, ref)).toBeNull();
});
