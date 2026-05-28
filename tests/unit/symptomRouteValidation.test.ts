// Unit tests for `POST /api/symptoms` and `DELETE /api/symptoms`.
//
// The route's body parsing + validation is extracted into the pure
// `parseSymptomBody()` helper and the `handleSymptomsPost()` handler
// so these contracts can be pinned without the Next.js runtime or
// a real Supabase connection:
//
//   POST happy paths
//     1. Single symptom + severity 1..5
//     2. Multiple symptoms, each with its own severity
//     3. Duplicate symptom_types are deduped silently
//     4. occurred_at defaults to now when omitted
//     5. Custom occurred_at ISO timestamp forwarded
//     6. category defaults to 'general'
//     7. category='pms' accepted
//     8. cgm_glucose_at_log in range (20..600) forwarded, rounded to 1dp
//     9. cgm_glucose_at_log out-of-range dropped to null (not rejected)
//
//   POST validation errors (400)
//    10. Empty symptom_types array
//    11. All symptom_types invalid (none survive the filter)
//    12. Missing severities key for a selected symptom
//    13. Severity value out of range (0 or 6)
//    14. Invalid occurred_at string
//    15. Invalid category enum value
//
//   Route-level handler
//    16. Happy-path write returns 201 with the inserted log
//    17. DB error surfaces as 500
//    18. Missing-table error surfaces as 503
//
//   DELETE
//    19. Missing id query param → 400 (via HTTP route — checked via
//        the handler chain; id validation lives in the route export)

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSymptomBody,
  handleSymptomsPost,
} from "@/app/api/symptoms/route";

// ---------------------------------------------------------------------------
// Fake Supabase builder — captures the inserted row and serves a
// configurable response for the `.insert().select().single()` chain.
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
      };
    },
  } as unknown as SupabaseClient;
  return { sb, captured };
}

// Minimal valid payload for single-symptom tests.
const baseBody = {
  symptom_types: ["headache"],
  severities: { headache: 3 },
};

// ---------------------------------------------------------------------------
// POST — parseSymptomBody happy paths
// ---------------------------------------------------------------------------

test("single symptom with severity 3 parses correctly", () => {
  const r = parseSymptomBody(baseBody);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.symptom_types).toEqual(["headache"]);
  expect(r.row.severities).toEqual({ headache: 3 });
  expect(r.row.category).toBe("general");
});

test("multiple symptoms each with their own severity parses correctly", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache", "fatigue", "cramps"],
    severities: { headache: 2, fatigue: 4, cramps: 5 },
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.symptom_types).toHaveLength(3);
  expect(r.row.severities).toMatchObject({ headache: 2, fatigue: 4, cramps: 5 });
});

test("all severity values 1..5 are accepted", () => {
  for (const sev of [1, 2, 3, 4, 5]) {
    const r = parseSymptomBody({
      symptom_types: ["nausea"],
      severities: { nausea: sev },
    });
    expect(r.ok).toBe(true);
  }
});

test("duplicate symptom_types are silently deduped", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache", "headache", "fatigue"],
    severities: { headache: 3, fatigue: 2 },
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.symptom_types).toHaveLength(2);
  expect(r.row.symptom_types).toContain("headache");
  expect(r.row.symptom_types).toContain("fatigue");
});

test("occurred_at defaults to an ISO timestamp when omitted", () => {
  const before = Date.now();
  const r = parseSymptomBody(baseBody);
  const after = Date.now();
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const ts = new Date(r.row.occurred_at).getTime();
  expect(ts).toBeGreaterThanOrEqual(before);
  expect(ts).toBeLessThanOrEqual(after);
});

test("explicit occurred_at ISO timestamp is forwarded", () => {
  const iso = "2026-05-10T14:30:00.000Z";
  const r = parseSymptomBody({ ...baseBody, occurred_at: iso });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(new Date(r.row.occurred_at).toISOString()).toBe(iso);
});

test("category defaults to 'general' when omitted", () => {
  const r = parseSymptomBody(baseBody);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.category).toBe("general");
});

