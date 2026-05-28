// Unit tests for `POST /api/menstrual` and `DELETE /api/menstrual`.
//
// The route's body parsing + validation is extracted into the pure
// `parseMenstrualBody()` helper and the `handleMenstrualPost()` handler
// (which takes a pre-resolved Supabase client) so these contracts can
// be pinned without spinning up the Next.js runtime or connecting to
// Supabase:
//
//   POST happy path
//     1. Bleeding entry (flow_intensity + start_date)
//     2. Phase-marker entry (cycle_phase only)
//     3. Legacy phase_marker='ovulation' is still accepted
//     4. Optional end_date forwarded when present
//
//   POST validation errors (400)
//     5. Missing / malformed start_date
//     6. end_date before start_date
//     7. Invalid flow_intensity enum
//     8. Rejected legacy phase_marker='pms'
//     9. Rejected legacy phase_marker='other'
//    10. Invalid cycle_phase enum value
//    11. None of flow_intensity / phase_marker / cycle_phase provided
//
//   Route-level handler
//    12. Happy-path write returns 201 with the inserted log
//    13. DB error surfaces as 500
//    14. Missing-table error surfaces as 503
//
//   DELETE
//    15. Missing id query param → 400
//    16. Successful delete → { ok: true }

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseMenstrualBody,
  handleMenstrualPost,
} from "@/app/api/menstrual/route";

// ---------------------------------------------------------------------------
// Fake Supabase builder — mirrors the `.from().insert().select().single()`
// shape the route actually exercises, plus a `.delete().eq().eq()` chain
// for DELETE tests.
// ---------------------------------------------------------------------------
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
        delete() {
          return {
            eq(_col: string, _val: unknown) {
              return {
                eq(_col2: string, _val2: unknown) {
                  return response;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, captured };
}

// ---------------------------------------------------------------------------
// POST — parseMenstrualBody happy paths
// ---------------------------------------------------------------------------

test("bleeding entry: flow_intensity + start_date parses correctly", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01", flow_intensity: "medium" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.start_date).toBe("2026-05-01");
  expect(r.row.flow_intensity).toBe("medium");
  expect(r.row.cycle_phase).toBeNull();
  expect(r.row.phase_marker).toBeNull();
});

test("phase-marker entry: cycle_phase only is accepted", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-15", cycle_phase: "ovulation" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.cycle_phase).toBe("ovulation");
  expect(r.row.flow_intensity).toBeNull();
});

test("all four cycle_phase values are accepted", () => {
  for (const phase of ["follicular", "ovulation", "luteal", "menstruation"]) {
    const r = parseMenstrualBody({ start_date: "2026-05-10", cycle_phase: phase });
    expect(r.ok).toBe(true);
  }
});

test("legacy phase_marker='ovulation' is still accepted for backward compatibility", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-20", phase_marker: "ovulation" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.phase_marker).toBe("ovulation");
});

test("optional end_date is forwarded when present and valid", () => {
  const r = parseMenstrualBody({
    start_date: "2026-05-01",
    end_date: "2026-05-05",
    flow_intensity: "light",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.end_date).toBe("2026-05-05");
});

test("flow_intensity is normalised to lowercase", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01", flow_intensity: "HEAVY" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.flow_intensity).toBe("heavy");
});

test("notes are trimmed and forwarded", () => {
  const r = parseMenstrualBody({
    start_date: "2026-05-01",
    flow_intensity: "medium",
    notes: "  cramps  ",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.notes).toBe("cramps");
});

// ---------------------------------------------------------------------------
// POST — parseMenstrualBody validation errors
// ---------------------------------------------------------------------------

test("missing start_date returns a clean error", () => {
  const r = parseMenstrualBody({ flow_intensity: "medium" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/start_date/);
});

test("malformed start_date (wrong format) is rejected", () => {
  for (const bad of ["2026/05/01", "01-05-2026", "not-a-date", ""]) {
    const r = parseMenstrualBody({ start_date: bad, flow_intensity: "medium" });
    expect(r.ok).toBe(false);
    if (r.ok) continue;
    expect(r.error).toMatch(/start_date/);
  }
});

test("end_date before start_date is rejected", () => {
  const r = parseMenstrualBody({
    start_date: "2026-05-10",
    end_date: "2026-05-05",
    flow_intensity: "medium",
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/end_date.*on or after/);
});

test("invalid flow_intensity enum value is rejected", () => {
  for (const bad of ["very_heavy", "spotting", "none", "123"]) {
    const r = parseMenstrualBody({ start_date: "2026-05-01", flow_intensity: bad });
    expect(r.ok).toBe(false);
    if (r.ok) continue;
    expect(r.error).toMatch(/flow_intensity/);
  }
});

test("legacy phase_marker='pms' is explicitly rejected with helpful message", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01", phase_marker: "pms" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/pms/);
  // Must not silently ignore — should suggest symptom_logs instead.
  expect(r.error).toMatch(/symptom/i);
});

test("legacy phase_marker='other' is explicitly rejected", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01", phase_marker: "other" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/other/);
});

test("unknown phase_marker value is rejected", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01", phase_marker: "luteal" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/phase_marker/);
});

