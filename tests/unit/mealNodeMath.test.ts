// Unit coverage for the Meal-Node-Cluster math helpers
// (`components/MealNodeCluster.tsx`). The cluster owns the X↔time
// conversion, clamping, and `post_n` ordering rules that govern every
// drag and every "+"-tap on the dashboard glucose chart. Pinning them
// here means a future refactor of the SVG layer can't silently widen
// the offset bands or shift the auto-suggested post offset without a
// failing test — both would be silent regressions because the visual
// looks identical until the user drags the knob to the wrong place.
//
// Task #673 — Make.com-style draggable meal cluster on the 12h CGM
// curve (`components/CurrentDayGlucoseCard.tsx`).

import { test, expect } from "@playwright/test";
import {
  PRE_MIN_OFFSET_MIN,
  PRE_MAX_OFFSET_MIN,
  POST_MIN_OFFSET_MIN,
  POST_MAX_OFFSET_MIN,
  DEFAULT_PRE_OFFSET_MIN,
  DEFAULT_POST_OFFSET_MIN,
  clampOffsetMin,
  pxDeltaToOffsetMin,
  kindOf,
  nextPostCheckType,
  defaultOffsetForNewPost,
  bgCheckColor,
} from "../../components/MealNodeCluster";

test.describe("kindOf", () => {
  test("returns 'pre' only for exact 'pre' check_type", () => {
    expect(kindOf("pre")).toBe("pre");
    expect(kindOf("post_1")).toBe("post");
    expect(kindOf("post_2")).toBe("post");
    expect(kindOf("post_99")).toBe("post");
    expect(kindOf("anything-else")).toBe("post");
  });
});

test.describe("clampOffsetMin — pre band [-60, -1]", () => {
  test("clamps below the lower bound to -60", () => {
    expect(clampOffsetMin("pre", -120)).toBe(PRE_MIN_OFFSET_MIN);
    expect(clampOffsetMin("pre", -61)).toBe(PRE_MIN_OFFSET_MIN);
  });
  test("clamps above the upper bound to -1 (pre can never be >= 0)", () => {
    expect(clampOffsetMin("pre", 0)).toBe(PRE_MAX_OFFSET_MIN);
    expect(clampOffsetMin("pre", 5)).toBe(PRE_MAX_OFFSET_MIN);
    expect(clampOffsetMin("pre", -1)).toBe(-1);
  });
  test("passes through values inside the band, rounded", () => {
    expect(clampOffsetMin("pre", -15)).toBe(-15);
    expect(clampOffsetMin("pre", -15.4)).toBe(-15);
    expect(clampOffsetMin("pre", -15.6)).toBe(-16);
    expect(clampOffsetMin("pre", -60)).toBe(-60);
  });
});

test.describe("clampOffsetMin — post band [1, 180]", () => {
  test("clamps to lower bound (post can never be <= 0)", () => {
    expect(clampOffsetMin("post", 0)).toBe(POST_MIN_OFFSET_MIN);
    expect(clampOffsetMin("post", -10)).toBe(POST_MIN_OFFSET_MIN);
  });
  test("clamps to upper bound 180", () => {
    expect(clampOffsetMin("post", 181)).toBe(POST_MAX_OFFSET_MIN);
    expect(clampOffsetMin("post", 999)).toBe(POST_MAX_OFFSET_MIN);
  });
  test("passes through values inside the band, rounded", () => {
    expect(clampOffsetMin("post", 90)).toBe(DEFAULT_POST_OFFSET_MIN);
    expect(clampOffsetMin("post", 90.4)).toBe(90);
    expect(clampOffsetMin("post", 90.6)).toBe(91);
    expect(clampOffsetMin("post", 1)).toBe(1);
    expect(clampOffsetMin("post", 180)).toBe(180);
  });
});

test.describe("pxDeltaToOffsetMin", () => {
  // Pick an easy scale: 60_000 ms per pixel → 1 px = 1 min.
  const msPerPx = 60_000;

  test("0 px → 0 min", () => {
    expect(pxDeltaToOffsetMin(0, msPerPx)).toBe(0);
  });
  test("positive px → positive minutes", () => {
    expect(pxDeltaToOffsetMin(1, msPerPx)).toBe(1);
    expect(pxDeltaToOffsetMin(10, msPerPx)).toBe(10);
    expect(pxDeltaToOffsetMin(90, msPerPx)).toBe(90);
  });
  test("negative px → negative minutes", () => {
    expect(pxDeltaToOffsetMin(-1, msPerPx)).toBe(-1);
    expect(pxDeltaToOffsetMin(-15, msPerPx)).toBe(-15);
  });
  test("rounds to the nearest whole minute", () => {
    // 0.4 min → 0, 0.6 min → 1
    expect(pxDeltaToOffsetMin(0.4, msPerPx)).toBe(0);
    expect(pxDeltaToOffsetMin(0.6, msPerPx)).toBe(1);
    expect(pxDeltaToOffsetMin(-0.6, msPerPx)).toBe(-1);
  });
  test("scales correctly with a denser ms/px (12h across 360 px)", () => {
    // 12 h = 43_200_000 ms / 360 px = 120_000 ms/px → 1 min = 0.5 px.
    const dense = (12 * 60 * 60 * 1000) / 360;
    expect(pxDeltaToOffsetMin(0.5, dense)).toBe(1);
    expect(pxDeltaToOffsetMin(15, dense)).toBe(30);
    expect(pxDeltaToOffsetMin(-7.5, dense)).toBe(-15);
  });
});