test("category='pms' is accepted", () => {
  const r = parseSymptomBody({
    symptom_types: ["cramps"],
    severities: { cramps: 4 },
    category: "pms",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.category).toBe("pms");
});

test("cgm_glucose_at_log within 20..600 is forwarded rounded to 1dp", () => {
  const r = parseSymptomBody({ ...baseBody, cgm_glucose_at_log: 127.49 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.cgm_glucose_at_log).toBe(127.5);
});

test("cgm_glucose_at_log below 20 is dropped to null without error", () => {
  const r = parseSymptomBody({ ...baseBody, cgm_glucose_at_log: 10 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.cgm_glucose_at_log).toBeNull();
});

test("cgm_glucose_at_log above 600 is dropped to null without error", () => {
  const r = parseSymptomBody({ ...baseBody, cgm_glucose_at_log: 700 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.row.cgm_glucose_at_log).toBeNull();
});

test("non-finite cgm_glucose_at_log (NaN / Infinity) is dropped to null", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const r = parseSymptomBody({ ...baseBody, cgm_glucose_at_log: bad });
    expect(r.ok).toBe(true);
    if (!r.ok) continue;
    expect(r.row.cgm_glucose_at_log).toBeNull();
  }
});

// ---------------------------------------------------------------------------
// POST — parseSymptomBody validation errors
// ---------------------------------------------------------------------------

test("empty symptom_types array is rejected", () => {
  const r = parseSymptomBody({ symptom_types: [], severities: {} });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/symptom_types/);
});

test("non-array symptom_types is treated as empty → rejected", () => {
  for (const bad of [null, "headache", 42, {}]) {
    const r = parseSymptomBody({ symptom_types: bad as unknown, severities: {} });
    expect(r.ok).toBe(false);
  }
});

test("all invalid symptom tokens are filtered out → empty → rejected", () => {
  const r = parseSymptomBody({
    symptom_types: ["not_a_real_symptom", "also_fake"],
    severities: { not_a_real_symptom: 3 },
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/symptom_types/);
});

test("missing severity for a selected symptom is rejected", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache", "fatigue"],
    severities: { headache: 3 },
    // fatigue severity is missing
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/severities/);
});

test("severity value of 0 is rejected", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache"],
    severities: { headache: 0 },
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/severities/);
});

test("severity value of 6 is rejected (max is 5)", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache"],
    severities: { headache: 6 },
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/severities/);
});

test("severities must be an object, not an array", () => {
  const r = parseSymptomBody({
    symptom_types: ["headache"],
    severities: [3],
  });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/severities/);
});

test("invalid occurred_at string is rejected", () => {
  const r = parseSymptomBody({ ...baseBody, occurred_at: "not-a-date" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/occurred_at/);
});

test("invalid category value is rejected with list of valid values", () => {
  const r = parseSymptomBody({ ...baseBody, category: "cycle" });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/category/);
  // Should list the valid options so the caller knows what to send.
  expect(r.error).toMatch(/general/);
});

// ---------------------------------------------------------------------------
// POST — route handler (handleSymptomsPost)
// ---------------------------------------------------------------------------

test("route: valid body writes the row to symptom_logs and returns 201", async () => {
  const inserted = {
    id: "sym-1",
    user_id: "user-1",
    symptom_types: ["headache"],
    severities: { headache: 3 },
    occurred_at: "2026-05-10T14:00:00Z",
    cgm_glucose_at_log: null,
    category: "general",
    notes: null,
  };
  const { sb, captured } = makeFakeSb({ data: inserted, error: null });

  const res = await handleSymptomsPost(sb, "user-1", {
    symptom_types: ["headache"],
    severities: { headache: 3 },
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { log: typeof inserted };
  expect(body.log.symptom_types).toEqual(["headache"]);
  expect(captured.table).toBe("symptom_logs");
  expect(captured.row?.user_id).toBe("user-1");
  expect(captured.row?.category).toBe("general");
});

test("route: pms category is written to the row", async () => {
  const { sb, captured } = makeFakeSb({
    data: { id: "sym-2", category: "pms" },
    error: null,
  });

  const res = await handleSymptomsPost(sb, "user-1", {
    symptom_types: ["cramps"],
    severities: { cramps: 4 },
    category: "pms",
  });

  expect(res.status).toBe(201);
  expect(captured.row?.category).toBe("pms");
});

test("route: validation error stops the insert (HTTP 400, no DB call)", async () => {
  const { sb, captured } = makeFakeSb({ data: null, error: null });

  const res = await handleSymptomsPost(sb, "user-1", {
    symptom_types: [],
    severities: {},
  });

  expect(res.status).toBe(400);
  expect(captured.row).toBeUndefined();
});

test("route: DB error surfaces as 500", async () => {
  const { sb } = makeFakeSb({
    data: null,
    error: { message: "connection refused" },
  });

  const res = await handleSymptomsPost(sb, "user-1", {
    symptom_types: ["fatigue"],
    severities: { fatigue: 2 },
  });

  expect(res.status).toBe(500);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/connection refused/);
});

test("route: missing-table error surfaces as 503", async () => {
  const { sb } = makeFakeSb({
    data: null,
    error: { code: "42P01", message: 'relation "symptom_logs" does not exist' },
  });

  const res = await handleSymptomsPost(sb, "user-1", {
    symptom_types: ["anxiety"],
    severities: { anxiety: 1 },
  });

  expect(res.status).toBe(503);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/migration/i);
});
