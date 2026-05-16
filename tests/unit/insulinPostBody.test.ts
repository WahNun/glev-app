// Coverage for Task #305 — `POST /api/insulin` accepting `related_entry_id`
// in the request body, so the bolus form can persist an explicit meal
// link in a single round-trip instead of POST + PATCH.
//
// The route's body parsing + normalization is extracted into the pure
// `parseInsulinPostBody()` helper so the three contracts in the task
// "Done looks like" section can be locked in without spinning up a
// Supabase client or the Next runtime:
//
//   1. POST with `related_entry_id` → the insert row carries the
//      reference (engine ICR pairing then sees `source: "explicit"`).
//   2. POST without the field → legacy behaviour, row stays unlinked.
//   3. POST with malformed shape → clean validation error (no orphan
//      reference written). Ownership / existence of the referenced
//      meal is enforced by the FK + RLS on
//      `insulin_logs.related_entry_id` at the DB layer — same as the
//      existing PATCH endpoint relies on — so we don't re-verify that
//      here.
//
// We also pin the basal-clears-the-link invariant: basal logs must
// never carry a `related_entry_id`, because the column has no meaning
// there and the engine ICR pairing skips basals.

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInsulinPostBody, handleInsulinPost } from "@/app/api/insulin/route";

// Build a fake Supabase chain that captures the inserted row and
// returns a configurable response. Mirrors the `.from().insert()
// .select().single()` shape the route actually exercises. The cast
// to `SupabaseClient` is confined to this test helper — production
// code in `app/api/insulin/route.ts` types `handleInsulinPost`
// against the real client.
function makeFakeSb(response: { data: unknown; error: { code?: string; message?: string } | null }) {
  const captured: { table?: string; row?: Record<string, unknown> } = {};
  const sb = {
    from(table: string) {
      captured.table = table;
      return {
        insert(row: Record<string, unknown>) {
          captured.row = row;
          return {
            select(_cols: string) {
              return { single: async () => response };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, captured };
}

const baseBolus = {
  insulin_type: "bolus",
  insulin_name: "Fiasp",
  units: 5,
};

test("POST body with related_entry_id forwards the reference into the insert row", () => {
  const r = parseInsulinPostBody({ ...baseBolus, related_entry_id: "meal-abc" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.related_entry_id).toBe("meal-abc");
  expect(r.row.insulin_type).toBe("bolus");
  expect(r.row.units).toBe(5);
});

test("POST body without related_entry_id leaves the row unlinked (legacy default)", () => {
  const r = parseInsulinPostBody({ ...baseBolus });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.related_entry_id).toBeNull();
});

test("POST body with related_entry_id: null explicitly unlinks", () => {
  const r = parseInsulinPostBody({ ...baseBolus, related_entry_id: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.related_entry_id).toBeNull();
});

test("POST body with malformed related_entry_id returns a clean validation error", () => {
  for (const bad of [123, true, {}, [], { id: "x" }]) {
    const r = parseInsulinPostBody({ ...baseBolus, related_entry_id: bad as unknown });
    expect(r.ok).toBe(false);
    if (r.ok) continue;
    expect(r.error).toMatch(/related_entry_id/);
  }
});

test("basal logs always clear related_entry_id, even if the client sends one", () => {
  const r = parseInsulinPostBody({
    insulin_type: "basal",
    insulin_name: "Tresiba",
    units: 20,
    related_entry_id: "meal-abc",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.related_entry_id).toBeNull();
  expect(r.row.insulin_type).toBe("basal");
});

test("route: writes the row with related_entry_id when the body carries one (HTTP 201)", async () => {
  const { sb, captured } = makeFakeSb({
    data: { id: "log-1", related_entry_id: "meal-abc" },
    error: null,
  });
  const res = await handleInsulinPost(sb, "user-1", {
    ...baseBolus, related_entry_id: "meal-abc",
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.log.related_entry_id).toBe("meal-abc");
  expect(captured.table).toBe("insulin_logs");
  expect(captured.row?.user_id).toBe("user-1");
  expect(captured.row?.related_entry_id).toBe("meal-abc");
});

test("route: POST without related_entry_id persists null (legacy unlinked bolus)", async () => {
  const { sb, captured } = makeFakeSb({
    data: { id: "log-2", related_entry_id: null }, error: null,
  });
  const res = await handleInsulinPost(sb, "user-1", { ...baseBolus });
  expect(res.status).toBe(201);
  expect(captured.row?.related_entry_id).toBeNull();
});

test("route: FK / RLS violation on a foreign meal id surfaces as a clean error (no orphan write)", async () => {
  // PostgrestError shape for a foreign-key violation (the case where
  // `related_entry_id` points at a meal that doesn't belong to the
  // user — RLS on `meals` hides it, so the FK to `meals.id` fails).
  const { sb, captured } = makeFakeSb({
    data: null,
    error: { code: "23503", message: 'insert or update on table "insulin_logs" violates foreign key constraint "insulin_logs_related_entry_id_fkey"' },
  });
  const res = await handleInsulinPost(sb, "user-1", {
    ...baseBolus, related_entry_id: "meal-belonging-to-someone-else",
  });
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(typeof body.error).toBe("string");
  expect(body.error).toMatch(/foreign key/i);
  // The route still passed the would-be row to insert exactly once;
  // the DB rejected it, so no orphan row was persisted.
  expect(captured.row?.related_entry_id).toBe("meal-belonging-to-someone-else");
});

test("route: malformed related_entry_id is rejected before the insert ever runs (HTTP 400)", async () => {
  const { sb, captured } = makeFakeSb({ data: null, error: null });
  const res = await handleInsulinPost(sb, "user-1", {
    ...baseBolus, related_entry_id: 12345 as unknown,
  });
  expect(res.status).toBe(400);
  // Insert was never attempted — the row never reached the DB layer.
  expect(captured.row).toBeUndefined();
});

test("string id is trimmed; empty string is rejected (matches PATCH semantics)", () => {
  const trimmed = parseInsulinPostBody({ ...baseBolus, related_entry_id: "  meal-abc  " });
  expect(trimmed.ok).toBe(true);
  if (trimmed.ok) expect(trimmed.row.related_entry_id).toBe("meal-abc");

  // PATCH /api/insulin/[id] rejects empty string with the same message;
  // POST stays consistent so the API contract is uniform across both
  // endpoints. Callers that want to unlink must send `null`.
  const empty = parseInsulinPostBody({ ...baseBolus, related_entry_id: "" });
  expect(empty.ok).toBe(false);
  if (!empty.ok) expect(empty.error).toMatch(/related_entry_id/);
});
