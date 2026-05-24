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
