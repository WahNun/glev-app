// Regression test: entries page initial load is bounded to 30 days
//
// Without a pinning test the 30-day boundary could silently regress —
// someone bumps `MEALS_INITIAL_DAYS` or re-introduces the old one-shot
// full-history pull, and long-time users see load times spike.
//
// Strategy
// --------
// `app/(protected)/entries/constants.ts` exports `executeInitialMealFetch(fn)`,
// the exact function that `page.tsx` calls inside `loadFull(initial: true)`:
//
//   const [m, ...] = await Promise.all([
//     executeInitialMealFetch(fetchMeals),   ← production call
//     ...
//   ]);
//
// The test injects a stub for `fn` and asserts the recorded arguments —
// it exercises the real production code path without mounting the React
// component (which requires a browser + Next.js server).
//
// Covered assertions
// ------------------
//   1. `MEALS_INITIAL_DAYS` constant is exactly 30.
//   2. `executeInitialMealFetch` calls the stub with `sinceDays: 30`.
//   3. `executeInitialMealFetch` calls the stub with `limit: Infinity`
//      (full 30-day window, no extra per-page row cap).
//   4. No call with `sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS` (365) and
//      `limit: Infinity` fires — this is the full-history background fetch
//      that was removed in Task #197 and must never come back on initial mount.

import { test, expect } from "@playwright/test";

import {
  MEALS_INITIAL_DAYS,
  executeInitialMealFetch,
} from "@/app/(protected)/entries/constants";

import {
  FETCH_MEALS_DEFAULT_SINCE_DAYS,
  type FetchMealsOptions,
  type Meal,
} from "@/lib/meals";

// ---------------------------------------------------------------------------
// Minimal stub: records every call and returns an empty array.
// ---------------------------------------------------------------------------

type StubFn = (opts: FetchMealsOptions) => Promise<Meal[]>;

function makeStub(): { fn: StubFn; calls: FetchMealsOptions[] } {
  const calls: FetchMealsOptions[] = [];
  const fn: StubFn = async (opts) => {
    calls.push({ ...opts });
    return [];
  };
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// 1. The MEALS_INITIAL_DAYS constant
// ---------------------------------------------------------------------------

test("MEALS_INITIAL_DAYS is 30", () => {
  expect(MEALS_INITIAL_DAYS).toBe(30);
});

// ---------------------------------------------------------------------------
// 2 & 3. executeInitialMealFetch passes sinceDays: 30 and limit: Infinity
// ---------------------------------------------------------------------------

test("executeInitialMealFetch calls the stub with sinceDays: 30 on initial render", async () => {
  const { fn, calls } = makeStub();

  await executeInitialMealFetch(fn);

  expect(calls).toHaveLength(1);
  expect(calls[0].sinceDays).toBe(30);
  expect(calls[0].sinceDays).not.toBe(90);
  expect(calls[0].sinceDays).not.toBe(365);
});

test("executeInitialMealFetch calls the stub with limit: Infinity to return the full 30-day window", async () => {
  const { fn, calls } = makeStub();

  await executeInitialMealFetch(fn);

  expect(calls[0].limit).toBe(Infinity);
});

// ---------------------------------------------------------------------------
// 4. No full-history background fetch (sinceDays: 365 + limit: Infinity)
//    fires during initial mount
// ---------------------------------------------------------------------------

test("initial mount does not trigger a fetchMeals call with sinceDays: 365 + limit: Infinity", async () => {
  const { fn, calls } = makeStub();

  // Simulate every fetchMeals call that fires during the initial render:
  //   loadFast: fetchMeals({ limit: 5 })
  //   loadFull: executeInitialMealFetch(fetchMeals)
  // We use the same stub for both so the recording captures all calls.
  await fn({ limit: 5 });            // loadFast path
  await executeInitialMealFetch(fn); // loadFull path — calls the real production helper

  const forbidden = calls.find(
    (c) =>
      c.sinceDays === FETCH_MEALS_DEFAULT_SINCE_DAYS && c.limit === Infinity,
  );

  expect(forbidden).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 5. Sanity: MEALS_INITIAL_DAYS is well below the full-history cap
// ---------------------------------------------------------------------------

test("MEALS_INITIAL_DAYS (30) is strictly less than FETCH_MEALS_DEFAULT_SINCE_DAYS (365)", () => {
  expect(MEALS_INITIAL_DAYS).toBeLessThan(FETCH_MEALS_DEFAULT_SINCE_DAYS);
});