test.describe("nextPostCheckType", () => {
  test("starts at post_1 when no posts exist", () => {
    expect(nextPostCheckType({})).toBe("post_1");
    expect(nextPostCheckType({ pre: {} })).toBe("post_1");
  });
  test("picks max(post_N) + 1", () => {
    expect(nextPostCheckType({ pre: {}, post_1: {} })).toBe("post_2");
    expect(nextPostCheckType({ post_1: {}, post_2: {}, post_5: {} })).toBe("post_6");
  });
  test("ignores non-numeric post_* suffixes (defensive)", () => {
    expect(nextPostCheckType({ post_abc: {}, post_2: {} })).toBe("post_3");
    expect(nextPostCheckType({ post_abc: {} })).toBe("post_1");
  });
});

test.describe("defaultOffsetForNewPost", () => {
  test("returns the spec default (+90) when no posts exist", () => {
    expect(defaultOffsetForNewPost([])).toBe(DEFAULT_POST_OFFSET_MIN);
  });
  test("returns max existing offset + 60", () => {
    expect(defaultOffsetForNewPost([{ offsetMin: 90 }])).toBe(150);
    expect(defaultOffsetForNewPost([{ offsetMin: 30 }, { offsetMin: 90 }])).toBe(150);
  });
  test("clamps to the post upper bound 180", () => {
    expect(defaultOffsetForNewPost([{ offsetMin: 150 }])).toBe(POST_MAX_OFFSET_MIN);
    expect(defaultOffsetForNewPost([{ offsetMin: 180 }])).toBe(POST_MAX_OFFSET_MIN);
  });
});

test.describe("defaults match the product spec from Task #673", () => {
  test("pre default is -15", () => {
    expect(DEFAULT_PRE_OFFSET_MIN).toBe(-15);
  });
  test("post default is +90", () => {
    expect(DEFAULT_POST_OFFSET_MIN).toBe(90);
  });
  test("pre band is [-60, -1]", () => {
    expect(PRE_MIN_OFFSET_MIN).toBe(-60);
    expect(PRE_MAX_OFFSET_MIN).toBe(-1);
  });
  test("post band is [+1, +180]", () => {
    expect(POST_MIN_OFFSET_MIN).toBe(1);
    expect(POST_MAX_OFFSET_MIN).toBe(180);
  });
});

// ── bgCheckColor — Task #739 ─────────────────────────────────────────────────
// Pins the 5-zone clinical color model for the glucose badge on each
// meal-node-cluster knob (Task #739: "Show BZ check results on the
// meal node cluster").
//
// Zones:
//   < 70 mg/dL    → red   (#EF4444) — hypoglycemia
//   70–80 mg/dL   → amber (#F59E0B) — borderline low
//   80–160 mg/dL  → green (#22C55E) — ideal post-meal range
//   160–180 mg/dL → amber (#F59E0B) — borderline high
//   > 180 mg/dL   → red   (#EF4444) — hyperglycemia
//
// Both hypo and hyper map to red; borderline edges map to amber.

const RED   = "#EF4444";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";

test.describe("bgCheckColor", () => {
  // ── hypo (red) ──────────────────────────────────────────────────────
  test("hypoglycemia (< 70 mg/dL) → red", () => {
    expect(bgCheckColor(0)).toBe(RED);
    expect(bgCheckColor(40)).toBe(RED);
    expect(bgCheckColor(54)).toBe(RED);  // Level-2 hypo threshold
    expect(bgCheckColor(69)).toBe(RED);
    expect(bgCheckColor(69.9)).toBe(RED);
  });

  // ── borderline low (amber) ──────────────────────────────────────────
  test("boundary 70 mg/dL → amber (borderline low, not green)", () => {
    expect(bgCheckColor(70)).toBe(AMBER);
  });
  test("75 mg/dL → amber (borderline low midpoint)", () => {
    expect(bgCheckColor(75)).toBe(AMBER);
  });
  test("boundary 80 mg/dL → amber (borderline low upper edge, inclusive)", () => {
    expect(bgCheckColor(80)).toBe(AMBER);
  });

  // ── ideal range (green) ─────────────────────────────────────────────
  test("81 mg/dL → green (just inside ideal range)", () => {
    expect(bgCheckColor(81)).toBe(GREEN);
  });
  test("in-range values (81–160 mg/dL) → green", () => {
    expect(bgCheckColor(100)).toBe(GREEN);
    expect(bgCheckColor(112)).toBe(GREEN);  // spec example
    expect(bgCheckColor(140)).toBe(GREEN);
  });
  test("boundary 160 mg/dL → green (ideal upper edge, inclusive)", () => {
    expect(bgCheckColor(160)).toBe(GREEN);
  });

  // ── borderline high (amber) ─────────────────────────────────────────
  test("161 mg/dL → amber (just above ideal, borderline high)", () => {
    expect(bgCheckColor(161)).toBe(AMBER);
  });
  test("170 mg/dL → amber (borderline high midpoint)", () => {
    expect(bgCheckColor(170)).toBe(AMBER);
  });
  test("boundary 180 mg/dL → amber (borderline high upper edge, inclusive)", () => {
    expect(bgCheckColor(180)).toBe(AMBER);
  });

  // ── hyper (red) ─────────────────────────────────────────────────────
  test("hyperglycemia (> 180 mg/dL) → red", () => {
    expect(bgCheckColor(181)).toBe(RED);
    expect(bgCheckColor(200)).toBe(RED);
    expect(bgCheckColor(250)).toBe(RED);
    expect(bgCheckColor(400)).toBe(RED);
  });
});
