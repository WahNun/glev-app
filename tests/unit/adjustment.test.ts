// Unit coverage for `lib/engine/adjustment.ts` — the ICR/CF
// suggestion + audit-log helpers consumed by the Engine page.
//
// Locks in:
//   1. Skip paths: balanced, insufficient_data, low confidence, sample<5,
//      spiking — all return hasSuggestion=false with the right i18n key.
//   2. Suggestion math: overdosing → ×1.05 (round to 1dp), underdosing
//      → ×0.95 (round to 1dp). Both fields (icr + cf) are suggested.
//   3. applyAdjustment writes one audit-log entry per changed field
//      and updates lastUpdated to an ISO timestamp.
//   4. applyAdjustment is a no-op when hasSuggestion is false.
//   5. Audit log is appended (not replaced) and never mutates the
//      input settings object.
//   6. applyAdjustment is idempotent on double-tap (Task #190): the
//      same suggestion against an already-applied state must NOT
//      append another history row.

import { test, expect } from "@playwright/test";

import { suggestAdjustment, applyAdjustment } from "@/lib/engine/adjustment";
import { makeAdaptiveSettings, makePattern } from "../support/engineFixtures";

// ── skip paths ──────────────────────────────────────────────────────

test("suggestAdjustment: balanced pattern → no suggestion", () => {
  const r = suggestAdjustment(makeAdaptiveSettings(), makePattern({ type: "balanced" }));
  expect(r.hasSuggestion).toBe(false);
  expect(r.message.key).toBe("engine_msg_no_adjustment_needed");
});

test("suggestAdjustment: insufficient_data → no suggestion", () => {
  const r = suggestAdjustment(makeAdaptiveSettings(), makePattern({ type: "insufficient_data", sampleSize: 2, confidence: "low" }));
  expect(r.hasSuggestion).toBe(false);
  expect(r.message.key).toBe("engine_msg_no_adjustment_needed");
});

test("suggestAdjustment: low-confidence pattern → no suggestion (low_confidence message)", () => {
  const r = suggestAdjustment(
    makeAdaptiveSettings(),
    makePattern({ type: "underdosing", confidence: "low", sampleSize: 8 }),
  );
  expect(r.hasSuggestion).toBe(false);
  expect(r.message.key).toBe("engine_msg_low_confidence");
});

test("suggestAdjustment: sampleSize < 5 → no suggestion even if confidence claimed high", () => {
  const r = suggestAdjustment(
    makeAdaptiveSettings(),
    makePattern({ type: "underdosing", confidence: "high", sampleSize: 4 }),
  );
  expect(r.hasSuggestion).toBe(false);
  expect(r.message.key).toBe("engine_msg_low_confidence");
});

test("suggestAdjustment: spiking pattern → no numeric suggestion (spiking message)", () => {
  const r = suggestAdjustment(
    makeAdaptiveSettings(),
    makePattern({ type: "spiking", confidence: "high", sampleSize: 15 }),
  );
  expect(r.hasSuggestion).toBe(false);
  expect(r.message.key).toBe("engine_msg_spiking");
});

// ── suggestion math ─────────────────────────────────────────────────

test("suggestAdjustment: overdosing → icr & cf scaled +5%, rounded to 1dp", () => {
  // icr=15 → 15.75 → 15.8 ; cf=50 → 52.5 → 52.5
  const r = suggestAdjustment(
    makeAdaptiveSettings({ icr: 15, correctionFactor: 50 }),
    makePattern({ type: "overdosing", confidence: "high", sampleSize: 15 }),
  );
  expect(r.hasSuggestion).toBe(true);
  expect(r.field).toBe("both");
  expect(r.fromIcr).toBe(15);
  expect(r.toIcr).toBeCloseTo(15.8, 5);
  expect(r.fromCf).toBe(50);
  expect(r.toCf).toBeCloseTo(52.5, 5);
  expect(r.message.key).toBe("engine_msg_overdosing");
  expect(r.message.params).toMatchObject({ fromIcr: 15, toIcr: 15.8, fromCf: 50, toCf: 52.5 });
});

test("suggestAdjustment: underdosing → icr & cf scaled −5%, rounded to 1dp", () => {
  // icr=15 → 14.25 → 14.3 ; cf=50 → 47.5 → 47.5
  const r = suggestAdjustment(
    makeAdaptiveSettings({ icr: 15, correctionFactor: 50 }),
    makePattern({ type: "underdosing", confidence: "high", sampleSize: 15 }),
  );
  expect(r.hasSuggestion).toBe(true);
  expect(r.toIcr).toBeCloseTo(14.3, 5);
  expect(r.toCf).toBeCloseTo(47.5, 5);
  expect(r.message.key).toBe("engine_msg_underdosing");
});

