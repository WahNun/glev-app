// Unit tests for getActiveDosesAtTime (lib/iob.ts)
//
// getActiveDosesAtTime(doses, tMs, diaMin) filters which doses are active at a
// given timestamp. It powers the IOBHistoryChart peak-marker popover — a
// regression here would silently show wrong or missing doses in the popover.
//
// Coverage:
//   1. Empty doses array → empty result
//   2. Dose exactly at tMs (elapsed = 0 min) → included
//   3. Dose at tMs − diaMin (elapsed = diaMin, fully elapsed) → excluded
//   4. Future dose (elapsed < 0) → excluded
//   5. Multiple doses — only those inside [0, diaMin) are returned
//   6. Just-before-clearance (elapsed = diaMin − 1) → still included
//   7. Just-after-administration (elapsed = 1 min) → included

import { test, expect } from "@playwright/test";
import { getActiveDosesAtTime } from "@/lib/iob";
import type { BolusDose } from "@/lib/iob";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build an ISO timestamp that is `minutes` before (positive) or after (negative) tMs. */
function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function makeDose(administeredAtMs: number, units = 4): BolusDose {
  return { units, administeredAt: msToIso(administeredAtMs) };
}

const NOW_MS = 1_700_000_000_000; // fixed anchor — no Date.now() drift
const DIA_MIN = 180; // rapid DIA
const DIA_MS = DIA_MIN * 60_000;

// ── 1. Empty array ────────────────────────────────────────────────────────────

test("getActiveDosesAtTime: empty doses array returns empty result", () => {
  const result = getActiveDosesAtTime([], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(0);
});

// ── 2. Dose exactly at tMs (elapsed = 0) is included ────────────────────────

test("getActiveDosesAtTime: dose administered exactly at tMs (elapsed=0) is included", () => {
  const dose = makeDose(NOW_MS); // administered right at the query time
  const result = getActiveDosesAtTime([dose], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(1);
  expect(result[0]).toBe(dose);
});

// ── 3. Dose at tMs − diaMin (elapsed = diaMin) is excluded ──────────────────
//
// The filter condition is `elapsedMin < diaMin` (strict less-than), so a dose
// administered exactly diaMin minutes before tMs is fully elapsed and excluded.

test("getActiveDosesAtTime: dose at tMs−diaMin (elapsed=diaMin) is excluded", () => {
  const dose = makeDose(NOW_MS - DIA_MS); // elapsed = exactly 180 min
  const result = getActiveDosesAtTime([dose], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(0);
});

// ── 4. Future dose (tMs < doseTimeMs, elapsed < 0) is excluded ──────────────

test("getActiveDosesAtTime: future dose (administered after tMs) is excluded", () => {
  const dose = makeDose(NOW_MS + 30 * 60_000); // 30 min in the future
  const result = getActiveDosesAtTime([dose], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(0);
});

// ── 5. Multiple doses — only active ones are returned ────────────────────────

test("getActiveDosesAtTime: multiple doses — only those within [0, diaMin) are returned", () => {
  const active1 = makeDose(NOW_MS - 30 * 60_000, 3);       // 30 min ago — active
  const active2 = makeDose(NOW_MS - 90 * 60_000, 5);       // 90 min ago — active
  const expiredExact = makeDose(NOW_MS - DIA_MS, 2);       // exactly 180 min ago — expired
  const expiredOld = makeDose(NOW_MS - 240 * 60_000, 6);   // 240 min ago — expired
  const future = makeDose(NOW_MS + 60 * 60_000, 4);        // future — excluded

  const result = getActiveDosesAtTime(
    [active1, active2, expiredExact, expiredOld, future],
    NOW_MS,
    DIA_MIN,
  );

  expect(result).toHaveLength(2);
  expect(result).toContain(active1);
  expect(result).toContain(active2);
});

// ── 6. Dose one minute before full clearance is still included ───────────────

test("getActiveDosesAtTime: dose at tMs−(diaMin−1) (elapsed=diaMin−1) is still included", () => {
  const dose = makeDose(NOW_MS - (DIA_MIN - 1) * 60_000); // 1 min before clearance
  const result = getActiveDosesAtTime([dose], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(1);
  expect(result[0]).toBe(dose);
});

// ── 7. Dose one minute after administration is included ──────────────────────

test("getActiveDosesAtTime: dose administered 1 minute before tMs is included", () => {
  const dose = makeDose(NOW_MS - 60_000, 6); // 1 min ago
  const result = getActiveDosesAtTime([dose], NOW_MS, DIA_MIN);
  expect(result).toHaveLength(1);
  expect(result[0]).toBe(dose);
});
