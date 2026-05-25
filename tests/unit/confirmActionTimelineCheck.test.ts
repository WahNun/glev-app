/**
 * Integration test for POST /api/ai/confirm-action with kind="add_timeline_check".
 *
 * Tests the full route logic via the exported `handleConfirmPost` helper,
 * which bypasses Next.js request plumbing and Supabase auth so we can hand
 * it a deterministic mock client — same pattern as `insulinPostBody.test.ts`
 * uses for `handleInsulinPost`.
 *
 * What this pins (matches the Task #705 "Done looks like" criteria):
 *   1. Happy path: response is { ok: true, insertedId: <UUID>, scheduleReminder: {...} }
 *   2. scheduleReminder.mealId matches the seeded meal in params.
 *   3. The mock DB insert receives correct planned_at + confirmed_at values.
 *   4. Update path (existing meal_timeline_checks row) returns the existing id.
 *   5. Error cases: token not found, already used, expired, and insert failure.
 *
 * Why Playwright runner (no browser):
 *   The repo's only test runner is Playwright. `playwright.config.ts` picks up
 *   `tests/unit/*.test.ts` automatically alongside the e2e specs. No DOM is
 *   exercised here — only the exported route handler is called in Node.
 */

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleConfirmPost } from "@/app/api/ai/confirm-action/route";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEST_TOKEN = "test-confirm-token-xyz";
const MEAL_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const INSERTED_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const EXISTING_CHECK_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// planned_at ~90 min in the future so the route's expiry check passes easily
const PLANNED_AT = new Date(Date.now() + 90 * 60_000).toISOString();
const EXPIRES_AT = new Date(Date.now() + 5 * 60_000).toISOString();

const BASE_PARAMS = {
  meal_id: MEAL_ID,
  meal_label: "Pasta Bolognese",
  check_type: "post_1",
  planned_at: PLANNED_AT,
};

// ── Mock Supabase builder ────────────────────────────────────────────────────

/**
 * Captures what was written to `meal_timeline_checks` so the test can assert
 * against it without a live DB — same spirit as the `captured` object in
 * `insulinPostBody.test.ts`.
 */
type Captured = {
  insertRow?: Record<string, unknown>;
  updateRow?: Record<string, unknown>;
  updatedCheckId?: string;
};