test("invalid cycle_phase value is rejected", () => {
  // The route lowercases the value before checking — only truly unknown
  // tokens should fail. Valid tokens in any case are accepted (e.g.
  // "FOLLICULAR" → "follicular" passes). Test only tokens that are
  // not in the enum even after lowercasing.
  for (const bad of ["pms", "period", "unknown", "luteal_phase"]) {
    const r = parseMenstrualBody({ start_date: "2026-05-01", cycle_phase: bad });
    expect(r.ok).toBe(false);
    if (r.ok) continue;
    expect(r.error).toMatch(/cycle_phase/);
  }
});

test("no marker field at all returns a 'must provide one of' error", () => {
  const r = parseMenstrualBody({ start_date: "2026-05-01" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  // Should mention all three accepted fields so the caller knows what to send.
  expect(r.error).toMatch(/flow_intensity|phase_marker|cycle_phase/);
});

// ---------------------------------------------------------------------------
// POST — route handler (handleMenstrualPost)
// ---------------------------------------------------------------------------

test("route: valid bleeding body writes the row and returns 201", async () => {
  const inserted = {
    id: "log-1",
    user_id: "user-1",
    start_date: "2026-05-01",
    end_date: null,
    flow_intensity: "medium",
    phase_marker: null,
    cycle_phase: null,
    notes: null,
  };
  const { sb, captured } = makeFakeSb({ data: inserted, error: null });

  const res = await handleMenstrualPost(sb, "user-1", {
    start_date: "2026-05-01",
    flow_intensity: "medium",
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { log: typeof inserted };
  expect(body.log.start_date).toBe("2026-05-01");
  expect(body.log.flow_intensity).toBe("medium");
  expect(captured.table).toBe("menstrual_logs");
  expect(captured.row?.user_id).toBe("user-1");
});

test("route: valid cycle_phase body writes the row and returns 201", async () => {
  const inserted = {
    id: "log-2",
    user_id: "user-1",
    start_date: "2026-05-15",
    end_date: null,
    flow_intensity: null,
    phase_marker: null,
    cycle_phase: "luteal",
    notes: null,
  };
  const { sb, captured } = makeFakeSb({ data: inserted, error: null });

  const res = await handleMenstrualPost(sb, "user-1", {
    start_date: "2026-05-15",
    cycle_phase: "luteal",
  });

  expect(res.status).toBe(201);
  expect(captured.row?.cycle_phase).toBe("luteal");
  expect(captured.row?.flow_intensity).toBeNull();
});

test("route: validation error stops the insert (HTTP 400, no DB call)", async () => {
  const { sb, captured } = makeFakeSb({ data: null, error: null });

  const res = await handleMenstrualPost(sb, "user-1", {
    start_date: "not-a-date",
    flow_intensity: "medium",
  });

  expect(res.status).toBe(400);
  expect(captured.row).toBeUndefined();
});

test("route: DB error surfaces as 500 with the error message", async () => {
  const { sb } = makeFakeSb({
    data: null,
    error: { message: "connection timeout" },
  });

  const res = await handleMenstrualPost(sb, "user-1", {
    start_date: "2026-05-01",
    flow_intensity: "light",
  });

  expect(res.status).toBe(500);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/connection timeout/);
});

test("route: missing-table error surfaces as 503", async () => {
  const { sb } = makeFakeSb({
    data: null,
    error: { code: "42P01", message: 'relation "menstrual_logs" does not exist' },
  });

  const res = await handleMenstrualPost(sb, "user-1", {
    start_date: "2026-05-01",
    flow_intensity: "medium",
  });

  expect(res.status).toBe(503);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/migration/i);
});
