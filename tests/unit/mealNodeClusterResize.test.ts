// Unit tests for the Meal-Node-Cluster landscape / resize behaviour.
//
// The core requirement: after a viewport resize (device rotation), every
// knob's rendered X-coordinate must still sit exactly on the chart's
// `toX(plannedAtMs)` position for the arm's stored `offsetMin`.
//
// This is purely math — no DOM or server required.  The proof is that the
// three formulas (toX, msPerPx, knobX) are inverses of each other and stay
// consistent for ANY chart width W.
//
// Task #695 — Landscape-Modus für den Meal-Node-Cluster.

import { test, expect } from "@playwright/test";
import { clampOffsetMin, pxDeltaToOffsetMin } from "../../components/MealNodeCluster";

// ─── helpers that mirror the RollingChart / MealNodeCluster math ───────────

/** Reproduces `toX` from RollingChart (CurrentDayGlucoseCard.tsx). */
function toX(t: number, winStart: number, now: number, W: number, padL: number, padR: number) {
  return padL + ((t - winStart) / (now - winStart)) * (W - padL - padR);
}

/** Reproduces `msPerPx` from RollingChart. */
function msPerPx(winStart: number, now: number, W: number, padL: number, padR: number) {
  return (now - winStart) / Math.max(1, W - padL - padR);
}

/** Reproduces `knobX` from MealNodeCluster.
 *  centerX = toX(mealAtMs); clamp is omitted here so we can test the
 *  raw math without bound side-effects. */
function knobX(centerX: number, offsetMin: number, scale: number) {
  return centerX + (offsetMin * 60_000) / scale;
}

// ─── shared scenario ────────────────────────────────────────────────────────

const PAD_L = 28;
const PAD_R = 10;
const NOW = Date.now();
const WIN_START = NOW - 12 * 60 * 60 * 1000; // 12-hour window
const MEAL_AT_MS = NOW - 3 * 60 * 60 * 1000;  // meal 3h ago
const PRE_OFFSET = -15;   // 15 min before meal
const POST_OFFSET = 90;   // 90 min after meal

