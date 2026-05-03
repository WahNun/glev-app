// Unit coverage for `lib/insulinEval.ts` — the bolus outcome scorer
// that drives the badge color on bolus rows in the entries page.
//
// Locks in:
//   1. PENDING precedence — until `glucose_after_2h` is non-null, the
//      badge stays PENDING regardless of the +1h reading.
//   2. Hypo protection — any reading <70 mg/dL at +1h or +2h forces
//      OVER_CORRECTED, even when the absolute value at +2h would
//      otherwise classify as something else.
//   3. No-baseline path (cgm_glucose_at_log = null): only the absolute
//      +2h value is used. >180 → UNDER_CORRECTED, else ON_TARGET.
//   4. With baseline:
//        a. SPIKED          when delta ≥ +50
//        b. UNDER_CORRECTED when at_2h > 180
//        c. OVER_CORRECTED  when delta ≤ −100 (without crossing hypo)
//        d. ON_TARGET       otherwise
//   5. Δ-pill colour mirrors the same thresholds.
//   6. bolusInterimMessage / bolusFinalMessage / bolusPendingLabel
//      copy paths.

import { test, expect } from "@playwright/test";

import {
  evaluateBolus,
  bolusDeltaColor,
  bolusInterimMessage,
  bolusFinalMessage,
  bolusPendingLabel,
  HYPO_THRESHOLD,
  HIGH_THRESHOLD,
} from "@/lib/insulinEval";
import { makeInsulinLog } from "../support/engineFixtures";

// ── PENDING precedence ──────────────────────────────────────────────

test("evaluateBolus: PENDING when glucose_after_2h is null", () => {
  const r = evaluateBolus(makeInsulinLog({ glucose_after_1h: 150, glucose_after_2h: null }));
  expect(r.outcome).toBe("PENDING");
  expect(r.label).toBe("PENDING");
});

test("evaluateBolus: PENDING when no readings at all", () => {
  expect(evaluateBolus(makeInsulinLog()).outcome).toBe("PENDING");
});

// ── hypo protection ─────────────────────────────────────────────────

test("evaluateBolus: hypo at +2h forces OVER_CORRECTED regardless of baseline", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 200,
    glucose_after_1h: 120,
    glucose_after_2h: 65,
  }));
  expect(r.outcome).toBe("OVER_CORRECTED");
});

// Task #194: dense-curve hypo wins over PENDING and the legacy
// point-value rules — a hypo BETWEEN the +1h and +2h slots is otherwise
// invisible to the sparse evaluator.
test("evaluateBolus: had_hypo_window=true forces OVER_CORRECTED even while PENDING (no +2h yet)", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 200,
    glucose_after_1h: 150,
    glucose_after_2h: null,        // would normally → PENDING
    had_hypo_window: true,         // dense curve caught a sub-70 dip
  }));
  expect(r.outcome).toBe("OVER_CORRECTED");
});

test("evaluateBolus: had_hypo_window=true forces OVER_CORRECTED even when both endpoints look fine", () => {
  // Endpoints would otherwise classify ON_TARGET — the curve caught a
  // dip BETWEEN them that the sparse evaluator missed.
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 130,
    glucose_after_1h: 110,
    glucose_after_2h: 120,
    had_hypo_window: true,
  }));
  expect(r.outcome).toBe("OVER_CORRECTED");
});

test("evaluateBolus: had_hypo_window=false leaves the legacy rules in charge", () => {
  // had_hypo_window explicitly false (curve resolved with no hypo) must
  // not be confused with `true` — endpoints stay ON_TARGET.
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 130,
    glucose_after_1h: 120,
    glucose_after_2h: 130,
    had_hypo_window: false,
  }));
  expect(r.outcome).toBe("ON_TARGET");
});

test("evaluateBolus: hypo at +1h (with safe +2h) still forces OVER_CORRECTED", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 150,
    glucose_after_1h: 60,   // hypo
    glucose_after_2h: 110,  // recovered
  }));
  expect(r.outcome).toBe("OVER_CORRECTED");
});

test("HYPO_THRESHOLD is 70 mg/dL", () => {
  expect(HYPO_THRESHOLD).toBe(70);
});

test("HIGH_THRESHOLD is 180 mg/dL", () => {
  expect(HIGH_THRESHOLD).toBe(180);
});

// ── no-baseline path ────────────────────────────────────────────────

test("evaluateBolus (no baseline): >180 mg/dL at +2h → UNDER_CORRECTED", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: null,
    glucose_after_2h: 200,
  }));
  expect(r.outcome).toBe("UNDER_CORRECTED");
});

test("evaluateBolus (no baseline): ≤180 mg/dL at +2h → ON_TARGET", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: null,
    glucose_after_2h: 140,
  }));
  expect(r.outcome).toBe("ON_TARGET");
});

// ── with baseline ───────────────────────────────────────────────────