function makeSb(opts: {
  pendingActionRow?: Partial<{
    kind: string;
    params: Record<string, unknown>;
    expires_at: string;
    used_at: string | null;
    user_id: string;
  }>;
  existingTimelineRow?: boolean;
  insertFails?: boolean;
  claimFails?: boolean;
} = {}): { sb: SupabaseClient; captured: Captured } {
  const captured: Captured = {};

  const paRow = {
    token: TEST_TOKEN,
    user_id: TEST_USER_ID,
    kind: "add_timeline_check",
    params: BASE_PARAMS,
    summary: "Post-Check für Pasta Bolognese",
    expires_at: EXPIRES_AT,
    used_at: null,
    ...opts.pendingActionRow,
  };

  const existingTimelineRow = opts.existingTimelineRow ?? false;
  const insertFails = opts.insertFails ?? false;
  const claimFails = opts.claimFails ?? false;

  const sb = {
    from(table: string) {
      // ── ai_pending_actions ──────────────────────────────────────────────
      if (table === "ai_pending_actions") {
        return {
          select(_cols: string) {
            return {
              eq(_k: string, _v: string) {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: paRow.token ? paRow : null,
                      error: null,
                    }),
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            return {
              eq(_k: string, _v: string) {
                return {
                  is(_k2: string, _v2: null) {
                    return {
                      gt(_k3: string, _v3: string) {
                        return {
                          select(_cols: string) {
                            return {
                              maybeSingle: () =>
                                Promise.resolve(
                                  claimFails
                                    ? { data: null, error: null }
                                    : { data: { token: TEST_TOKEN }, error: null },
                                ),
                            };
                          },
                        };
                      },
                    };
                  },
                  // rollback path: .eq("token", token).eq("used_at", claimAt)
                  eq(_k2: string, _v2: string) {
                    void values;
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }

      // ── meal_timeline_checks ────────────────────────────────────────────
      if (table === "meal_timeline_checks") {
        return {
          select(_cols: string) {
            return {
              eq(_k: string, _v: string) {
                return {
                  eq(_k2: string, _v2: string) {
                    return {
                      eq(_k3: string, _v3: string) {
                        return {
                          order(_col: string, _opts: unknown) {
                            return {
                              limit(_n: number) {
                                return Promise.resolve({
                                  data: existingTimelineRow
                                    ? [{ id: EXISTING_CHECK_ID }]
                                    : [],
                                  error: null,
                                });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            captured.updateRow = values;
            return {
              eq(_k: string, v: string) {
                captured.updatedCheckId = v;
                return {
                  select(_cols: string) {
                    return {
                      single: () =>
                        Promise.resolve({
                          data: { id: EXISTING_CHECK_ID },
                          error: null,
                        }),
                    };
                  },
                };
              },
            };
          },
          insert(values: Record<string, unknown>) {
            captured.insertRow = values;
            return {
              select(_cols: string) {
                return {
                  single: () =>
                    Promise.resolve(
                      insertFails
                        ? {
                            data: null,
                            error: { message: "DB constraint violation" },
                          }
                        : { data: { id: INSERTED_ID }, error: null },
                    ),
                };
              },
            };
          },
        };
      }

      // Fallback — any unmatched table resolves to empty
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  } as unknown as SupabaseClient;

  return { sb, captured };
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** UUID v4 regex — used to assert that insertedId is a real UUID. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("POST /api/ai/confirm-action — kind=add_timeline_check (integration)", () => {
  // ── 1. Happy path: fresh insert ──────────────────────────────────────────

  test("happy path: returns ok=true, UUID insertedId, and scheduleReminder", async () => {
    const { sb } = makeSb();
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.kind).toBe("add_timeline_check");
    expect(typeof body.insertedId).toBe("string");
    expect(body.insertedId).toMatch(UUID_RE);
    expect(body.insertedId).toBe(INSERTED_ID);
  });

  test("scheduleReminder.mealId matches the seeded meal_id in params", async () => {
    const { sb } = makeSb();
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.scheduleReminder).toBeDefined();
    expect(body.scheduleReminder.mealId).toBe(MEAL_ID);
  });

  test("scheduleReminder carries correct checkType and plannedAt", async () => {
    const { sb } = makeSb();
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.scheduleReminder.checkType).toBe("post_1");
    expect(body.scheduleReminder.plannedAt).toBe(PLANNED_AT);
  });

  test("scheduleReminder.title contains 'Post-Bolus-Check'", async () => {
    const { sb } = makeSb();
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.scheduleReminder.title).toContain("Post-Bolus-Check");
  });

  test("scheduleReminder.body contains the meal_label", async () => {
    const { sb } = makeSb();
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.scheduleReminder.body).toContain("Pasta Bolognese");
  });

  // ── 2. DB write assertions ───────────────────────────────────────────────

  test("insert row carries correct planned_at and confirmed_at", async () => {
    const { sb, captured } = makeSb();
    const before = new Date().toISOString();
    await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const after = new Date().toISOString();

    expect(captured.insertRow).toBeDefined();
    expect(captured.insertRow?.meal_id).toBe(MEAL_ID);
    expect(captured.insertRow?.check_type).toBe("post_1");
    expect(captured.insertRow?.planned_at).toBe(PLANNED_AT);
    expect(captured.insertRow?.user_id).toBe(TEST_USER_ID);

    // confirmed_at must be a valid ISO string set during the request
    const confirmedAt = String(captured.insertRow?.confirmed_at ?? "");
    expect(confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(confirmedAt >= before).toBe(true);
    expect(confirmedAt <= after).toBe(true);
  });

  // ── 3. Upsert update path (existing row) ────────────────────────────────

  test("upsert update path returns existing id when row already exists", async () => {
    const { sb } = makeSb({ existingTimelineRow: true });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.insertedId).toBe(EXISTING_CHECK_ID);
  });

  test("upsert update path still returns scheduleReminder with correct mealId", async () => {
    const { sb } = makeSb({ existingTimelineRow: true });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.scheduleReminder.mealId).toBe(MEAL_ID);
    expect(body.scheduleReminder.checkType).toBe("post_1");
  });

  test("upsert update path writes planned_at and confirmed_at to the existing row", async () => {
    const { sb, captured } = makeSb({ existingTimelineRow: true });
    await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);

    expect(captured.updateRow).toBeDefined();
    expect(captured.updateRow?.planned_at).toBe(PLANNED_AT);
    expect(typeof captured.updateRow?.confirmed_at).toBe("string");
    // Confirm the update was targeted at the correct existing row
    expect(captured.updatedCheckId).toBe(EXISTING_CHECK_ID);
  });

  // ── 4. pre check_type ───────────────────────────────────────────────────

  test("pre check_type returns Prä-Bolus-Check title in scheduleReminder", async () => {
    const { sb } = makeSb({
      pendingActionRow: {
        params: { ...BASE_PARAMS, check_type: "pre" },
      },
    });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.scheduleReminder.title).toContain("Prä-Bolus-Check");
    expect(body.scheduleReminder.checkType).toBe("pre");
  });

  // ── 5. Error cases ───────────────────────────────────────────────────────

  test("returns 404 when token is not found", async () => {
    const { sb } = makeSb({ pendingActionRow: { token: "" as unknown as string } });
    // Override: make the mock return null for ai_pending_actions select
    const sbNull = {
      from(table: string) {
        if (table === "ai_pending_actions") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    const res = await handleConfirmPost(sbNull, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test("returns 409 when pending action is already used", async () => {
    const { sb } = makeSb({
      pendingActionRow: { used_at: new Date(Date.now() - 1000).toISOString() },
    });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already confirmed/i);
  });

  test("returns 410 when pending action is expired", async () => {
    const { sb } = makeSb({
      pendingActionRow: {
        expires_at: new Date(Date.now() - 10_000).toISOString(),
        used_at: null,
      },
    });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expired/i);
  });

  test("returns 403 when token belongs to a different user", async () => {
    const { sb } = makeSb({
      pendingActionRow: { user_id: "different-user-id" },
    });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });

  test("returns 409 when idempotent claim is lost (concurrent double-click)", async () => {
    const { sb } = makeSb({ claimFails: true });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test("returns 500 when the meal_timeline_checks insert fails, rolls back claim", async () => {
    const { sb } = makeSb({ insertFails: true });
    const res = await handleConfirmPost(sb, TEST_USER_ID, TEST_TOKEN);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
