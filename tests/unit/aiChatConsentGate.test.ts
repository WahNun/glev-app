// tests/unit/aiChatConsentGate.test.ts
//
// Unit tests for the AI consent gate in `app/api/ai/chat/route.ts`.
//
// Covers two concerns:
//   1. Master gate — profiles.ai_consent_at must be non-null or the request
//      is rejected with 403 "ai consent required".
//   2. Sub-scope gate — the granular consent timestamps (ai_consent_glucose_at,
//      ai_consent_iob_at, ai_consent_history_at) must suppress the matching
//      data field from the context preamble sent to Mistral when null.
//
// Pattern: injectable Supabase client + injectable getMistral factory.
// Mirrors the dep-injection approach in `tests/unit/aiChatFeatureFlag.test.ts`.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Mistral } from "@mistralai/mistralai";
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
                // Needed for ai_user_memory: .select().eq().order().limit()
                order(_col: string, _dir: unknown) {
                  return {
                    limit(_n: number) {
                      return { data: [], error: null };
                    },
                  };
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

/**
 * Creates a Mistral spy that:
 * - Returns no tool calls from `chat.complete` so the tool-call loop exits.
 * - Yields no tokens from `chat.stream`.
 * - Captures the `messages` array passed to both calls so tests can inspect
 *   the context preamble that the route built for the model.
 */
function makeMistralSpy(): {
  factory: () => Mistral;
  captured: { messages: unknown[] | null };
} {
  const captured: { messages: unknown[] | null } = { messages: null };
  const factory = (): Mistral =>
    ({
      chat: {
        async complete({ messages }: { messages: unknown[] }) {
          captured.messages = messages;
          return {
            choices: [
              { message: { content: "", toolCalls: [] }, finishReason: "stop" },
            ],
          };
        },
        // eslint-disable-next-line require-yield
        async *stream({ messages }: { messages: unknown[] }) {
          captured.messages = messages;
        },
      },
    }) as unknown as Mistral;
  return { factory, captured };
}

/**
 * Drains the SSE stream from a handleChatPost response so the ReadableStream's
 * async `start()` callback fully completes before we assert on `captured`.
 */
async function drainResponse(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
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

// ---------------------------------------------------------------------------
// Tests — sub-scope flags control the context preamble sent to Mistral
//
// Each test uses a Mistral spy (makeMistralSpy) to capture the `messages`
// array that the route passes to `client.chat.complete`. We then search all
// system-role messages for the preamble lines produced by contextPreamble().
//
// Lines under test (from contextPreamble in route.ts):
//   if (scopes.glucose) → "- Glukose: <glucoseSummary>"
//   if (scopes.iob)     → "- IOB:     <iobSummary>"
// ---------------------------------------------------------------------------

/** Extracts the concatenated text of all system messages in a captured array. */
function systemContent(messages: unknown[]): string {
  return (messages as Array<{ role: string; content: string }>)
    .filter((m) => m.role === "system" && typeof m.content === "string")
    .map((m) => m.content)
    .join("\n");
}

test("sub-scope: ai_consent_glucose_at=null → glucose line absent from preamble", async () => {
  const { factory, captured } = makeMistralSpy();

  const sb = makeClient({
    profileData: {
      ai_consent_at: "2026-01-01T00:00:00Z",
      ai_consent_glucose_at: null,
      ai_consent_iob_at: "2026-01-01T00:00:00Z",
      ai_consent_history_at: "2026-01-01T00:00:00Z",
    },
  });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      message: "Wie ist mein Zucker?",
      contextSnapshot: {
        glucoseSummary: "120 mg/dL steady",
        iobSummary: "2.1 U active",
        lastMealDescription: "Porridge",
      },
    }),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, { auth, getMistral: factory });
  await drainResponse(res);

  expect(captured.messages).not.toBeNull();
  const sys = systemContent(captured.messages!);

  expect(sys).not.toContain("Glukose:");
  expect(sys).toContain("IOB:");
});

test("sub-scope: ai_consent_iob_at=null → IOB line absent from preamble", async () => {
  const { factory, captured } = makeMistralSpy();

  const sb = makeClient({
    profileData: {
      ai_consent_at: "2026-01-01T00:00:00Z",
      ai_consent_glucose_at: "2026-01-01T00:00:00Z",
      ai_consent_iob_at: null,
      ai_consent_history_at: "2026-01-01T00:00:00Z",
    },
  });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      message: "Wie ist mein IOB?",
      contextSnapshot: {
        glucoseSummary: "95 mg/dL rising",
        iobSummary: "0.8 U active",
        lastMealDescription: "Müsli",
      },
    }),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, { auth, getMistral: factory });
  await drainResponse(res);

  expect(captured.messages).not.toBeNull();
  const sys = systemContent(captured.messages!);

  expect(sys).toContain("Glukose:");
  expect(sys).not.toContain("IOB:");
});

test("sub-scope: all three sub-scopes set → both glucose and IOB lines present in preamble", async () => {
  const { factory, captured } = makeMistralSpy();

  const sb = makeClient({
    profileData: {
      ai_consent_at: "2026-01-01T00:00:00Z",
      ai_consent_glucose_at: "2026-01-01T00:00:00Z",
      ai_consent_iob_at: "2026-01-01T00:00:00Z",
      ai_consent_history_at: "2026-01-01T00:00:00Z",
    },
  });
  const auth = makeAuth(sb);

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      message: "Gib mir eine Übersicht.",
      contextSnapshot: {
        glucoseSummary: "105 mg/dL flat",
        iobSummary: "1.2 U active",
        lastMealDescription: "Vollkornbrot",
      },
    }),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, { auth, getMistral: factory });
  await drainResponse(res);

  expect(captured.messages).not.toBeNull();
  const sys = systemContent(captured.messages!);

  expect(sys).toContain("Glukose:");
  expect(sys).toContain("IOB:");
});