test("evaluateBolus (with baseline): delta ≥ +50 → SPIKED", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 100,
    glucose_after_2h: 150, // delta exactly +50
  }));
  expect(r.outcome).toBe("SPIKED");
});

test("evaluateBolus (with baseline): at_2h > 180 (and not spike) → UNDER_CORRECTED", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 150,
    glucose_after_2h: 190, // delta +40, but > 180 absolute
  }));
  expect(r.outcome).toBe("UNDER_CORRECTED");
});

test("evaluateBolus (with baseline): delta ≤ −100 (without hypo) → OVER_CORRECTED", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 220,
    glucose_after_2h: 110, // delta -110, no hypo
  }));
  expect(r.outcome).toBe("OVER_CORRECTED");
});

test("evaluateBolus (with baseline): otherwise → ON_TARGET", () => {
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 150,
    glucose_after_2h: 130, // delta -20, in target
  }));
  expect(r.outcome).toBe("ON_TARGET");
});

test("evaluateBolus: SPIKED takes precedence over UNDER_CORRECTED when both apply", () => {
  // baseline 130, at_2h 200 → delta +70 (spike) AND >180 (under).
  // Spike check runs first.
  const r = evaluateBolus(makeInsulinLog({
    cgm_glucose_at_log: 130,
    glucose_after_2h: 200,
  }));
  expect(r.outcome).toBe("SPIKED");
});

// ── delta colour pill ───────────────────────────────────────────────

test("bolusDeltaColor: null delta → neutral grey", () => {
  expect(bolusDeltaColor(null)).toBe("rgba(255,255,255,0.45)");
});

test("bolusDeltaColor: spike (+50) → orange (#F97316)", () => {
  expect(bolusDeltaColor(50)).toBe("#F97316");
});

test("bolusDeltaColor: over-correction (-100) → red (#EF4444)", () => {
  expect(bolusDeltaColor(-100)).toBe("#EF4444");
});

test("bolusDeltaColor: stable in-band → green (#22C55E)", () => {
  expect(bolusDeltaColor(0)).toBe("#22C55E");
  expect(bolusDeltaColor(15)).toBe("#22C55E");
});

test("bolusDeltaColor: mild rise (>15) → amber", () => {
  expect(bolusDeltaColor(20)).toBe("#F59E0B");
});

test("bolusDeltaColor: moderate drop (<-50) → amber", () => {
  expect(bolusDeltaColor(-60)).toBe("#F59E0B");
});

// ── interim / final / pending labels ────────────────────────────────

test("bolusInterimMessage: null at_1h → null", () => {
  expect(bolusInterimMessage(makeInsulinLog())).toBeNull();
});

test("bolusInterimMessage: with baseline, includes signed delta", () => {
  const msg = bolusInterimMessage(makeInsulinLog({
    cgm_glucose_at_log: 100,
    glucose_after_1h: 140,
  }));
  expect(msg).toMatch(/Nach 1h: 140 mg\/dL \(\+40 vs Start\)/);
});

test("bolusInterimMessage: without baseline, omits delta", () => {
  const msg = bolusInterimMessage(makeInsulinLog({
    cgm_glucose_at_log: null,
    glucose_after_1h: 140,
  }));
  expect(msg).toMatch(/Nach 1h: 140 mg\/dL\. Endauswertung folgt nach 2h\./);
});

test("bolusFinalMessage: PENDING returns null", () => {
  expect(bolusFinalMessage(makeInsulinLog())).toBeNull();
});

test("bolusFinalMessage: ON_TARGET copy", () => {
  const msg = bolusFinalMessage(makeInsulinLog({ cgm_glucose_at_log: 150, glucose_after_2h: 130 }));
  expect(msg).toMatch(/Im Zielbereich nach 2h \(130 mg\/dL\)/);
});

test("bolusFinalMessage: OVER_CORRECTED with hypo mentions hypo risk", () => {
  const msg = bolusFinalMessage(makeInsulinLog({ cgm_glucose_at_log: 200, glucose_after_2h: 60 }));
  expect(msg).toMatch(/Hypo-Risiko/);
});

test("bolusFinalMessage: SPIKED includes the signed delta", () => {
  const msg = bolusFinalMessage(makeInsulinLog({ cgm_glucose_at_log: 100, glucose_after_2h: 170 }));
  expect(msg).toMatch(/um \+70 mg\/dL gestiegen/);
});

test("bolusPendingLabel: future expectedAt → 'Pending · expected …'", () => {
  const future = new Date(Date.now() + 30 * 60_000);
  expect(bolusPendingLabel(future)).toMatch(/Pending · expected/);
});

test("bolusPendingLabel: past expectedAt → 'Skipped'", () => {
  const past = new Date(Date.now() - 30 * 60_000);
  expect(bolusPendingLabel(past)).toBe("Skipped");
});

test("bolusPendingLabel: invalid date → '—'", () => {
  expect(bolusPendingLabel(new Date(NaN))).toBe("—");
});
