// Dedicated boundary tests for every Engine threshold documented in
// docs/engine-algorithm.md. The intent is a canary: if a constant is
// changed by even one unit the corresponding test here must fail
// immediately, long before any downstream clinical logic is affected.
//
// Coverage:
//   1. Spike cutoffs — exact boundary (cutoff → UNDERDOSE, cutoff+1 → SPIKE)
//        FAST_CARBS=70, HIGH_FAT=40, HIGH_PROTEIN=50, BALANCED=55
//   2. SPIKE_STRONG escalation
//        magnitude: delta > 1.5×cutoff (boundary at exactly 1.5× vs just above)
//        speed:     speed1 ≥ 2.5 mg/dL/min (2.49 → SPIKE, 2.5 → SPIKE_STRONG)
//   3. BG safety floor — recommendDose blocked when BG=79, not blocked at BG=80
//   4. Dose ceiling — input producing 26u is clamped to 25u; 25u is unchanged
//   5. Confidence bands — sampleSize 4→low, 5→medium, 10→high
//   6. Pattern overdoseRate — boundary at exactly 0.50 (not overdosing) vs above 0.50

import { test, expect } from "@playwright/test";

import { evaluateEntry } from "@/lib/engine/evaluation";
import { recommendDose } from "@/lib/engine/recommendation";
import { detectPattern } from "@/lib/engine/patterns";
import { makeFinalMeal, makeAdaptiveICR } from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";

// ── helpers ──────────────────────────────────────────────────────────

/** Shared bg_before so that delta = bgAfter − 100 exactly. */
const BG_BEFORE = 100;

function evalWith(delta: number, classification: Parameters<typeof evaluateEntry>[0]["classification"]): ReturnType<typeof evaluateEntry> {
  return evaluateEntry({
    carbs: 50,
    insulin: 4,
    bgBefore: BG_BEFORE,
    bgAfter: BG_BEFORE + delta,
    classification,
  });
}

// ── 1. Spike cutoffs — exact boundary ───────────────────────────────
//
// For each meal class the spike cutoff C means:
//   delta = C     → UNDERDOSE   (strict `>` in the source)
//   delta = C + 1 → SPIKE

test("spike cutoff FAST_CARBS=70: delta=70 → UNDERDOSE, delta=71 → SPIKE", () => {
  const at70  = evalWith(70, "FAST_CARBS");
  const at71  = evalWith(71, "FAST_CARBS");

  expect(at70.outcome).toBe("UNDERDOSE");
  expect(at71.outcome).toBe("SPIKE");
});

test("spike cutoff HIGH_FAT=40: delta=40 → UNDERDOSE, delta=41 → SPIKE", () => {
  const at40  = evalWith(40, "HIGH_FAT");
  const at41  = evalWith(41, "HIGH_FAT");

  expect(at40.outcome).toBe("UNDERDOSE");
  expect(at41.outcome).toBe("SPIKE");
});

test("spike cutoff HIGH_PROTEIN=50: delta=50 → UNDERDOSE, delta=51 → SPIKE", () => {
  const at50  = evalWith(50, "HIGH_PROTEIN");
  const at51  = evalWith(51, "HIGH_PROTEIN");

  expect(at50.outcome).toBe("UNDERDOSE");
  expect(at51.outcome).toBe("SPIKE");
});

test("spike cutoff BALANCED=55: delta=55 → UNDERDOSE, delta=56 → SPIKE", () => {
  const at55  = evalWith(55, "BALANCED");
  const at56  = evalWith(56, "BALANCED");

  expect(at55.outcome).toBe("UNDERDOSE");
  expect(at56.outcome).toBe("SPIKE");
});

// ── 2. SPIKE_STRONG magnitude escalation ────────────────────────────
//
// SPIKE_STRONG fires when delta > cutoff × 1.5.
//   BALANCED cutoff=55 → strong threshold=82.5
//   delta=82 → SPIKE   (82 ≤ 82.5, strict `>`)
//   delta=83 → SPIKE_STRONG (83 > 82.5)

test("SPIKE_STRONG magnitude (BALANCED): delta=82 → SPIKE, delta=83 → SPIKE_STRONG", () => {
  const at82 = evalWith(82, "BALANCED");
  const at83 = evalWith(83, "BALANCED");

  expect(at82.outcome).toBe("SPIKE");
  expect(at83.outcome).toBe("SPIKE_STRONG");
});

//   FAST_CARBS cutoff=70 → strong threshold=105
//   delta=105 → SPIKE, delta=106 → SPIKE_STRONG

test("SPIKE_STRONG magnitude (FAST_CARBS): delta=105 → SPIKE, delta=106 → SPIKE_STRONG", () => {
  const at105 = evalWith(105, "FAST_CARBS");
  const at106 = evalWith(106, "FAST_CARBS");

  expect(at105.outcome).toBe("SPIKE");
  expect(at106.outcome).toBe("SPIKE_STRONG");
});