// ── applyAdjustment ─────────────────────────────────────────────────

test("applyAdjustment: returns the input unchanged when no suggestion", () => {
  const s = makeAdaptiveSettings({ icr: 15, correctionFactor: 50 });
  const sug = suggestAdjustment(s, makePattern({ type: "balanced" }));
  const next = applyAdjustment(s, sug);
  expect(next).toBe(s);
});

test("applyAdjustment: writes one audit entry per changed field and updates lastUpdated", () => {
  const s = makeAdaptiveSettings({ icr: 15, correctionFactor: 50 });
  const sug = suggestAdjustment(
    s,
    makePattern({ type: "overdosing", confidence: "high", sampleSize: 15, label: "Frequent over-dosing" }),
  );
  const next = applyAdjustment(s, sug);

  expect(next.icr).toBeCloseTo(15.8, 5);
  expect(next.correctionFactor).toBeCloseTo(52.5, 5);
  expect(next.adjustmentHistory).toHaveLength(2);

  const [icrRec, cfRec] = next.adjustmentHistory;
  expect(icrRec.field).toBe("icr");
  expect(icrRec.from).toBe(15);
  expect(icrRec.to).toBeCloseTo(15.8, 5);
  expect(icrRec.reason).toBe("Frequent over-dosing");
  expect(cfRec.field).toBe("correctionFactor");
  expect(cfRec.from).toBe(50);
  expect(cfRec.to).toBeCloseTo(52.5, 5);

  expect(next.lastUpdated).toBeTruthy();
  // Valid ISO timestamp.
  expect(Number.isFinite(Date.parse(next.lastUpdated!))).toBe(true);
  // Timestamps on both audit records match lastUpdated (single transaction).
  expect(icrRec.at).toBe(next.lastUpdated);
  expect(cfRec.at).toBe(next.lastUpdated);
});

test("applyAdjustment: does not mutate the input settings", () => {
  const s = makeAdaptiveSettings({ icr: 15, correctionFactor: 50 });
  const sug = suggestAdjustment(
    s,
    makePattern({ type: "underdosing", confidence: "high", sampleSize: 15 }),
  );
  applyAdjustment(s, sug);
  expect(s.icr).toBe(15);
  expect(s.correctionFactor).toBe(50);
  expect(s.adjustmentHistory).toHaveLength(0);
  expect(s.lastUpdated).toBeNull();
});

test("applyAdjustment: appends to existing audit history rather than replacing", () => {
  const prior = {
    at: "2026-01-01T00:00:00.000Z",
    field: "icr" as const,
    from: 14,
    to: 15,
    reason: "manual",
  };
  const s = makeAdaptiveSettings({ icr: 15, correctionFactor: 50, adjustmentHistory: [prior] });
  const sug = suggestAdjustment(
    s,
    makePattern({ type: "overdosing", confidence: "high", sampleSize: 15 }),
  );
  const next = applyAdjustment(s, sug);
  expect(next.adjustmentHistory).toHaveLength(3);
  expect(next.adjustmentHistory[0]).toEqual(prior);
});

// ── Task #190: idempotency on double-tap ────────────────────────────
// Tapping Übernehmen twice in a row must NOT append a second history
// row, since the values already match the suggestion's `to` targets.
// The DB-backed `applyAdjustmentToSettings` enforces the same contract
// (covered separately in applyAdjustmentToSettings.test.ts).

test("applyAdjustment: idempotent on double-tap (no duplicate history)", () => {
  const s = makeAdaptiveSettings({ icr: 15, correctionFactor: 50 });
  const sug = suggestAdjustment(
    s,
    makePattern({ type: "overdosing", confidence: "high", sampleSize: 15 }),
  );

  const once = applyAdjustment(s, sug);
  expect(once.adjustmentHistory).toHaveLength(2);

  // Same suggestion against the now-updated state — both fields are
  // already at their targets, so neither branch fires and history
  // stays at 2 entries.
  const twice = applyAdjustment(once, sug);
  expect(twice.icr).toBe(once.icr);
  expect(twice.correctionFactor).toBe(once.correctionFactor);
  expect(twice.adjustmentHistory).toHaveLength(2);
});
