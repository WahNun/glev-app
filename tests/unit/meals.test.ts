// Unit coverage for `fetchMeals` / `fetchMealsForEngine` in
// `lib/meals.ts` — Task #192 capped the meals pull so power-users
// with 1–2 years of tracking data don't drag thousands of rows into
// every render of the engine / insights / history pages.
//
// What this pins:
//   1. The default 365-day cap on the general fetch path. Rows older
//      than the cutoff are filtered server-side via `.gte("created_at",
//      cutoffIso)` and never reach the caller.
//   2. The 90-day cap on the engine-only wrapper (`fetchMealsForEngine`).
//      The pattern detector and adaptive ICR only consume the most
//      recent ~20 finalized meals — anything older distorts the
//      morning/afternoon/evening ICR averages without changing the
//      recommendation.
//   3. The cutoff is calculated from `Date.now()` and applied to
//      `created_at` (NOT meal_time, which can be backdated).
//
// Why this is a Playwright spec (no browser):
//   The repo's only test runner is Playwright. The widened
//   `testDir: "./tests"` in `playwright.config.ts` automatically picks
//   up files under `tests/unit/*.test.ts` alongside the e2e specs.
//   `fetchMeals` accepts a `client` test-seam so we can hand it a stub
//   Supabase client without touching the real module singleton.

import { test, expect } from "@playwright/test";

import {
  fetchMeals,
  fetchMealsForEngine,
  FETCH_MEALS_DEFAULT_SINCE_DAYS,
  FETCH_MEALS_ENGINE_SINCE_DAYS,
  type FetchMealsOptions,
} from "@/lib/meals";

// ──────────────────────────────────────────────────────────────────
// Tiny PostgREST query-builder stub. Captures the `.gte(col, val)`
// arguments so the test can assert which cutoff was applied, and
// returns whatever rows the harness was seeded with. Mirrors only the
// chained methods that `fetchMeals` actually calls
// (`.from().select().gte().order()`), and is fluent (every method
// returns `this`) so any chain order works.
// ──────────────────────────────────────────────────────────────────
interface GteCall { column: string; value: string; }

function makeStubClient(rows: unknown[]) {
  const gteCalls: GteCall[] = [];
  let lastSelect = "";

  // Each call to `.from("meals")` resets the row pipeline, so the
  // builder rebuilds itself per-call. We retain the same `gteCalls`
  // accumulator across the lifetime of the client so the test can
  // inspect the entire chain history.
  const builder = {
    select(cols: string) {
      lastSelect = cols;
      return builder;
    },
    gte(column: string, value: string) {
      gteCalls.push({ column, value });
      return builder;
    },
    // `.order()` is the terminator that `fetchMeals` awaits — return
    // the canned result here so the awaited promise resolves cleanly.
    async order(_col: string, _opts: { ascending: boolean }) {
      return { data: rows, error: null };
    },
  };

  const client = {
    from(_table: string) { return builder; },
  };

  return {
    client: client as unknown as NonNullable<FetchMealsOptions["client"]>,
    gteCalls,
    lastSelect: () => lastSelect,
  };
}

/* ──────────────────────────────────────────────────────────────────
   Cutoff calculation — `fetchMeals` filters server-side via
   `.gte("created_at", <cutoff>)`. The cutoff is `Date.now() - sinceDays
   * 86_400_000`. We pin both the column and a tight upper bound on the
   gap between the cutoff and "now" (a generous 5s allows for slow CI).
   ────────────────────────────────────────────────────────────────── */

test("fetchMeals defaults to a 365-day server-side cutoff", async () => {
  const stub = makeStubClient([]);
  const before = Date.now();
  await fetchMeals({ client: stub.client });
  const after = Date.now();

  expect(FETCH_MEALS_DEFAULT_SINCE_DAYS).toBe(365);
  expect(stub.gteCalls).toHaveLength(1);
  expect(stub.gteCalls[0].column).toBe("created_at");

  const cutoffMs = Date.parse(stub.gteCalls[0].value);
  const expectedMin = before - 365 * 86_400_000;
  const expectedMax = after  - 365 * 86_400_000;
  expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin);
  expect(cutoffMs).toBeLessThanOrEqual(expectedMax);
});