//   HIGH_FAT cutoff=40 → strong threshold=60
//   delta=60 → SPIKE, delta=61 → SPIKE_STRONG

test("SPIKE_STRONG magnitude (HIGH_FAT): delta=60 → SPIKE, delta=61 → SPIKE_STRONG", () => {
  const at60 = evalWith(60, "HIGH_FAT");
  const at61 = evalWith(61, "HIGH_FAT");

  expect(at60.outcome).toBe("SPIKE");
  expect(at61.outcome).toBe("SPIKE_STRONG");
});

//   HIGH_PROTEIN cutoff=50 → strong threshold=75
//   delta=75 → SPIKE, delta=76 → SPIKE_STRONG

test("SPIKE_STRONG magnitude (HIGH_PROTEIN): delta=75 → SPIKE, delta=76 → SPIKE_STRONG", () => {
  const at75 = evalWith(75, "HIGH_PROTEIN");
  const at76 = evalWith(76, "HIGH_PROTEIN");

  expect(at75.outcome).toBe("SPIKE");
  expect(at76.outcome).toBe("SPIKE_STRONG");
});

// ── 3. SPIKE_STRONG speed escalation ────────────────────────────────
//
// Speed trigger for SPIKE: speed1 ≥ 1.5 mg/dL/min
// Speed upgrade to SPIKE_STRONG: speed1 ≥ 2.5 mg/dL/min
//   speed1=2.49 → SPIKE (not SPIKE_STRONG)
//   speed1=2.50 → SPIKE_STRONG

test("SPIKE_STRONG speed: speed1=2.49 → SPIKE, speed1=2.50 → SPIKE_STRONG", () => {
  const common = { carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 };
  const at249 = evaluateEntry({ ...common, speed1: 2.49 });
  const at250 = evaluateEntry({ ...common, speed1: 2.50 });

  expect(at249.outcome).toBe("SPIKE");
  expect(at250.outcome).toBe("SPIKE_STRONG");
});

// Confirm speed2 escalation path uses the same boundary.
test("SPIKE_STRONG speed2: speed2=2.49 → SPIKE, speed2=2.50 → SPIKE_STRONG", () => {
  const common = { carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 };
  const at249 = evaluateEntry({ ...common, speed2: 2.49 });
  const at250 = evaluateEntry({ ...common, speed2: 2.50 });

  expect(at249.outcome).toBe("SPIKE");
  expect(at250.outcome).toBe("SPIKE_STRONG");
});

// ── 4. BG safety floor ───────────────────────────────────────────────
//
// recommendDose must return blocked=true when currentBG < 80 mg/dL.
//   BG=79 → blocked (79 < 80)
//   BG=80 → NOT blocked (80 is not < 80)

const LEARNED_ICR = makeAdaptiveICR({ global: 15, sampleSize: 20 });

test("BG safety floor: BG=79 → blocked=true, dose=0", () => {
  const r = recommendDose({ carbs: 60, currentBG: 79, adaptiveICR: LEARNED_ICR });

  expect(r.blocked).toBe(true);
  expect(r.recommendedUnits).toBe(0);
  expect(r.carbDose).toBe(0);
  expect(r.correctionDose).toBe(0);
  expect(r.confidence).toBe("high");
});

test("BG safety floor: BG=80 → NOT blocked", () => {
  const r = recommendDose({ carbs: 60, currentBG: 80, adaptiveICR: LEARNED_ICR });

  expect(r.blocked).toBe(false);
  expect(r.recommendedUnits).toBeGreaterThan(0);
});

// Guard the off-by-one in both directions:
test("BG safety floor: BG=81 is also NOT blocked", () => {
  const r = recommendDose({ carbs: 60, currentBG: 81, adaptiveICR: LEARNED_ICR });
  expect(r.blocked).toBe(false);
});

// ── 5. Dose ceiling ──────────────────────────────────────────────────
//
// total > 25u is clamped to 25u and flagged with `engine_rec_clamped`.
//   26u input → clamped to 25u
//   25u input → unchanged (no clamp message)

test("dose ceiling: 260g ÷ 10 g/u = 26u is clamped to 25u", () => {
  const r = recommendDose({
    carbs: 260,
    currentBG: 100,
    targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 10, sampleSize: 20 }),
  });

  expect(r.recommendedUnits).toBe(25);
  expect(r.reasoning).toMatch(/Clamped to safety ceiling of 25u/);
});

test("dose ceiling: 250g ÷ 10 g/u = 25u is NOT clamped", () => {
  const r = recommendDose({
    carbs: 250,
    currentBG: 100,
    targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 10, sampleSize: 20 }),
  });

  expect(r.recommendedUnits).toBe(25);
  expect(r.reasoning).not.toMatch(/Clamped/);
});

