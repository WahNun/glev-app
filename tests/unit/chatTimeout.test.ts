// tests/unit/chatTimeout.test.ts
//
// Unit tests for the 18 s server-side chat timeout (Phase 1).
//
// Strategy: inject a fast `timeoutMs` (100 ms) into `handleChatPost`
// via `ChatDeps` so tests run in milliseconds without real network calls.
// A mock Mistral client that never resolves simulates a slow upstream.
//
// Test matrix:
//   1. Slow Mistral (never resolves within timeout) → CHAT_TIMEOUT SSE frame emitted.
//   2. Fast Mistral (resolves before timeout) → no CHAT_TIMEOUT frame.
//   3. Timeout frame carries error_code=CHAT_TIMEOUT + retry_allowed=true.
//   4. Timeout frame carries a non-empty user_message (de locale).
//   5. After timeout, streaming state resolves (stream is closed — no infinite hang).

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthOk } from "@/app/api/insulin/_helpers";
import { handleChatPost, callMistralWithRetry } from "@/app/api/ai/chat/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const FAKE_USER: User = {
  id: TEST_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "timeout@example.com",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
} as User;

function makeClient(): SupabaseClient {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  if (table === "user_settings") {
                    return { data: { feature_flags: { ai_voice: true } }, error: null };
                  }
                  if (table === "profiles") {
                    return {
                      data: {
                        ai_consent_at: "2026-01-01T00:00:00Z",
                        ai_consent_glucose_at: null,
                        ai_consent_iob_at: null,
                        ai_consent_history_at: null,
                      },
                      error: null,
                    };
                  }
                  return { data: null, error: null };
                },
                order(_col: string) {
                  return {
                    limit(_n: number) {
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
                gte(_col: string, _val: unknown) {
                  return {
                    select(_c: string, _opts: unknown) {
                      return Promise.resolve({ count: 0, error: null });
                    },
                  };
                },
              };
            },
            order(_col: string) {
              return { limit(_n: number) { return { data: [], error: null }; } };
            },
            gte(_col: string, _val: unknown) {
              return {
                select(_c: string, _opts: unknown) {
                  return Promise.resolve({ count: 0, error: null });
                },
              };
            },
          };
        },
        insert(_row: unknown) { return Promise.resolve({ error: null }); },
        delete() {
          return { eq(_c: string, _v: unknown) { return { lt: () => ({}) }; } };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function makeAuth(): AuthOk {
  return { user: FAKE_USER, sb: makeClient() };
}

function validBody() {
  return JSON.stringify({
    message: "what is my glucose?",
    contextSnapshot: {
      glucoseSummary: "120 mg/dL",
      iobSummary: "1.2 U",
      lastMealDescription: "oatmeal",
    },
  });
}

/**
 * Reads all SSE frames from a streaming Response into an array of
 * parsed objects. Returns up to the [DONE] sentinel.
 */
async function collectSseFrames(res: Response): Promise<Array<Record<string, unknown>>> {
  const body = res.body;
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: Array<Record<string, unknown>> = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") {
        return frames; // done sentinel
      }
      try {
        frames.push(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        /* ignore malformed frames */
      }
    }
  }
  return frames;
}

// ── Timeout unit test for callMistralWithRetry ────────────────────────────────

test("callMistralWithRetry: non-429 errors propagate immediately", async () => {
  const err = Object.assign(new Error("network error"), { statusCode: 503 });
  await expect(callMistralWithRetry(() => Promise.reject(err))).rejects.toThrow("network error");
});

// ── handleChatPost — timeout scenarios ────────────────────────────────────────

test("timeout: slow Mistral (never resolves within 100ms) → CHAT_TIMEOUT SSE frame", async () => {
  const getMistral = () => ({
    chat: {
      complete: () => new Promise<never>(() => { /* never resolves */ }),
      stream: () => new Promise<never>(() => { /* never resolves */ }),
    },
  }) as never;

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, {
    auth: makeAuth(),
    getMistral,
    timeoutMs: 100,
    sleep: () => Promise.resolve(),
  });

  expect(res.status).toBe(200);
  const frames = await collectSseFrames(res as Response);
  const errorFrame = frames.find((f) => f.error_code === "CHAT_TIMEOUT");
  expect(errorFrame).toBeDefined();
  expect(errorFrame?.error_code).toBe("CHAT_TIMEOUT");
  expect(errorFrame?.retry_allowed).toBe(true);
  expect(typeof errorFrame?.user_message).toBe("string");
  expect((errorFrame?.user_message as string).length).toBeGreaterThan(0);
}, 5_000);

test("timeout: CHAT_TIMEOUT frame carries non-empty German user_message", async () => {
  const getMistral = () => ({
    chat: {
      complete: () => new Promise<never>(() => {}),
      stream: () => new Promise<never>(() => {}),
    },
  }) as never;

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, {
    auth: makeAuth(),
    getMistral,
    timeoutMs: 80,
    sleep: () => Promise.resolve(),
  });

  const frames = await collectSseFrames(res as Response);
  const errorFrame = frames.find((f) => f.error_code === "CHAT_TIMEOUT");
  expect(errorFrame).toBeDefined();
  // German fallback message should contain typical German words
  const msg = errorFrame?.user_message as string;
  expect(msg).toMatch(/versuchen|länger|Antwort/i);
}, 5_000);

test("timeout: fast Mistral (resolves before 200ms timeout) → no CHAT_TIMEOUT frame", async () => {
  const getMistral = () => ({
    chat: {
      complete: async () => ({
        choices: [{ message: { toolCalls: [] } }],
      }),
      stream: async () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { data: { choices: [{ delta: { content: "Hi" } }] } };
        },
      }),
    },
  }) as never;

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, {
    auth: makeAuth(),
    getMistral,
    timeoutMs: 500,
    sleep: () => Promise.resolve(),
  });

  const frames = await collectSseFrames(res as Response);
  const errorFrame = frames.find((f) => f.error_code === "CHAT_TIMEOUT");
  expect(errorFrame).toBeUndefined();

  const tokenFrames = frames.filter((f) => typeof f.token === "string");
  expect(tokenFrames.length).toBeGreaterThan(0);
}, 5_000);

test("timeout: stream is closed after CHAT_TIMEOUT (no infinite hang)", async () => {
  const getMistral = () => ({
    chat: {
      complete: () => new Promise<never>(() => {}),
      stream: () => new Promise<never>(() => {}),
    },
  }) as never;

  const req = new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: validBody(),
    headers: { "Content-Type": "application/json" },
  });

  const res = await handleChatPost(req, {
    auth: makeAuth(),
    getMistral,
    timeoutMs: 100,
    sleep: () => Promise.resolve(),
  });

  // collectSseFrames must return (not hang) — proves controller.close() was called
  const frames = await collectSseFrames(res as Response);
  expect(frames.some((f) => f.error_code === "CHAT_TIMEOUT")).toBe(true);
}, 5_000);
