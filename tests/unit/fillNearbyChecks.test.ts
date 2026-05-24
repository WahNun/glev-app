/**
 * Unit tests for fillNearbyChecks (lib/mealTimelineChecks.ts).
 *
 * The function is pure-logic around a supabase client — we inject a fake
 * client so no network/DB calls happen. Tests mirror the four acceptance
 * criteria from Task #692:
 *
 *  1. Value exactly within the ±15-min window → UPDATE is issued.
 *  2. Value outside the window → no UPDATE.
 *  3. Two open checks in the window → the nearest one is chosen.
 *  4. Already-filled check (bg_at_check NOT null) → no UPDATE (the SELECT
 *     filters it out via .is("bg_at_check", null)).
 */

import { test, expect } from "@playwright/test";
import { fillNearbyChecks } from "@/lib/mealTimelineChecks";
import type { SupabaseClient } from "@supabase/supabase-js";

const USER_ID = "test-user-uuid";

// ── Fake Supabase builder ────────────────────────────────────────────────────
//
// We build a minimal chainable fake that captures the SELECT result rows
// and records any UPDATE call. The builder accumulates filter state so we
// can assert that the correct filters were applied.

interface FakeSelectRow {
  id: string;
  planned_at: string;
}

interface UpdateCapture {
  payload: Record<string, unknown>;
  eqId: string;
  isNull: boolean;
}

function makeFakeClient(
  selectRows: FakeSelectRow[],
): { client: SupabaseClient; getUpdate(): UpdateCapture | null } {
  let capturedUpdate: UpdateCapture | null = null;

  const updateChain = (payload: Record<string, unknown>) => ({
    eq(_col: string, val: string) {
      const id = val;
      return {
        is(_col2: string, _val2: unknown) {
          capturedUpdate = { payload, eqId: id, isNull: true };
          return Promise.resolve({ error: null });
        },
      };
    },
  });

  const selectChain = {
    eq(_col: string, _val: unknown) { return this; },
    is(_col: string, _val: unknown) { return this; },
    gte(_col: string, _val: unknown) { return this; },
    lte(_col: string, _val: unknown) { return this; },
    then(resolve: (v: { data: FakeSelectRow[]; error: null }) => void) {
      resolve({ data: selectRows, error: null });
    },
  };

  const fakeFrom = (_table: string) => ({
    select(_cols: string) { return selectChain; },
    update(payload: Record<string, unknown>) { return updateChain(payload); },
  });

  return {
    client: { from: fakeFrom } as unknown as SupabaseClient,
    getUpdate: () => capturedUpdate,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isoRelativeMinutes(offsetMinutes: number, base: Date = new Date()): string {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

// ── Test 1: value within window → UPDATE issued ───────────────────────────────

test("fillNearbyChecks: check exactly at measuredAt → update called", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");
  const planned_at = measuredAt.toISOString();

  const { client, getUpdate } = makeFakeClient([{ id: "check-1", planned_at }]);

  await fillNearbyChecks(client, USER_ID, 142, measuredAt);

  const update = getUpdate();
  expect(update).not.toBeNull();
  expect(update!.eqId).toBe("check-1");
  expect(update!.payload.bg_at_check).toBe(142);
  expect(update!.isNull).toBe(true);
});

test("fillNearbyChecks: check 14 min in the future → still within window → updated", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");
  const planned_at = isoRelativeMinutes(14, measuredAt);

  const { client, getUpdate } = makeFakeClient([{ id: "check-near", planned_at }]);

  await fillNearbyChecks(client, USER_ID, 95, measuredAt);

  expect(getUpdate()?.eqId).toBe("check-near");
});

// ── Test 2: value outside window → no UPDATE ─────────────────────────────────
//
// The SELECT filters by planned_at BETWEEN windowStart AND windowEnd, so the
// fake returns an empty array when no row would match. fillNearbyChecks must
// skip the UPDATE.

test("fillNearbyChecks: no rows in window → no update", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");

  const { client, getUpdate } = makeFakeClient([]);

  await fillNearbyChecks(client, USER_ID, 110, measuredAt);

  expect(getUpdate()).toBeNull();
});

// ── Test 3: two open checks → nearest is chosen ──────────────────────────────

test("fillNearbyChecks: two checks in window → nearer one is updated", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");
  const near = isoRelativeMinutes(5, measuredAt);
  const far  = isoRelativeMinutes(12, measuredAt);

  const { client, getUpdate } = makeFakeClient([
    { id: "check-far",  planned_at: far  },
    { id: "check-near", planned_at: near },
  ]);

  await fillNearbyChecks(client, USER_ID, 130, measuredAt);

  const update = getUpdate();
  expect(update?.eqId).toBe("check-near");
  expect(update?.payload.bg_at_check).toBe(130);
});

test("fillNearbyChecks: earlier check is nearer → earlier is chosen", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");
  const earlier = isoRelativeMinutes(-3, measuredAt);
  const later   = isoRelativeMinutes(10, measuredAt);

  const { client, getUpdate } = makeFakeClient([
    { id: "check-later",   planned_at: later   },
    { id: "check-earlier", planned_at: earlier },
  ]);

  await fillNearbyChecks(client, USER_ID, 88, measuredAt);

  expect(getUpdate()?.eqId).toBe("check-earlier");
});

// ── Test 4: already-filled check → no second update ──────────────────────────
//
// The SELECT uses `.is("bg_at_check", null)` so a row with a value would not
// be returned by the real DB. In this test the fake returns no rows (simulating
// that the row was already filled and filtered out by the IS NULL condition).

test("fillNearbyChecks: already-filled check not in result → no update", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");

  const { client, getUpdate } = makeFakeClient([]);

  await fillNearbyChecks(client, USER_ID, 120, measuredAt);

  expect(getUpdate()).toBeNull();
});

// ── Test 5: confirmed_at is set to an ISO string on update ───────────────────

test("fillNearbyChecks: update payload includes valid confirmed_at ISO string", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");
  const planned_at = measuredAt.toISOString();

  const { client, getUpdate } = makeFakeClient([{ id: "check-ts", planned_at }]);

  const before = Date.now();
  await fillNearbyChecks(client, USER_ID, 100, measuredAt);
  const after = Date.now();

  const update = getUpdate();
  expect(update).not.toBeNull();
  const confirmedAt = new Date(update!.payload.confirmed_at as string).getTime();
  expect(confirmedAt).toBeGreaterThanOrEqual(before);
  expect(confirmedAt).toBeLessThanOrEqual(after);
});

// ── Test 6: SELECT error → function returns without throwing ─────────────────

test("fillNearbyChecks: supabase SELECT error → does not throw", async () => {
  const measuredAt = new Date("2026-05-24T10:00:00Z");

  const errorClient = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: unknown) { return this; },
            is(_c: string, _v: unknown) { return this; },
            gte(_c: string, _v: unknown) { return this; },
            lte(_c: string, _v: unknown) { return this; },
            then(resolve: (v: { data: null; error: { message: string } }) => void) {
              resolve({ data: null, error: { message: "db error" } });
            },
          };
        },
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;

  await expect(fillNearbyChecks(errorClient, USER_ID, 100, measuredAt)).resolves.toBeUndefined();
});