// ── 6. Confidence bands ──────────────────────────────────────────────
//
// sampleSize < 5  → low
// sampleSize ≥ 5  → medium
// sampleSize ≥ 10 → high
//
// Exact boundary conditions lock in the strict ≥ comparisons.

test("confidence bands: sampleSize=4 → low", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 4 }),
  });
  expect(r.confidence).toBe("low");
});

test("confidence bands: sampleSize=5 → medium (boundary)", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 5 }),
  });
  expect(r.confidence).toBe("medium");
});

test("confidence bands: sampleSize=9 → medium (below high boundary)", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 9 }),
  });
  expect(r.confidence).toBe("medium");
});

test("confidence bands: sampleSize=10 → high (boundary)", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 10 }),
  });
  expect(r.confidence).toBe("high");
});

// ── 7. Pattern overdoseRate boundary ────────────────────────────────
//
// `overdoseRate > 0.50` triggers overdosing (strict `>`).
// We use equal-time meals so time-decay weights cancel out and the
// weighted share equals the raw share exactly.
//
//   10 meals, all same timestamp → each weight identical:
//     5 OVERDOSE + 5 GOOD → rate = 0.50 exactly → balanced
//     6 OVERDOSE + 4 GOOD → rate = 0.60 > 0.50 → overdosing

const NOW = new Date("2026-05-20T12:00:00Z");
const SAME_TIME = new Date(NOW.getTime() - 3600_000).toISOString();

function overdoseMeals(n: number, idPrefix: string): Meal[] {
  // bgBefore=120, delta=-40 → bgAfter=80 (≥ 70 so HYPO_DURING does NOT fire),
  // delta=-40 < -30 so OVERDOSE fires. Using bgBefore=100 + delta=-50 would
  // produce bgAfter=50 < 70 and trigger HYPO_DURING instead.
  return Array.from({ length: n }, (_, i) =>
    makeFinalMeal(`${idPrefix}-${i}`, -40, { meal_time: SAME_TIME, glucose_before: 120 }),
  );
}
function goodMeals(n: number, idPrefix: string): Meal[] {
  // delta = 10 → GOOD outcome
  return Array.from({ length: n }, (_, i) =>
    makeFinalMeal(`${idPrefix}-${i}`, 10, { meal_time: SAME_TIME }),
  );
}

test("pattern overdoseRate: exactly 0.50 (5/10) → balanced, not overdosing", () => {
  const list = [...overdoseMeals(5, "ov"), ...goodMeals(5, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("balanced");
  expect(r.counts.overdose).toBe(5);
});

test("pattern overdoseRate: 6/10 = 0.60 > 0.50 → overdosing", () => {
  const list = [...overdoseMeals(6, "ov"), ...goodMeals(4, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("overdosing");
  expect(r.counts.overdose).toBe(6);
});

// Underdose mirror — same strict `> 0.50` logic:
test("pattern underdoseRate: exactly 0.50 (5/10) → balanced, not underdosing", () => {
  // delta=45, BALANCED cutoff=55 → UNDERDOSE
  const underdoses = Array.from({ length: 5 }, (_, i) =>
    makeFinalMeal(`u-${i}`, 45, { meal_time: SAME_TIME }),
  );
  const list = [...underdoses, ...goodMeals(5, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("balanced");
  expect(r.counts.underdose).toBe(5);
});

test("pattern underdoseRate: 6/10 = 0.60 > 0.50 → underdosing", () => {
  const underdoses = Array.from({ length: 6 }, (_, i) =>
    makeFinalMeal(`u-${i}`, 45, { meal_time: SAME_TIME }),
  );
  const list = [...underdoses, ...goodMeals(4, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("underdosing");
  expect(r.counts.underdose).toBe(6);
});

// Spike rate boundary — threshold is > 0.40:
test("pattern spikeRate: exactly 0.40 (4/10) → balanced, not spiking", () => {
  // delta=80 > BALANCED cutoff 55 → SPIKE
  const spikes = Array.from({ length: 4 }, (_, i) =>
    makeFinalMeal(`s-${i}`, 80, { meal_time: SAME_TIME }),
  );
  const list = [...spikes, ...goodMeals(6, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("balanced");
  expect(r.counts.spike).toBe(4);
});

test("pattern spikeRate: 5/10 = 0.50 > 0.40 → spiking", () => {
  const spikes = Array.from({ length: 5 }, (_, i) =>
    makeFinalMeal(`s-${i}`, 80, { meal_time: SAME_TIME }),
  );
  const list = [...spikes, ...goodMeals(5, "gd")];
  const r = detectPattern(list, NOW);

  expect(r.type).toBe("spiking");
  expect(r.counts.spike).toBe(5);
});