test.describe("knobX ↔ toX consistency (resize safety)", () => {
  test("portrait width: knobX(offsetMin) === toX(plannedAtMs)", () => {
    const W = 375;
    const scale = msPerPx(WIN_START, NOW, W, PAD_L, PAD_R);
    const cx = toX(MEAL_AT_MS, WIN_START, NOW, W, PAD_L, PAD_R);

    const prePlanned = MEAL_AT_MS + PRE_OFFSET * 60_000;
    const postPlanned = MEAL_AT_MS + POST_OFFSET * 60_000;

    const preKnob = knobX(cx, PRE_OFFSET, scale);
    const postKnob = knobX(cx, POST_OFFSET, scale);
    const preToX = toX(prePlanned, WIN_START, NOW, W, PAD_L, PAD_R);
    const postToX = toX(postPlanned, WIN_START, NOW, W, PAD_L, PAD_R);

    expect(preKnob).toBeCloseTo(preToX, 6);
    expect(postKnob).toBeCloseTo(postToX, 6);
  });

  test("landscape width: same offsetMin still maps to toX(plannedAtMs)", () => {
    const W = 812; // landscape (portrait height becomes width)
    const scale = msPerPx(WIN_START, NOW, W, PAD_L, PAD_R);
    const cx = toX(MEAL_AT_MS, WIN_START, NOW, W, PAD_L, PAD_R);

    const prePlanned = MEAL_AT_MS + PRE_OFFSET * 60_000;
    const postPlanned = MEAL_AT_MS + POST_OFFSET * 60_000;

    const preKnob = knobX(cx, PRE_OFFSET, scale);
    const postKnob = knobX(cx, POST_OFFSET, scale);

    expect(preKnob).toBeCloseTo(toX(prePlanned, WIN_START, NOW, W, PAD_L, PAD_R), 6);
    expect(postKnob).toBeCloseTo(toX(postPlanned, WIN_START, NOW, W, PAD_L, PAD_R), 6);
  });

  test("rotation portrait → landscape: offsetMin unchanged, knobX shifts proportionally", () => {
    const W_portrait = 375;
    const W_landscape = 812;

    const scaleP = msPerPx(WIN_START, NOW, W_portrait, PAD_L, PAD_R);
    const scaleL = msPerPx(WIN_START, NOW, W_landscape, PAD_L, PAD_R);

    const cxP = toX(MEAL_AT_MS, WIN_START, NOW, W_portrait, PAD_L, PAD_R);
    const cxL = toX(MEAL_AT_MS, WIN_START, NOW, W_landscape, PAD_L, PAD_R);

    // The stored offsetMin is the SAME after rotation — only the px scale changes.
    const kP = knobX(cxP, POST_OFFSET, scaleP);
    const kL = knobX(cxL, POST_OFFSET, scaleL);

    // Both must equal toX(plannedAtMs) for their respective widths.
    const plannedAtMs = MEAL_AT_MS + POST_OFFSET * 60_000;
    expect(kP).toBeCloseTo(toX(plannedAtMs, WIN_START, NOW, W_portrait, PAD_L, PAD_R), 6);
    expect(kL).toBeCloseTo(toX(plannedAtMs, WIN_START, NOW, W_landscape, PAD_L, PAD_R), 6);

    // And the landscape knob should be further right than portrait (wider canvas).
    expect(kL).toBeGreaterThan(kP);
  });

  test("rotation landscape → portrait: knobX snaps back to correct toX position", () => {
    const W_landscape = 812;
    const W_portrait = 375;

    const scaleL = msPerPx(WIN_START, NOW, W_landscape, PAD_L, PAD_R);
    const cxL = toX(MEAL_AT_MS, WIN_START, NOW, W_landscape, PAD_L, PAD_R);
    const kL = knobX(cxL, PRE_OFFSET, scaleL);
    expect(kL).toBeCloseTo(
      toX(MEAL_AT_MS + PRE_OFFSET * 60_000, WIN_START, NOW, W_landscape, PAD_L, PAD_R),
      6,
    );

    // After rotating back:
    const scaleP = msPerPx(WIN_START, NOW, W_portrait, PAD_L, PAD_R);
    const cxP = toX(MEAL_AT_MS, WIN_START, NOW, W_portrait, PAD_L, PAD_R);
    const kP = knobX(cxP, PRE_OFFSET, scaleP);
    expect(kP).toBeCloseTo(
      toX(MEAL_AT_MS + PRE_OFFSET * 60_000, WIN_START, NOW, W_portrait, PAD_L, PAD_R),
      6,
    );
  });

  test("drag-delta converts correctly on landscape scale", () => {
    // After rotation the ms-per-px scale is smaller (more canvas for same time).
    // A 30-minute drag should move further in pixels on landscape.
    const W_portrait = 375;
    const W_landscape = 812;

    const scaleP = msPerPx(WIN_START, NOW, W_portrait, PAD_L, PAD_R);
    const scaleL = msPerPx(WIN_START, NOW, W_landscape, PAD_L, PAD_R);

    // 30 min expressed in px on each layout.
    const pxFor30MinPortrait  = (30 * 60_000) / scaleP;
    const pxFor30MinLandscape = (30 * 60_000) / scaleL;

    // Landscape canvas is wider → fewer ms per pixel → 30 min takes more px.
    expect(pxFor30MinLandscape).toBeGreaterThan(pxFor30MinPortrait);

    // pxDeltaToOffsetMin must round-trip both scales.
    expect(pxDeltaToOffsetMin(pxFor30MinPortrait,  scaleP)).toBe(30);
    expect(pxDeltaToOffsetMin(pxFor30MinLandscape, scaleL)).toBe(30);
  });

  test("clamp still applies after resize — pre knob cannot cross zero", () => {
    // Even if a very wide canvas makes a drag technically possible beyond -60 min
    // or 0, the clamp must stop it.
    expect(clampOffsetMin("pre", -61)).toBe(-60);
    expect(clampOffsetMin("pre", 0)).toBe(-1);
    expect(clampOffsetMin("pre", 5)).toBe(-1);
  });

  test("msPerPx scales inversely with drawable canvas width", () => {
    // msPerPx = winSpan / (W - padL - padR).
    // To get an exact 2:1 ratio between s1 and s2 we need the DRAWABLE widths
    // (W - padL - padR) to be in a 2:1 ratio — not the total pixel widths,
    // because the padding offsets are constant (28 + 10 = 38 px).
    // Choose W1 so that drawable1 = 312 px, W2 so that drawable2 = 624 px.
    const W1 = PAD_L + PAD_R + 312; // total = 350
    const W2 = PAD_L + PAD_R + 624; // total = 662 (not 2×350!)
    const s1 = msPerPx(WIN_START, NOW, W1, PAD_L, PAD_R);
    const s2 = msPerPx(WIN_START, NOW, W2, PAD_L, PAD_R);
    // Wider canvas → fewer ms per pixel → s2 < s1.
    expect(s1 / s2).toBeCloseTo(2, 9);
    expect(s2).toBeLessThan(s1);
  });
});
