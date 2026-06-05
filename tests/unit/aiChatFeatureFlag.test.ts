// tests/unit/aiChatFeatureFlag.test.ts
//
// Unit tests for the AI chat feature-flag gate in `app/api/ai/chat/route.ts`.
//
// Two layers of coverage — mirroring how the guard sits in the code:
//
//   Layer 1 — helper-level (checkChatFlag):
//     Verifies the extracted helper returns the right value for every flag
//     state (true / false / missing key / missing row).
//
//   Layer 2 — route-level (handleChatPost via dependency injection):
//     Verifies the full POST handler returns 403 "not available" before
//     reaching the Mistral call (Mistral spy asserts 0 invocations), and
//     that a user with the flag set does NOT hit the flag-403 gate.
//
// Pattern: injectable Supabase client + injectable getMistral factory.
// No live Supabase, no real network required. Follows the same dep-injection
// approach as `tests/unit/passwordResetRoute.test.ts`.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { AuthOk } from "@/app/api/insulin/_helpers";
import { checkChatFlag, handleChatPost } from "@/app/api/ai/chat/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const FAKE_USER: User = {
  id: TEST_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "test@example.com",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
} as User;

/**
 * Builds a fake Supabase client where `from("user_settings")` returns the
 * given `featureFlags` object (or a null row when `featureFlags` is null),
 * and `from("profiles")` returns the given `profileData`.
 *
 * All other table queries return empty / null so that later gates can be
 * driven in isolation without unrelated data.
 */
function makeClient(opts: {
  featureFlags: Record<string, unknown> | null;
  profileData?: Record<string, unknown> | null;
}): SupabaseClient {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  if (table === "user_settings") {
                    return {
                      data: opts.featureFlags !== null
                        ? { feature_flags: opts.featureFlags }
                        : null,
                      error: null,
                    };
                  }
                  if (table === "profiles") {
                    return {
                      data: opts.profileData !== undefined
                        ? opts.profileData
                        : null,
                      error: null,
                    };
                  }
                  return { data: null, error: null };
                },
              };
            },
            order(_col: string, _dir: unknown) {
              return {
                limit(_n: number) {
                  return { data: [], error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

/** Minimal valid chat request body. */
function validBody() {
  return JSON.stringify({
    message: "hello",
    contextSnapshot: {
      glucoseSummary: "110 mg/dL",
      iobSummary: "0 U",
      lastMealDescription: "oatmeal",
    },
  });
}

/** Builds a fake AuthOk with the given Supabase client. */
function makeAuth(sb: SupabaseClient): AuthOk {
  return { user: FAKE_USER, sb };
}

// ---------------------------------------------------------------------------
// Layer 1 — checkChatFlag helper
// ---------------------------------------------------------------------------

test("checkChatFlag: ai_voice = true → returns null (flag passes)", async () => {
  const sb = makeClient({ featureFlags: { ai_voice: true } });

  const result = await checkChatFlag(sb, TEST_USER_ID);

  expect(result).toBeNull();
});

test("checkChatFlag: ai_voice = false → returns 403 PERMISSION_DENIED", async () => {
  const sb = makeClient({ featureFlags: { ai_voice: false } });

  const result = await checkChatFlag(sb, TEST_USER_ID);

  expect(result).not.toBeNull();
  expect(result!.status).toBe(403);
  const json = await result!.json();
  expect(json.error_code).toBe("PERMISSION_DENIED");
  expect(json.retry_allowed).toBe(false);
  expect(typeof json.user_message).toBe("string");
});

test("checkChatFlag: flag key absent → returns 403 PERMISSION_DENIED", async () => {
  const sb = makeClient({ featureFlags: {} });

  const result = await checkChatFlag(sb, TEST_USER_ID);

  expect(result).not.toBeNull();
  expect(result!.status).toBe(403);
  const json = await result!.json();
  expect(json.error_code).toBe("PERMISSION_DENIED");
  expect(json.retry_allowed).toBe(false);
  expect(typeof json.user_message).toBe("string");
});

test("checkChatFlag: no user_settings row → returns 403 PERMISSION_DENIED", async () => {
  const sb = makeClient({ featureFlags: null });

  const result = await checkChatFlag(sb, TEST_USER_ID);

  expect(result).not.toBeNull();
  expect(result!.status).toBe(403);
  const json = await result!.json();
  expect(json.error_code).toBe("PERMISSION_DENIED");
  expect(json.retry_allowed).toBe(false);
  expect(typeof json.user_message).toBe("string");
});

// ---------------------------------------------------------------------------
// Layer 2 — handleChatPost (route-level, dep-injection)
// ---------------------------------------------------------------------------

test("POST: flag false → 403 PERMISSION_DENIED with zero Mistral calls", async () => {
  let mistralCallCount = 0;
  const getMistral = () => {
    mistralCallCount++;
    throw new Error("should not reach Mistral");
  };

  const sb = makeClient({ featureFlags: { ai_voice: false } });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json.error_code).toBe("PERMISSION_DENIED");
  expect(json.retry_allowed).toBe(false);
  expect(typeof json.user_message).toBe("string");
  expect(mistralCallCount).toBe(0);
});

test("POST: flag missing → 403 PERMISSION_DENIED with zero Mistral calls", async () => {
  let mistralCallCount = 0;
  const getMistral = () => {
    mistralCallCount++;
    throw new Error("should not reach Mistral");
  };

  const sb = makeClient({ featureFlags: {} });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json.error_code).toBe("PERMISSION_DENIED");
  expect(json.retry_allowed).toBe(false);
  expect(typeof json.user_message).toBe("string");
  expect(mistralCallCount).toBe(0);
});

test("POST: flag true + consent granted → does NOT return flag-403", async () => {
  const getMistral = () => {
    throw new Error("Mistral not configured in test");
  };

  const sb = makeClient({
    featureFlags: { ai_voice: true },
    profileData: { ai_consent_at: "2026-01-01T00:00:00Z" },
  });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  // Must NOT be the feature-flag 403 — the request passed the flag gate.
  // (It will hit a 503 from the Mistral stub, which is expected.)
  const isFlagBlock =
    res.status === 403 && (await res.json()).error_code === "PERMISSION_DENIED";
  expect(isFlagBlock).toBe(false);
});
