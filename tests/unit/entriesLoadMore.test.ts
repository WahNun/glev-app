// Regression test: entries page "Load more" page size is pinned to 50 (Task #952)
//
// Without a pinning test the 50-row page size could silently regress —
// someone bumps `MEALS_PAGE_SIZE` and users with large histories either
// see incomplete load-more results or unnecessary extra round-trips, with
// no safety net to catch it.
//
// Strategy
// --------
// `app/(protected)/entries/constants.ts` exports `executeLoadMoreFetch(fn, before, sinceIso?)`,
// the exact function that `page.tsx` calls inside `loadMoreMeals`:
//
//   const more = await executeLoadMoreFetch(
//     fetchMeals,
//     oldestMealCreatedAt.current,
//     historyLimitISO ?? undefined,
//   );
//
// The test injects a stub for `fn` and asserts the recorded arguments —
// it exercises the real production code path without mounting the React
// component (which requires a browser + Next.js server).
//
// Covered assertions
// ------------------
//   1. `MEALS_PAGE_SIZE` constant is exactly 50.
//   2. `executeLoadMoreFetch` calls the stub with `limit: 50`.
//   3. `executeLoadMoreFetch` calls the stub with `sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS` (365).
//   4. `executeLoadMoreFetch` forwards the `before` cursor unchanged.
//   5. When `sinceIso` is provided, it is forwarded to the stub.
//   6. When `sinceIso` is omitted, the field is `undefined`.

import { test, expect } from "@playwright/test";

import {
  MEALS_PAGE_SIZE,
  executeLoadMoreFetch,
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

const SAMPLE_CURSOR = "2026-01-15T10:00:00.000Z";

// ---------------------------------------------------------------------------
// 1. The MEALS_PAGE_SIZE constant
// ---------------------------------------------------------------------------

test("MEALS_PAGE_SIZE is 50", () => {
  expect(MEALS_PAGE_SIZE).toBe(50);
});

// ---------------------------------------------------------------------------
// 2. executeLoadMoreFetch passes limit: 50
// ---------------------------------------------------------------------------

test("executeLoadMoreFetch calls the stub with limit: MEALS_PAGE_SIZE (50)", async () => {
  const { fn, calls } = makeStub();

  await executeLoadMoreFetch(fn, SAMPLE_CURSOR);

  expect(calls).toHaveLength(1);
  expect(calls[0].limit).toBe(MEALS_PAGE_SIZE);
  expect(calls[0].limit).toBe(50);
});

// ---------------------------------------------------------------------------
// 3. executeLoadMoreFetch passes sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS (365)
// ---------------------------------------------------------------------------

test("executeLoadMoreFetch calls the stub with sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS (365)", async () => {
  const { fn, calls } = makeStub();

  await executeLoadMoreFetch(fn, SAMPLE_CURSOR);

  expect(calls[0].sinceDays).toBe(FETCH_MEALS_DEFAULT_SINCE_DAYS);
  expect(calls[0].sinceDays).toBe(365);
});

// ---------------------------------------------------------------------------
// 4. executeLoadMoreFetch forwards the `before` cursor unchanged
// ---------------------------------------------------------------------------

test("executeLoadMoreFetch forwards the before cursor to the stub", async () => {
  const { fn, calls } = makeStub();

  await executeLoadMoreFetch(fn, SAMPLE_CURSOR);

  expect(calls[0].before).toBe(SAMPLE_CURSOR);
});

// ---------------------------------------------------------------------------
// 5. sinceIso is forwarded when provided
// ---------------------------------------------------------------------------

test("executeLoadMoreFetch forwards sinceIso when provided", async () => {
  const { fn, calls } = makeStub();
  const planCutoff = "2025-06-01T00:00:00.000Z";

  await executeLoadMoreFetch(fn, SAMPLE_CURSOR, planCutoff);

  expect(calls[0].sinceIso).toBe(planCutoff);
});

// ---------------------------------------------------------------------------
// 6. sinceIso is undefined when not provided
// ---------------------------------------------------------------------------

test("executeLoadMoreFetch passes sinceIso as undefined when omitted", async () => {
  const { fn, calls } = makeStub();

  await executeLoadMoreFetch(fn, SAMPLE_CURSOR);

  expect(calls[0].sinceIso).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 7. Sanity: MEALS_PAGE_SIZE is well below Infinity (not a full-history pull)
// ---------------------------------------------------------------------------

test("MEALS_PAGE_SIZE (50) is finite — not a full-history pull", () => {
  expect(isFinite(MEALS_PAGE_SIZE)).toBe(true);
  expect(MEALS_PAGE_SIZE).toBeGreaterThan(0);
});
