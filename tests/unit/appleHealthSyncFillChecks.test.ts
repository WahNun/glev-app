/**
 * Unit tests for `upsertAndFillAppleHealthRows`
 * (app/api/cgm/apple-health/sync/route.ts).
 *
 * Verifies that `fillNearbyChecks` is called for each row when the Supabase
 * upsert succeeds, and is NOT called when the upsert fails.
 * Follows the same fake-client DI pattern as tests/unit/nightscoutCronFillChecks.test.ts.
 */

import { test, expect } from "@playwright/test";
import {
  upsertAndFillAppleHealthRows,
  type NormalisedRow,
} from "@/app/api/cgm/apple-health/sync/route";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(offsetMs = 0): NormalisedRow {
  return {
    source_uuid: `uuid-${offsetMs}`,
    timestamp: new Date(1_700_000_000_000 + offsetMs).toISOString(),
    value_mg_dl: 120 + offsetMs / 60_000,
  };
}

/**
 * Fake Supabase client that supports the `.upsert(...).select("id")` chain
 * and returns a controlled error or stub data rows.
 */
function makeFakeAdmin(upsertError: { message: string } | null, insertedCount = 1): {
  client: SupabaseClient;
  upsertCallCount: () => number;
} {
  let upsertCount = 0;

  const client = {
    from(_table: string) {
      return {
        upsert(_rows: unknown, _opts: unknown) {
          upsertCount++;
          return {
            select(_cols: string) {
              if (upsertError) {
                return Promise.resolve({ data: null, error: upsertError });
              }
              const data = Array.from({ length: insertedCount }, (_, i) => ({ id: i + 1 }));
              return Promise.resolve({ data, error: null });
            },
          };
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

test("upsertAndFillAppleHealthRows: success → fillFn called for each row", async () => {
  const rows = [makeRow(0), makeRow(60_000), makeRow(120_000)];
  const { client } = makeFakeAdmin(null, rows.length);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(3);
  expect(calls.map((c) => c.value)).toEqual(rows.map((r) => r.value_mg_dl));
});

test("upsertAndFillAppleHealthRows: success → fillFn receives correct userId and timestamp", async () => {
  const row = makeRow(0);
  const { client } = makeFakeAdmin(null, 1);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillAppleHealthRows(client, "user-ah", [row], fillFn);

  expect(calls[0].userId).toBe("user-ah");
  expect(calls[0].ts).toBe(row.timestamp);
  expect(calls[0].value).toBe(row.value_mg_dl);
});

test("upsertAndFillAppleHealthRows: upsert fails → fillFn NOT called", async () => {
  const rows = [makeRow(0), makeRow(60_000)];
  const { client } = makeFakeAdmin({ message: "unique constraint violation" });
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(false);
  expect(result.error).toBe("unique constraint violation");
  expect(calls).toHaveLength(0);
});

test("upsertAndFillAppleHealthRows: single row success → exactly one fill call", async () => {
  const row = makeRow(0);
  const { client } = makeFakeAdmin(null, 1);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillAppleHealthRows(client, "user-ah", [row], fillFn);

  expect(calls).toHaveLength(1);
});

test("upsertAndFillAppleHealthRows: success → inserted count returned", async () => {
  const rows = [makeRow(0), makeRow(60_000)];
  const { client } = makeFakeAdmin(null, 2);
  const { fn: fillFn } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(true);
  expect(result.inserted).toBe(2);
});
