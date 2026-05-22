// Unit tests for `buildIOBHistory` in `lib/iob.ts`.
//
// Key invariants verified:
//   1. Doses not yet administered at a sample time contribute ZERO IOB
//      (the core correctness fix — guards against calcSingleIOB's elapsedMin≤0
//      branch returning dose.units for future-relative timestamps).
//   2. IOB is 0 for all samples before the first dose.
//   3. IOB reaches its maximum close to the dose administration time.
//   4. IOB decays to 0 after DIA minutes have elapsed.
//   5. Two stacked doses combine — their combined peak exceeds either dose alone.
//   6. Empty doses array → all samples are 0.
//   7. Rapid (180 min) clears before regular (300 min) for the same dose size.
//   8. Interval parameter controls sample count correctly.

import { test, expect } from "@playwright/test";
import { buildIOBHistory, getDIAMinutes } from "@/lib/iob";
import type { BolusDose } from "@/lib/iob";

// Fixed reference time: noon on an arbitrary day.
const REF_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

function msAgo(minutes: number): string {
  return new Date(REF_NOW - minutes * 60_000).toISOString();
}

function msBefore(minutesBeforeNow: number): string {
  return msAgo(minutesBeforeNow);
}

// ─── 1. Pre-dose samples are zero ────────────────────────────────────────────

test("buildIOBHistory: all samples before a dose have IOB = 0", () => {
  // Dose given 30 min ago — the 24h window starts 24h ago.
  // Samples from 24h ago to 31 min ago must all be 0.
  const dose: BolusDose = { units: 4, administeredAt: msAgo(30) };
  const diaMin = getDIAMinutes("rapid"); // 180
  const samples = buildIOBHistory([dose], diaMin, 24, REF_NOW);

  // Find the first sample with nonzero IOB.
  const firstNonZeroIdx = samples.findIndex(s => s.iob > 0);
  // There must be nonzero samples (dose is within DIA).
  expect(firstNonZeroIdx).toBeGreaterThan(0);

  // Every sample before it must be 0.
  for (let i = 0; i < firstNonZeroIdx; i++) {
    expect(samples[i].iob).toBe(0);
  }
});

// ─── 2. Future dose contributes 0 IOB at the start of the window ─────────────

test("buildIOBHistory: dose administered after sample time contributes 0", () => {
  // Dose given 1 min ago — sample at tMs = REF_NOW - 2h should see 0.
  const dose: BolusDose = { units: 5, administeredAt: msAgo(1) };
  const diaMin = 180;
  const samples = buildIOBHistory([dose], diaMin, 24, REF_NOW, 15);

  // The very first sample is 24h ago — well before the dose.
  expect(samples[0].iob).toBe(0);

  // The last sample is "now" (30 s before REF_NOW due to floating arithmetic,
  // but within 1 min of dose), so it must be nonzero.
  expect(samples[samples.length - 1].iob).toBeGreaterThan(0);
});

// ─── 3. IOB peaks near administration time ────────────────────────────────────

test("buildIOBHistory: peak IOB occurs at or just after dose administration", () => {
  // Dose given 90 min ago (half of DIA=180).
  const doseTimeMs = REF_NOW - 90 * 60_000;
  const dose: BolusDose = { units: 4, administeredAt: new Date(doseTimeMs).toISOString() };
  const diaMin = 180;
  const samples = buildIOBHistory([dose], diaMin, 6, REF_NOW, 15);

  const maxSample = samples.reduce((best, s) => s.iob > best.iob ? s : best, samples[0]);
  // Peak must be close to administration time (within ±30 min = 2 samples)
  expect(Math.abs(maxSample.tMs - doseTimeMs)).toBeLessThan(31 * 60_000);
});

// ─── 4. IOB decays to 0 after DIA ────────────────────────────────────────────

test("buildIOBHistory: IOB is 0 at current time when dose cleared more than DIA ago", () => {
  const diaMin = getDIAMinutes("rapid"); // 180
  // Dose given 200 min ago — fully cleared 20 min ago.
  const dose: BolusDose = { units: 4, administeredAt: msAgo(200) };
  const samples = buildIOBHistory([dose], diaMin, 24, REF_NOW);

  // The last sample (current time) must be 0.
  expect(samples[samples.length - 1].iob).toBe(0);

  // Within DIA of administration (e.g., at elapsed=90 min = now-110min) it was active.
  const sampleMidDIA = samples.find(s =>
    Math.abs(s.tMs - (REF_NOW - 110 * 60_000)) < 16 * 60_000,
  );
  if (sampleMidDIA) {
    expect(sampleMidDIA.iob).toBeGreaterThan(0);
  }
});

