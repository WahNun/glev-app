// Unit tests for resolveActiveDose (lib/engine/activeDose.ts).
//
// resolveActiveDose is extracted from the engine page's activeDose useMemo so
// the priority chain can be verified deterministically without a browser.
//
// Priority chain under test:
//   1. manualDose override — if non-empty, finite, and >= 0, returned as-is.
//   2. result.dose (engine result) — used when resultICRSource === selectedICR
//      (IOB-corrected).
//   3. eagerDoses[selectedICR] — fallback estimate when sources differ or
//      result is null (IOB-corrected).
//   4. null result + null eager — returns null.

import { test, expect } from "@playwright/test";
import { resolveActiveDose } from "@/lib/engine/activeDose";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeResult(dose: number) {
  return { dose };
}

const NO_IOB = 0;

// ── 1. result.dose used when sources match ───────────────────────────────────

test("resolveActiveDose: returns result.dose (IOB-adjusted) when resultICRSource matches selectedICR (adaptive)", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "", NO_IOB);
  expect(dose).toBe(6);
});

test("resolveActiveDose: returns result.dose (IOB-adjusted) when resultICRSource matches selectedICR (static)", () => {
  const result = makeResult(4);
  const dose = resolveActiveDose(result, "static", "static", { adaptive: 3, static: 3.5 }, "", NO_IOB);
  expect(dose).toBe(4);
});

test("resolveActiveDose: IOB is subtracted from result.dose when sources match", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "", 2);
  expect(dose).toBe(4);
});

test("resolveActiveDose: IOB clamps result.dose to 0 (never negative)", () => {
  const result = makeResult(3);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "", 10);
  expect(dose).toBe(0);
});

// ── 2. eagerDoses fallback when sources differ ────────────────────────────────

test("resolveActiveDose: falls back to eagerDoses.adaptive when resultICRSource !== selectedICR", () => {
  const result = makeResult(8);
  const dose = resolveActiveDose(result, "static", "adaptive", { adaptive: 5, static: 4 }, "", NO_IOB);
  expect(dose).toBe(5);
});

test("resolveActiveDose: falls back to eagerDoses.static when resultICRSource !== selectedICR", () => {
  const result = makeResult(8);
  const dose = resolveActiveDose(result, "adaptive", "static", { adaptive: 5, static: 4 }, "", NO_IOB);
  expect(dose).toBe(4);
});

test("resolveActiveDose: IOB is subtracted from eagerDose fallback", () => {
  const result = makeResult(8);
  const dose = resolveActiveDose(result, "static", "adaptive", { adaptive: 5, static: 4 }, "", 1.5);
  expect(dose).toBe(3.5);
});

test("resolveActiveDose: falls back to eagerDoses when result is null", () => {
  const dose = resolveActiveDose(null, null, "adaptive", { adaptive: 5, static: 4 }, "", NO_IOB);
  expect(dose).toBe(5);
});

test("resolveActiveDose: falls back to eagerDoses.static when result is null and selectedICR is static", () => {
  const dose = resolveActiveDose(null, null, "static", { adaptive: 5, static: 4 }, "", NO_IOB);
  expect(dose).toBe(4);
});

// ── 3. manualDose override ────────────────────────────────────────────────────

test("resolveActiveDose: manualDose overrides result.dose entirely", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "3", 2);
  expect(dose).toBe(3);
});

test("resolveActiveDose: manualDose overrides eagerDoses entirely", () => {
  const dose = resolveActiveDose(null, null, "adaptive", { adaptive: 5, static: 4 }, "2.5", 2);
  expect(dose).toBe(2.5);
});

test("resolveActiveDose: manualDose of 0 is a valid override (returns 0, not null)", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "0", NO_IOB);
  expect(dose).toBe(0);
});

test("resolveActiveDose: manualDose with only whitespace is ignored", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "   ", NO_IOB);
  expect(dose).toBe(6);
});

test("resolveActiveDose: non-numeric manualDose is ignored", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "abc", NO_IOB);
  expect(dose).toBe(6);
});

test("resolveActiveDose: negative manualDose is ignored", () => {
  const result = makeResult(6);
  const dose = resolveActiveDose(result, "adaptive", "adaptive", { adaptive: 5, static: 4 }, "-1", NO_IOB);
  expect(dose).toBe(6);
});

// ── 4. null result + null eager → null ───────────────────────────────────────

test("resolveActiveDose: returns null when result is null and eagerDose for selectedICR is null", () => {
  const dose = resolveActiveDose(null, null, "adaptive", { adaptive: null, static: null }, "", NO_IOB);
  expect(dose).toBeNull();
});

test("resolveActiveDose: returns null when result is null and only the non-selected eager slot has a value", () => {
  const dose = resolveActiveDose(null, null, "adaptive", { adaptive: null, static: 4 }, "", NO_IOB);
  expect(dose).toBeNull();
});
