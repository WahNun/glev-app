/**
 * Unit tests for `pollOne` (app/api/cron/cgm-poll/route.ts).
 *
 * Verifies that `fillNearbyChecks` is called for each upserted row when the
 * Supabase upsert succeeds, and is NOT called when the upsert fails — for
 * both "llu" and "nightscout" sources.
 * Follows the same fake-client DI pattern as tests/unit/fillNearbyChecks.test.ts.
 */

import { test, expect } from "@playwright/test";
import { pollOne } from "@/app/api/cron/cgm-poll/route";
import type { Reading } from "@/lib/cgm/llu";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Fake builders ─────────────────────────────────────────────────────────────

/** Creates a Reading with a valid ISO timestamp and positive value. */
function makeReading(valueMgdl: number, isoTs: string): Reading {
  return { value: valueMgdl, unit: "mg/dL", timestamp: isoTs, trend: "Flat" };
}

/** Fake getHistory stub that returns a fixed history array. */
function makeGetHistory(readings: Reading[]): (userId: string) => Promise<{
  history: Reading[];
  current: Reading | null;
}> {
  return async (_userId) => ({ history: readings, current: null });
}

/** Fake Supabase client whose upsert resolves with a controlled error. */
function makeFakeAdmin(upsertError: { message: string } | null): {
  client: SupabaseClient;
  upsertCallCount: () => number;
} {
  let count = 0;
  const client = {
    from(_table: string) {
      return {
        upsert(_rows: unknown, _opts: unknown) {
          count++;
          return Promise.resolve({ error: upsertError });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upsertCallCount: () => count };
}

/** Fake fillNearbyChecks that records calls synchronously. */
function makeFakeFill(): {
  fn: typeof import("@/lib/mealTimelineChecks").fillNearbyChecks;
  calls: Array<{ userId: string; value: number }>;
} {
  const calls: Array<{ userId: string; value: number }> = [];
  const fn = (
    _admin: SupabaseClient,
    userId: string,
    value: number,
    _measuredAt: Date,
  ): Promise<void> => {
    calls.push({ userId, value });
    return Promise.resolve();
  };
  return { fn, calls };
}

// ── LLU source tests ──────────────────────────────────────────────────────────

test("pollOne (llu): upsert success → fillFn called for each row", async () => {
  const readings = [
    makeReading(110, "2026-05-27T08:00:00.000Z"),
    makeReading(120, "2026-05-27T08:05:00.000Z"),
    makeReading(130, "2026-05-27T08:10:00.000Z"),
  ];
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await pollOne("user-llu", "llu", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.inserted).toBe(3);
  expect(calls).toHaveLength(3);
  expect(calls.map((c) => c.value)).toEqual([110, 120, 130]);
});

test("pollOne (llu): upsert fails → fillFn NOT called", async () => {
  const readings = [
    makeReading(100, "2026-05-27T08:00:00.000Z"),
    makeReading(105, "2026-05-27T08:05:00.000Z"),
  ];
  const { client } = makeFakeAdmin({ message: "db write error" });
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await pollOne("user-llu", "llu", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(result.ok).toBe(false);
  expect(calls).toHaveLength(0);
});

test("pollOne (llu): empty history → no upsert, no fill", async () => {
  const { client, upsertCallCount } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await pollOne("user-llu", "llu", {
    getHistory: makeGetHistory([]),
    adminInstance: client,
    fillFn,
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.inserted).toBe(0);
  expect(upsertCallCount()).toBe(0);
  expect(calls).toHaveLength(0);
});

test("pollOne (llu): fillFn receives correct userId and mg/dL value", async () => {
  const readings = [makeReading(142, "2026-05-27T10:00:00.000Z")];
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  await pollOne("user-abc", "llu", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].userId).toBe("user-abc");
  expect(calls[0].value).toBe(142);
});

// ── Nightscout source tests ───────────────────────────────────────────────────

test("pollOne (nightscout): upsert success → fillFn called for each row", async () => {
  const readings = [
    makeReading(95, "2026-05-27T07:00:00.000Z"),
    makeReading(98, "2026-05-27T07:05:00.000Z"),
  ];
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await pollOne("user-ns", "nightscout", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.inserted).toBe(2);
  expect(calls).toHaveLength(2);
  expect(calls.map((c) => c.value)).toEqual([95, 98]);
});

test("pollOne (nightscout): upsert fails → fillFn NOT called", async () => {
  const readings = [makeReading(88, "2026-05-27T07:00:00.000Z")];
  const { client } = makeFakeAdmin({ message: "upsert conflict" });
  const { fn: fillFn, calls } = makeFakeFill();

  const result = await pollOne("user-ns", "nightscout", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(result.ok).toBe(false);
  expect(calls).toHaveLength(0);
});

test("pollOne (nightscout): empty history → no fill", async () => {
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  await pollOne("user-ns", "nightscout", {
    getHistory: makeGetHistory([]),
    adminInstance: client,
    fillFn,
  });

  expect(calls).toHaveLength(0);
});

test("pollOne (nightscout): single row → exactly one fill call with correct value", async () => {
  const readings = [makeReading(75, "2026-05-27T06:00:00.000Z")];
  const { client } = makeFakeAdmin(null);
  const { fn: fillFn, calls } = makeFakeFill();

  await pollOne("user-ns", "nightscout", {
    getHistory: makeGetHistory(readings),
    adminInstance: client,
    fillFn,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].value).toBe(75);
  expect(calls[0].userId).toBe("user-ns");
});
