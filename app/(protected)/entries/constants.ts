import {
  FETCH_MEALS_DEFAULT_SINCE_DAYS,
  type FetchMealsOptions,
  type Meal,
} from "@/lib/meals";

/**
 * How many days of meal history the entries page fetches on initial
 * render. Older rows are loaded on demand via the "Load more" button
 * (server-side pagination, Task #197). Exported so the automated
 * regression test in tests/unit/entriesInitialLoad.test.ts can pin
 * this value and catch accidental changes.
 */
export const MEALS_INITIAL_DAYS = 30;

/**
 * How many rows are fetched per "Load more" page. Exported so the
 * regression test in tests/unit/entriesLoadMore.test.ts can pin the
 * value and catch accidental changes (Task #952).
 */
export const MEALS_PAGE_SIZE = 50;

/**
 * Returns the `fetchMeals` options used by `loadFull(initial: true)`
 * on the first render of the entries page.
 */
export function initialLoadOptions(): FetchMealsOptions {
  return { sinceDays: MEALS_INITIAL_DAYS, limit: Infinity };
}

/**
 * Executes the initial meal fetch for the entries page by calling `fn`
 * with the correct bounded options (`sinceDays: 30, limit: Infinity`).
 *
 * Accepting `fn` as a parameter makes the call testable: the unit test
 * in `tests/unit/entriesInitialLoad.test.ts` injects a stub and asserts
 * the exact arguments without mounting the React component.  The
 * production caller passes the real `fetchMeals` from `@/lib/meals`.
 *
 * Rules that the test pins:
 *   - `sinceDays` must equal `MEALS_INITIAL_DAYS` (30).
 *   - `limit: Infinity` returns every meal in the 30-day window.
 *   - `sinceDays` must NOT be `FETCH_MEALS_DEFAULT_SINCE_DAYS` (365) —
 *     the full-history background fetch was removed in Task #197.
 */
export function executeInitialMealFetch(
  fn: (opts: FetchMealsOptions) => Promise<Meal[]>,
): Promise<Meal[]> {
  return fn(initialLoadOptions());
}

/**
 * Returns the `fetchMeals` options used by the "Load more" handler.
 *
 * @param before  ISO timestamp of the oldest already-loaded meal (cursor).
 * @param sinceIso  Optional plan-based ISO cutoff from `getHistoryCutoffISO()`.
 *                  When set, it takes precedence if it's more restrictive than
 *                  the `sinceDays` cap.
 */
export function loadMoreOptions(
  before: string,
  sinceIso?: string,
): FetchMealsOptions {
  return {
    before,
    sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS,
    sinceIso,
    limit: MEALS_PAGE_SIZE,
  };
}

/**
 * Executes a "Load more" page fetch for the entries page by calling `fn`
 * with the correct options.
 *
 * Accepting `fn` as a parameter makes the call testable: the unit test
 * in `tests/unit/entriesLoadMore.test.ts` injects a stub and asserts
 * the exact arguments without mounting the React component. The
 * production caller passes the real `fetchMeals` from `@/lib/meals`.
 *
 * Rules that the test pins:
 *   - `limit` must equal `MEALS_PAGE_SIZE` (50).
 *   - `sinceDays` must equal `FETCH_MEALS_DEFAULT_SINCE_DAYS` (365).
 *   - `before` cursor must be forwarded unchanged.
 */
export function executeLoadMoreFetch(
  fn: (opts: FetchMealsOptions) => Promise<Meal[]>,
  before: string,
  sinceIso?: string,
): Promise<Meal[]> {
  return fn(loadMoreOptions(before, sinceIso));
}
