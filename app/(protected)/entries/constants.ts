import type { FetchMealsOptions, Meal } from "@/lib/meals";

/**
 * How many days of meal history the entries page fetches on initial
 * render. Older rows are loaded on demand via the "Load more" button
 * (server-side pagination, Task #197). Exported so the automated
 * regression test in tests/unit/entriesInitialLoad.test.ts can pin
 * this value and catch accidental changes.
 */
export const MEALS_INITIAL_DAYS = 30;

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
