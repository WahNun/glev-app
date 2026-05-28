/**
 * Unit tests for `upsertAndFillAppleHealthRows`
 * (app/api/cgm/apple-health/sync/route.ts).
 *
 * Verifies that `fillNearbyChecks` is called for each row when the Supabase
 * upsert succeeds, and is NOT called when the upsert fails — mirroring the
 * same DI pattern used in nightscoutCronFillChecks.test.ts and
 * cgmPollFillChecks.test.ts.
 */

import { test, expect } from "@playwright/test";
import {
  upsertAndFillAppleHealthRows,
  type AppleHealthRow,
} from "@/app/api/cgm/apple-health/sync/route";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(offsetMs = 0, valueMgDl = 120): AppleHealthRow {
  return {
    source_uuid: `uuid-${offsetMs}`,
    timestamp: new Date(1_700_000_000_000 + offsetMs).toISOString(),
    value_mg_dl: valueMgDl,
  };
}

/**
 * Fake Supabase client whose upsert().select() resolves with a controlled
 * error and a fixed number of inserted row stubs.
 */
function makeFakeAdmin(
  upsertError: { message: string } | null,
  insertedIds: string[] = [],
): {
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
              return Promise.resolve({
                data: upsertError ? null : insertedIds.map((id) => ({ id })),
                error: upsertError,
              });
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
    _sb: SupabaseClient,
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
  const rows = [makeRow(0, 100), makeRow(60_000, 110), makeRow(120_000, 120)];
  const { client } = makeFakeAdmin(null, ["id-1", "id-2", "id-3"]);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(true);
  expect(result.inserted).toBe(3);
  expect(calls).toHaveLength(3);
  expect(calls.map((c) => c.value)).toEqual([100, 110, 120]);
});

test("upsertAndFillAppleHealthRows: success → fillFn receives correct userId and timestamp", async () => {
  const row = makeRow(0, 142);
  const { client } = makeFakeAdmin(null, ["id-1"]);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillAppleHealthRows(client, "user-ah", [row], fillFn);

  expect(calls).toHaveLength(1);
  expect(calls[0].userId).toBe("user-ah");
  expect(calls[0].value).toBe(142);
  expect(calls[0].ts).toBe(row.timestamp);
});

test("upsertAndFillAppleHealthRows: upsert fails → fillFn NOT called", async () => {
  const rows = [makeRow(0, 95), makeRow(60_000, 98)];
  const { client } = makeFakeAdmin({ message: "unique constraint violation" });
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(false);
  expect(result.error).toBe("unique constraint violation");
  expect(calls).toHaveLength(0);
});

test("upsertAndFillAppleHealthRows: empty rows → no upsert and no fill", async () => {
  const { client, upsertCallCount } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", [], fillFn);

  expect(result.ok).toBe(true);
  expect(result.inserted).toBe(0);
  expect(result.skipped).toBe(0);
  expect(upsertCallCount()).toBe(0);
  expect(calls).toHaveLength(0);
});

test("upsertAndFillAppleHealthRows: single row success → exactly one fill call", async () => {
  const row = makeRow(0, 75);
  const { client } = makeFakeAdmin(null, ["id-1"]);
  const { fn: fillFn, calls } = makeFakeFill();

  await upsertAndFillAppleHealthRows(client, "user-ah", [row], fillFn);

  expect(calls).toHaveLength(1);
  expect(calls[0].value).toBe(75);
});

test("upsertAndFillAppleHealthRows: skipped = rows - inserted when some duplicates ignored", async () => {
  const rows = [makeRow(0, 100), makeRow(60_000, 110), makeRow(120_000, 120)];
  // Only 2 of 3 rows were actually new (third was a duplicate, ignoreDuplicates skipped it)
  const { client } = makeFakeAdmin(null, ["id-1", "id-2"]);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await upsertAndFillAppleHealthRows(client, "user-ah", rows, fillFn);

  expect(result.ok).toBe(true);
  expect(result.inserted).toBe(2);
  expect(result.skipped).toBe(1);
  // fillFn is still called for ALL rows passed in (not just newly inserted ones),
  // matching the fire-and-forget pattern in the other CGM paths.
  expect(calls).toHaveLength(3);
});
