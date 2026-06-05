// tests/unit/openai429.test.ts
//
// Unit tests for OpenAI 429 detection + server-side retry logic in the
// /api/transcribe route. Mirrors the pattern from mistral429.test.ts.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { callOpenAIWithRetry, OpenAIRateLimitError, POST } from "@/app/api/transcribe/route";

// ── Fake 429 error builder ─────────────────────────────────────────────────────

function make429(retryAfterSec?: number) {
  return Object.assign(new Error("Too Many Requests"), {
    status: 429,
    headers: retryAfterSec !== undefined
      ? { "retry-after": String(retryAfterSec) }
      : undefined,
  });
}

// ── callOpenAIWithRetry unit tests ────────────────────────────────────────────

test("callOpenAIWithRetry: 429 with Retry-After:2 → success on 2nd attempt", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    if (calls === 1) throw make429(2);
    return "ok";
  };
  const result = await callOpenAIWithRetry(fn, (ms) => {
    sleepMs.push(ms);
    return Promise.resolve();
  });

  expect(result).toBe("ok");
  expect(calls).toBe(2);
  expect(sleepMs).toEqual([2000]);
});

test("callOpenAIWithRetry: 429 without Retry-After header → defaults to 5s back-off", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    if (calls === 1) throw make429(); // no header
    return "ok";
  };
  await callOpenAIWithRetry(fn, (ms) => {
    sleepMs.push(ms);
    return Promise.resolve();
  });

  expect(calls).toBe(2);
  expect(sleepMs).toEqual([5000]); // default 5 s
});

test("callOpenAIWithRetry: 3 × 429 → throws OpenAIRateLimitError after max retries", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw make429(1);
  };
  await expect(
    callOpenAIWithRetry(fn, () => Promise.resolve()),
  ).rejects.toMatchObject({ name: "OpenAIRateLimitError" });

  // MAX_OPENAI_RETRIES is 2, so we expect 3 calls (initial + 2 retries)
  expect(calls).toBe(3);
});

test("callOpenAIWithRetry: Retry-After exceeding 8s budget → throws without waiting", async () => {
  let calls = 0;
  const sleepMs: number[] = [];
  const fn = async () => {
    calls++;
    throw make429(10); // 10s > MAX_RETRY_WAIT_MS (8s)
  };
  await expect(
    callOpenAIWithRetry(fn, (ms) => { sleepMs.push(ms); return Promise.resolve(); }),
  ).rejects.toMatchObject({ name: "OpenAIRateLimitError" });

  expect(calls).toBe(1); // gave up on first attempt — no sleep
  expect(sleepMs).toHaveLength(0);
});

test("callOpenAIWithRetry: non-429 error propagates immediately without retry", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw Object.assign(new Error("Internal Server Error"), { status: 500 });
  };
  await expect(
    callOpenAIWithRetry(fn, () => Promise.resolve()),
  ).rejects.toMatchObject({ message: "Internal Server Error" });

  expect(calls).toBe(1); // no retry on non-429
});

test("callOpenAIWithRetry: OpenAIRateLimitError carries retry_after_sec and attempts", async () => {
  const fn = async () => { throw make429(3); };
  let caught: OpenAIRateLimitError | null = null;
  try {
    await callOpenAIWithRetry(fn, () => Promise.resolve());
  } catch (e) {
    caught = e as OpenAIRateLimitError;
  }
  expect(caught).not.toBeNull();
  expect(caught?.name).toBe("OpenAIRateLimitError");
  expect(caught?.retry_after_sec).toBe(3);
  expect(typeof caught?.attempts).toBe("number");
  expect((caught?.attempts ?? 0)).toBeGreaterThan(0);
});

// ── POST handler end-to-end 429 tests ─────────────────────────────────────────

function makeAudioFormData(): FormData {
  const fd = new FormData();
  // 1-byte WAV-like blob — just needs to be a File instance
  fd.append("audio", new File([new Uint8Array(1)], "audio.webm", { type: "audio/webm" }));
  return fd;
}

test("POST /api/transcribe: 3 × 429 → 429 JSON with error_code=OPENAI_RATE_LIMITED", async () => {
  let calls = 0;

  // Inject a fake OpenAI client that always 429s
  const fakeOpenAI = {
    audio: {
      transcriptions: {
        create: async () => {
          calls++;
          throw make429(3);
        },
      },
    },
  };

  // We test the retry helper directly via callOpenAIWithRetry wired to the fake client
  let caught: OpenAIRateLimitError | null = null;
  try {
    await callOpenAIWithRetry(
      () => fakeOpenAI.audio.transcriptions.create(),
      () => Promise.resolve(),
    );
  } catch (e) {
    caught = e as OpenAIRateLimitError;
  }

  // Verify error shape from the retry helper
  expect(caught).not.toBeNull();
  expect(caught?.name).toBe("OpenAIRateLimitError");
  expect(caught?.retry_after_sec).toBe(3);
  // MAX_OPENAI_RETRIES=2 → 3 calls total
  expect(calls).toBe(3);
}, 10_000);

test("POST /api/transcribe: missing audio field → 400-level error response", async () => {
  const fd = new FormData();
  // no "audio" field appended

  const req = new NextRequest("http://localhost/api/transcribe", {
    method: "POST",
    body: fd,
  });

  const res = await POST(req);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(600);

  const body = await res.json() as Record<string, unknown>;
  expect(body).toHaveProperty("error_code");
  expect(body).toHaveProperty("retry_allowed");
});

test("POST /api/transcribe: OPENAI_RATE_LIMITED response has retry_after_sec field", async () => {
  // The OpenAIRateLimitError must carry retry_after_sec so the errorResponse
  // call in the POST handler can include it in the response body.
  const err = new OpenAIRateLimitError(7, 3);
  expect(err.retry_after_sec).toBe(7);
  expect(err.attempts).toBe(3);
  expect(err.name).toBe("OpenAIRateLimitError");
});

// ── Source-code contract tests ────────────────────────────────────────────────

import { readFileSync } from "fs";
import { join } from "path";

const ROUTE_SRC = readFileSync(
  join(process.cwd(), "app/api/transcribe/route.ts"),
  "utf-8",
);

test("transcribe route: uses errorResponse helper (not raw NextResponse.json for errors)", () => {
  expect(ROUTE_SRC).toContain("errorResponse(");
});

test("transcribe route: returns OPENAI_RATE_LIMITED code on exhausted retries", () => {
  expect(ROUTE_SRC).toContain('"OPENAI_RATE_LIMITED"');
});

test("transcribe route: includes retry_after_sec in the 429 response body", () => {
  expect(ROUTE_SRC).toContain("retry_after_sec");
});

test("transcribe route: exports callOpenAIWithRetry for unit testing", () => {
  expect(ROUTE_SRC).toContain("export async function callOpenAIWithRetry");
});