test("fetchMealsForEngine narrows the cutoff to 90 days", async () => {
  const stub = makeStubClient([]);
  const before = Date.now();
  await fetchMealsForEngine({ client: stub.client });
  const after = Date.now();

  expect(FETCH_MEALS_ENGINE_SINCE_DAYS).toBe(90);
  expect(stub.gteCalls).toHaveLength(1);
  expect(stub.gteCalls[0].column).toBe("created_at");

  const cutoffMs = Date.parse(stub.gteCalls[0].value);
  const expectedMin = before - 90 * 86_400_000;
  const expectedMax = after  - 90 * 86_400_000;
  expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin);
  expect(cutoffMs).toBeLessThanOrEqual(expectedMax);
});

test("fetchMeals honours an explicit sinceDays override", async () => {
  const stub = makeStubClient([]);
  const before = Date.now();
  await fetchMeals({ sinceDays: 7, client: stub.client });
  const after = Date.now();

  const cutoffMs = Date.parse(stub.gteCalls[0].value);
  expect(cutoffMs).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
  expect(cutoffMs).toBeLessThanOrEqual(after  - 7 * 86_400_000);
});

test("fetchMeals returns the rows the client emits, untouched", async () => {
  // `fetchMeals` casts the result to `Meal[]` but does no
  // post-filtering of its own — the cutoff is enforced server-side.
  // This pins the contract: whatever the client returns is what the
  // caller sees, in the same order.
  const fakeRows = [
    { id: "a", created_at: "2026-04-30T00:00:00Z" },
    { id: "b", created_at: "2026-04-29T00:00:00Z" },
  ];
  const stub = makeStubClient(fakeRows);
  const result = await fetchMeals({ client: stub.client });
  expect(result.map(r => r.id)).toEqual(["a", "b"]);
});

// ──────────────────────────────────────────────────────────────────
// End-to-end exclusion: simulate a Supabase that *honours* the gte
// cutoff and seed it with mixed-age rows. Pins the spec'd "Mahlzeiten
// älter als der Cutoff werden nicht geliefert" promise rather than
// just the wire-call wiring.
// ──────────────────────────────────────────────────────────────────
function makeFilteringStubClient(rows: Array<{ id: string; created_at: string }>) {
  let cutoff: number | null = null;
  const builder = {
    select() { return builder; },
    gte(_col: string, value: string) { cutoff = Date.parse(value); return builder; },
    async order(_col: string, _opts: { ascending: boolean }) {
      const filtered = cutoff == null
        ? rows
        : rows.filter(r => Date.parse(r.created_at) >= (cutoff as number));
      // Mirror the production sort (newest first) so order assertions
      // line up with what real PostgREST would emit.
      filtered.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return { data: filtered, error: null };
    },
  };
  const client = { from(_t: string) { return builder; } };
  return client as unknown as NonNullable<FetchMealsOptions["client"]>;
}

test("fetchMealsForEngine excludes meals older than 90 days", async () => {
  const now = Date.now();
  const dayAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const seeded = [
    { id: "today",    created_at: dayAgo(0)   },
    { id: "d30",      created_at: dayAgo(30)  },
    { id: "d89",      created_at: dayAgo(89)  },
    { id: "d100",     created_at: dayAgo(100) },  // outside engine window
    { id: "d300",     created_at: dayAgo(300) },  // outside engine window
    { id: "year_ago", created_at: dayAgo(400) },  // outside both windows
  ];
  const client = makeFilteringStubClient(seeded);
  const engine = await fetchMealsForEngine({ client });
  expect(engine.map(r => r.id)).toEqual(["today", "d30", "d89"]);
});

test("fetchMeals default excludes meals older than 365 days but keeps the rest", async () => {
  const now = Date.now();
  const dayAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const seeded = [
    { id: "d10",   created_at: dayAgo(10)  },
    { id: "d100",  created_at: dayAgo(100) },
    { id: "d364",  created_at: dayAgo(364) },
    { id: "d400",  created_at: dayAgo(400) },  // outside default window
    { id: "d800",  created_at: dayAgo(800) },  // outside default window
  ];
  const client = makeFilteringStubClient(seeded);
  const result = await fetchMeals({ client });
  expect(result.map(r => r.id)).toEqual(["d10", "d100", "d364"]);
});

test("fetchMeals skips the gte filter when sinceDays is Infinity", async () => {
  // Escape hatch for one-off exports / tests that intentionally want
  // every row. The implementation guards on `Number.isFinite` so any
  // non-finite value (Infinity, NaN) skips the filter.
  const stub = makeStubClient([]);
  await fetchMeals({ sinceDays: Infinity, client: stub.client });
  expect(stub.gteCalls).toHaveLength(0);
});
