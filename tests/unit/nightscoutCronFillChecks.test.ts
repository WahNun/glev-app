/**
 * Unit tests for `upsertAndFillNightscoutRows`
 * (app/api/cgm/nightscout/cron/route.ts).
 *
 * Verifies that `fillNearbyChecks` is called for each row when the Supabase
 * upsert succeeds, and is NOT called when the upsert fails.
 * Follows the same fake-client DI pattern as tests/unit/fillNearbyChecks.test.ts.
 */

import { test, expect } from "@playwright/test";
import {
  upsertAndFillNightscoutRows,
  type NightscoutRow,
} from "@/app/api/cgm/nightscout/cron/route";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(offsetMs = 0): NightscoutRow {
  return {
    user_id: "user-ns",
    recorded_at: new Date(1_700_000_000_000 + offsetMs).toISOString(),
    value_mgdl: 120 + offsetMs / 60_000,
    direction: "Flat",
    source: "nightscout",
  };
}

/** Fake Supabase client that records upsert calls and returns a controlled error. */
function makeFakeAdmin(upsertError: { message: string } | null): {
  client: SupabaseClient;
  upsertCallCount: () => number;
} {
  let upsertCount = 0;

  const client = {
    from(_table: string) {
      return {
        upsert(_rows: unknown, _opts: unknown) {
          upsertCount++;
          return Promise.resolve({ error: upsertError });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, upsertCallCount: () => upsertCount };
}

/** Fake fillNearbyChecks that records each invocation synchronously. */
function makeFakeFill(): {
  fn: typeof import("@/lib/mealTimelineChecks").fillNearbyChecks;
  calls: Array<{ userId: string; value: number; ts: string }>;
} {
  const calls: Array<{ userId: string; value: number; ts: string }> = [];
  const fn = (
    _admin: SupabaseClient,
    userId: string,
    value: number,
    measuredAt: Date,
  ): Promise<void> => {
    calls.push({ userId, value, ts: measuredAt.toISOString() });
    return Promise.resolve();
  };
  return { fn, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("upsertAndFillNightscoutRows: success → fillFn called for each row", async () => {
  const rows = [makeRow(0), makeRow(60_000), makeRow(120_000)];
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillNightscoutRows(client, "user-ns", rows, fillFn);

  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(3);
  expect(calls.map((c) => c.value)).toEqual(rows.map((r) => r.value_mgdl));
});

test("upsertAndFillNightscoutRows: success → fillFn receives correct userId and timestamp", async () => {
  const row = makeRow(0);
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillNightscoutRows(client, "user-ns", [row], fillFn);

  expect(calls[0].userId).toBe("user-ns");
  expect(calls[0].ts).toBe(row.recorded_at);
  expect(calls[0].value).toBe(row.value_mgdl);
});

test("upsertAndFillNightscoutRows: upsert fails → fillFn NOT called", async () => {
  const rows = [makeRow(0), makeRow(60_000)];
  const { client } = makeFakeAdmin({ message: "unique constraint violation" });
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillNightscoutRows(client, "user-ns", rows, fillFn);

  expect(result.ok).toBe(false);
  expect(result.error).toBe("unique constraint violation");
  expect(calls).toHaveLength(0);
});

test("upsertAndFillNightscoutRows: single row success → exactly one fill call", async () => {
  const row = makeRow(0);
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillNightscoutRows(client, "user-ns", [row], fillFn);

  expect(calls).toHaveLength(1);
});

test("upsertAndFillNightscoutRows: empty rows → no upsert and no fill", async () => {
  const { client, upsertCallCount } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillNightscoutRows(client, "user-ns", [], fillFn);

  expect(result.ok).toBe(true);
  expect(upsertCallCount()).toBe(1);
  expect(calls).toHaveLength(0);
});