// ─── 5. Active dose is nonzero at current time ───────────────────────────────

test("buildIOBHistory: dose given 60 min ago with DIA=180 is still active", () => {
  const dose: BolusDose = { units: 6, administeredAt: msAgo(60) };
  const diaMin = 180;
  const samples = buildIOBHistory([dose], diaMin, 24, REF_NOW);

  const lastSample = samples[samples.length - 1];
  expect(lastSample.iob).toBeGreaterThan(0);
  expect(lastSample.iob).toBeLessThan(6); // must have decayed somewhat
});

// ─── 6. Two stacked doses combine ────────────────────────────────────────────

test("buildIOBHistory: two stacked doses combine — peak > either dose alone", () => {
  const diaMin = 180;
  const dose1: BolusDose = { units: 3, administeredAt: msAgo(30) };
  const dose2: BolusDose = { units: 3, administeredAt: msAgo(20) };

  const combined = buildIOBHistory([dose1, dose2], diaMin, 2, REF_NOW, 5);
  const single1  = buildIOBHistory([dose1],        diaMin, 2, REF_NOW, 5);
  const single2  = buildIOBHistory([dose2],        diaMin, 2, REF_NOW, 5);

  const peakCombined = Math.max(...combined.map(s => s.iob));
  const peak1        = Math.max(...single1.map(s => s.iob));
  const peak2        = Math.max(...single2.map(s => s.iob));

  expect(peakCombined).toBeGreaterThan(peak1);
  expect(peakCombined).toBeGreaterThan(peak2);
});

// ─── 7. Empty doses → all zeros ───────────────────────────────────────────────

test("buildIOBHistory: empty doses array returns all-zero samples", () => {
  const samples = buildIOBHistory([], 180, 24, REF_NOW);
  for (const s of samples) {
    expect(s.iob).toBe(0);
  }
});

// ─── 8. Rapid clears before regular ──────────────────────────────────────────

test("buildIOBHistory: rapid (180 min) clears sooner than regular (300 min)", () => {
  const dose: BolusDose = { units: 4, administeredAt: msAgo(190) };

  const samplesRapid   = buildIOBHistory([dose], 180, 24, REF_NOW);
  const samplesRegular = buildIOBHistory([dose], 300, 24, REF_NOW);

  // At 190 min elapsed, rapid (DIA=180) is fully cleared → IOB = 0.
  const lastRapid   = samplesRapid[samplesRapid.length - 1].iob;
  const lastRegular = samplesRegular[samplesRegular.length - 1].iob;

  expect(lastRapid).toBe(0);
  expect(lastRegular).toBeGreaterThan(0);
});

// ─── 9. Sample count matches interval parameter ───────────────────────────────

test("buildIOBHistory: sample count = (hours * 60 / intervalMin) + 1", () => {
  const samples15 = buildIOBHistory([], 180, 24, REF_NOW, 15);
  const samples30 = buildIOBHistory([], 180, 12, REF_NOW, 30);

  expect(samples15.length).toBe(24 * 60 / 15 + 1); // 97
  expect(samples30.length).toBe(12 * 60 / 30 + 1); // 25
});

// ─── 10. Monotonic decay per single dose ─────────────────────────────────────

test("buildIOBHistory: single dose IOB never increases after its peak", () => {
  // Dose given 5 min ago — well within DIA — look at last 3 h.
  const dose: BolusDose = { units: 5, administeredAt: msAgo(5) };
  const samples = buildIOBHistory([dose], 180, 3, REF_NOW, 5);

  const peakIdx = samples.reduce(
    (best, s, i) => s.iob > samples[best].iob ? i : best,
    0,
  );

  // After the peak, IOB must be monotonically non-increasing.
  for (let i = peakIdx + 1; i < samples.length; i++) {
    expect(samples[i].iob).toBeLessThanOrEqual(samples[i - 1].iob + 0.01);
  }
});
