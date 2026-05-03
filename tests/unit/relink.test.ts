// Unit coverage for the bolus↔meal re-link flow added in Task #211.
//
// We can't unit-test the React `RelinkSourceLine` UI here (no DOM
// runner is configured for this repo), but we can lock in the two
// invariants that make the feature trustworthy end-to-end:
//
//   1. The "after the user confirms" transition: a bolus that was
//      previously paired by the ±30-min heuristic must reappear as
//      `source: "explicit"` once `related_entry_id` is set, so the
//      Insights "explizit getaggt" counter ticks up and the row
//      disappears from the relink panel.
//
//   2. The PATCH client helper sends the exact contract the API
//      route validates (method, body shape, null-to-unlink), so the
//      one-tap suggestion in the bolus form and the relink panel
//      both stay wire-compatible with `app/api/insulin/[id]/route.ts`.

import { test, expect } from "@playwright/test";

import { pairBolusesToMeals } from "@/lib/engine/pairing";
import { updateInsulinLogLink } from "@/lib/insulin";
import { makeMeal, makeInsulinLog, FIXTURE_BASE_MS } from "../support/engineFixtures";

function isoAt(offsetMin: number): string {
  return new Date(FIXTURE_BASE_MS + offsetMin * 60_000).toISOString();
}

test("relink upgrades a time-window pair to source=explicit", () => {
  const meal = makeMeal({ id: "m1", meal_time: isoAt(10), created_at: isoAt(10) });
  const bolusBefore = makeInsulinLog({ id: "b1", related_entry_id: null, created_at: isoAt(0) });

  const before = pairBolusesToMeals([bolusBefore], [meal]);
  expect(before).toHaveLength(1);
  expect(before[0].source).toBe("time-window");

  // Simulate the user tapping "Bestätigen" — the PATCH would set
  // related_entry_id; the engine must now treat the same pair as
  // explicit on the next render.
  const bolusAfter = { ...bolusBefore, related_entry_id: "m1" };
  const after = pairBolusesToMeals([bolusAfter], [meal]);
  expect(after).toHaveLength(1);
  expect(after[0].source).toBe("explicit");
  expect(after[0].deltaMs).toBe(0);
});

test("updateInsulinLogLink: PATCHes /api/insulin/[id] with the documented body", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ log: { id: "b1", related_entry_id: "m1" } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await updateInsulinLogLink("b1", "m1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/insulin/b1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ related_entry_id: "m1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateInsulinLogLink: passing null unlinks (the API contract for clearing the tag)", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ log: { id: "b1", related_entry_id: null } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await updateInsulinLogLink("b1", null);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ related_entry_id: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
