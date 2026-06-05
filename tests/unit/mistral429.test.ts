// tests/unit/mistral429.test.ts
//
// Unit tests for Mistral 429 detection + server-side retry logic (Phase 2).
//
// Strategy:
//  - `callMistralWithRetry` is exported and tested in isolation.
//  - `handleChatPost` is tested end-to-end via dep-injection with Mistral
//    mocks that throw 429 errors.
//  - A source-code inspection test verifies the chat sheet honours the
//    `retryAllowed` flag and renders a Retry button on rate-limit errors.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthOk } from "@/app/api/insulin/_helpers";
import { handleChatPost, callMistralWithRetry } from "@/app/api/ai/chat/route";

// ── Source-code inspection helper ─────────────────────────────────────────────

const HOOK_SRC = readFileSync(
  join(process.cwd(), "lib/useGlevAI.ts"),
  "utf-8",
);

const SHEET_SRC = readFileSync(
  join(process.cwd(), "components/GlevAIChatSheet.tsx"),
  "utf-8",
);

// ── Fake 429 error builder ─────────────────────────────────────────────────────

function make429(retryAfterSec?: number) {
  return Object.assign(new Error("Too Many Requests"), {
    statusCode: 429,
    headers: retryAfterSec !== undefined
      ? { "retry-after": String(retryAfterSec) }
      : undefined,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const FAKE_USER: User = {
  id: TEST_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "rate@example.com",
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
    message: "log meal",
    contextSnapshot: {
      glucoseSummary: "110 mg/dL",
      iobSummary: "0 U",
      lastMealDescription: "rice",
    },
  });
}

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
      if (!payload || payload === "[DONE]") return frames;
      try {
        frames.push(JSON.parse(payload) as Record<string, unknown>);
      } catch { /* ignore */ }
    }
  }
  return frames;
}

// ── callMistralWithRetry unit tests ───────────────────────────────────────────

test("callMistralWithRetry: 429 with Retry-After:2 → success on 2nd attempt", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    if (calls === 1) throw make429(2);
    return "ok";
  };
  const result = await callMistralWithRetry(fn, (ms) => {
    sleepMs.push(ms);
    return Promise.resolve();
  });

  expect(result).toBe("ok");
  expect(calls).toBe(2);
  expect(sleepMs).toEqual([2000]);
});

test("callMistralWithRetry: 429 without Retry-After header → defaults to 5s back-off", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    if (calls === 1) throw make429(); // no header
    return "ok";
  };
  await callMistralWithRetry(fn, (ms) => {
    sleepMs.push(ms);
    return Promise.resolve();
  });

  expect(calls).toBe(2);
  expect(sleepMs).toEqual([5000]); // default 5 s
});

test("callMistralWithRetry: 3 × 429 → throws MistralRateLimitError after max retries", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw make429(1);
  };
  await expect(
    callMistralWithRetry(fn, () => Promise.resolve()),
  ).rejects.toMatchObject({ name: "MistralRateLimitError" });

  // MAX_MISTRAL_RETRIES is 2, so we expect 3 calls (initial + 2 retries)
  expect(calls).toBe(3);
});

test("callMistralWithRetry: Retry-After exceeding 8s budget → throws without waiting", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    throw make429(10); // 10s > MAX_RETRY_WAIT_MS (8s)
  };
  await expect(
    callMistralWithRetry(fn, (ms) => { sleepMs.push(ms); return Promise.resolve(); }),
  ).rejects.toMatchObject({ name: "MistralRateLimitError" });

  expect(calls).toBe(1); // gave up on first attempt — no sleep
  expect(sleepMs).toHaveLength(0);
});

// ── handleChatPost end-to-end 429 tests ──────────────────────────────────────

test("handleChatPost: 3 × 429 → SSE frame error_code=MISTRAL_RATE_LIMITED + retry_after_sec", async () => {
  let calls = 0;
  const getMistral = () => ({
    chat: {
      complete: async () => {
        calls++;
        throw make429(3);
      },
      stream: async () => { throw make429(3); },
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
    timeoutMs: 10_000,
    sleep: () => Promise.resolve(),
  });

  const frames = await collectSseFrames(res as Response);
  const errFrame = frames.find((f) => f.error_code === "MISTRAL_RATE_LIMITED");
  expect(errFrame).toBeDefined();
  expect(errFrame?.retry_allowed).toBe(true);
  expect(typeof errFrame?.retry_after_sec).toBe("number");
  expect(typeof errFrame?.user_message).toBe("string");
  // Called 3 times (1 initial + 2 retries) before giving up
  expect(calls).toBe(3);
}, 10_000);

test("handleChatPost: MISTRAL_RATE_LIMITED SSE frame has non-empty German user_message", async () => {
  const getMistral = () => ({
    chat: {
      complete: async () => { throw make429(1); },
      stream: async () => { throw make429(1); },
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
    timeoutMs: 10_000,
    sleep: () => Promise.resolve(),
  });

  const frames = await collectSseFrames(res as Response);
  const errFrame = frames.find((f) => f.error_code === "MISTRAL_RATE_LIMITED");
  expect(errFrame).toBeDefined();
  const msg = errFrame?.user_message as string;
  expect(msg.length).toBeGreaterThan(0);
  expect(msg).toMatch(/warten|versuchen|Anfragen/i);
}, 10_000);

// ── Source-code contract tests ────────────────────────────────────────────────

test("useGlevAI: forwards retry_after_sec from HTTP error body to thrown error", () => {
  // The HTTP error path must forward retry_after_sec so the catch block
  // can schedule the auto-retry countdown.
  expect(HOOK_SRC).toContain("retry_after_sec: typeof errBody.retry_after_sec");
});

test("useGlevAI: forwards retry_after_sec from SSE error frame to thrown error", () => {
  // The SSE error frame path must also forward retry_after_sec.
  expect(HOOK_SRC).toContain("retry_after_sec: typeof frame.retry_after_sec");
});

test("useGlevAI: sets rateLimitCountdown + auto-retry on first MISTRAL_RATE_LIMITED", () => {
  // The catch block must handle the 429 countdown + auto-retry logic.
  expect(HOOK_SRC).toContain('code === "MISTRAL_RATE_LIMITED"');
  expect(HOOK_SRC).toContain("autoRetryAttemptRef.current === 0");
  expect(HOOK_SRC).toContain("setRateLimitCountdown(retryAfterSec)");
});

test("useGlevAI: exposes isSlow and rateLimitCountdown in hook return", () => {
  expect(HOOK_SRC).toContain("isSlow,");
  expect(HOOK_SRC).toContain("rateLimitCountdown,");
});

test("GlevAIChatSheet: renders retry button gated on retryAllowed (429 path)", () => {
  // Existing assertion from glevAIChatSheetErrors.test.ts covers this,
  // but we add a targeted check that retry_allowed=true on MISTRAL_RATE_LIMITED
  // means the chat sheet WILL render a Retry button (via retryAllowed flag).
  expect(SHEET_SRC).toContain("m.retryAllowed");
  expect(SHEET_SRC).toContain("!m.isStreaming");
});
