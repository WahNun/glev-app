// tests/unit/aiChatConsentGate.test.ts
//
// Unit tests for the AI consent gate in `app/api/ai/chat/route.ts`.
//
// The consent check (profiles.ai_consent_at) sits immediately after the
// feature-flag guard. These tests verify that a user who has the feature flag
// but has not granted consent receives 403 "ai consent required", and that a
// user who has granted consent passes the consent gate.
//
// Pattern: injectable Supabase client + injectable getMistral factory.
// Mirrors the dep-injection approach in `tests/unit/aiChatFeatureFlag.test.ts`.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { AuthOk } from "@/app/api/insulin/_helpers";
import { handleChatPost } from "@/app/api/ai/chat/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const FAKE_USER: User = {
  id: TEST_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "consent-test@example.com",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
} as User;

/**
 * Builds a fake Supabase client where:
 * - `from("user_settings")` returns `{ feature_flags: { ai_voice: true } }` so
 *   the feature-flag gate always passes, letting the consent gate be exercised.
 * - `from("profiles")` returns the given `profileData` (or null when omitted).
 *
 * All other table queries return empty / null.
 */
function makeClient(opts: {
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
                      data: { feature_flags: { ai_voice: true } },
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
// Tests — consent gate via handleChatPost
// ---------------------------------------------------------------------------

test("consent gate: ai_voice=true + no profile row → 403 'ai consent required'", async () => {
  const getMistral = () => {
    throw new Error("should not reach Mistral");
  };

  const sb = makeClient({ profileData: null });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json).toEqual({ error: "ai consent required" });
});

test("consent gate: ai_voice=true + ai_consent_at=null → 403 'ai consent required'", async () => {
  const getMistral = () => {
    throw new Error("should not reach Mistral");
  };

  const sb = makeClient({ profileData: { ai_consent_at: null } });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json).toEqual({ error: "ai consent required" });
});

test("consent gate: ai_voice=true + ai_consent_at set → passes consent gate (no consent-403)", async () => {
  const getMistral = () => {
    throw new Error("Mistral not configured in test");
  };

  const sb = makeClient({
    profileData: {
      ai_consent_at: "2026-01-01T00:00:00Z",
      ai_consent_glucose_at: null,
      ai_consent_iob_at: null,
      ai_consent_history_at: null,
    },
  });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });
  const res = await handleChatPost(req, { auth, getMistral });

  // Must NOT be the consent 403 — the request passed the consent gate.
  // (It will fail further in with a 503 or similar from the Mistral stub.)
  const isConsentBlock =
    res.status === 403 && (await res.json()).error === "ai consent required";
  expect(isConsentBlock).toBe(false);
});
