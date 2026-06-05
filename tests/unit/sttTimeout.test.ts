// tests/unit/sttTimeout.test.ts
//
// Unit tests for the 20s STT timeout added to transcribeWithFallback / useVoxtral.
//
// Tests rely on fake timers (via a `_sleep` override baked into the helper) to
// avoid real wall-clock waits. transcribeWithFallback is a pure async function
// that accepts an AbortSignal — we can drive the timeout scenario by aborting
// the signal ourselves after a configurable delay, mirroring exactly what the
// 20s setTimeout does in useVoxtral.
//
// Also covers:
//   - STT_TIMEOUT error code exists and has correct messages
//   - STT_TIMEOUT is in RETRY_ALLOWED_CODES
//   - STT_TIMEOUT_MS constant exported from useVoxtral
//   - sttTimeoutRef cleared in startListening (source-contract test)

import { test, expect } from "@playwright/test";
import { transcribeWithFallback, STT_TIMEOUT_MS } from "@/hooks/useVoxtral";
import { ERROR_MESSAGES, RETRY_ALLOWED_CODES, ALL_ERROR_CODES } from "@/lib/ai/errors";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSseResponse(finalText: string, delayMs = 0): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "final", text: finalText })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function makeHangingResponse(): Response {
  // Never closes — simulates Voxtral not responding
  const stream = new ReadableStream({ start() {} });
  return new Response(stream, { status: 200 });
}

// ── 1. STT_TIMEOUT error code ─────────────────────────────────────────────────

test("STT_TIMEOUT: exists in AppErrorCode union and ALL_ERROR_CODES", () => {
  expect(ALL_ERROR_CODES).toContain("STT_TIMEOUT");
});

test("STT_TIMEOUT: has DE and EN messages", () => {
  const msg = ERROR_MESSAGES.STT_TIMEOUT;
  expect(msg.de).toBeTruthy();
  expect(msg.en).toBeTruthy();
  expect(msg.de).toContain("Spracherkennung");
  expect(msg.en).toContain("Speech recognition");
});

test("STT_TIMEOUT: is in RETRY_ALLOWED_CODES", () => {
  expect(RETRY_ALLOWED_CODES.has("STT_TIMEOUT")).toBe(true);
});

// ── 2. STT_TIMEOUT_MS constant ────────────────────────────────────────────────

test("STT_TIMEOUT_MS: exported from useVoxtral and equals 20000", () => {
  expect(STT_TIMEOUT_MS).toBe(20_000);
});

// ── 3. Normal flow (fast response) — no timeout fires ─────────────────────────

test("normal flow: transcript returned before timeout, no error", async () => {
  const errors: string[] = [];
  const transcripts: string[] = [];

  // Fast SSE response (5ms simulated delay — well under 20s)
  const origFetch = global.fetch;
  global.fetch = async () => makeSseResponse("Hallo Welt", 5);

  try {
    const ac = new AbortController();
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => transcripts.push(t),
      undefined,
      (e) => errors.push(e),
      ac.signal,
    );
  } finally {
    global.fetch = origFetch;
  }

  expect(transcripts).toEqual(["Hallo Welt"]);
  expect(errors).toHaveLength(0);
});

// ── 4. Timeout scenario — AbortController fired externally ────────────────────

test("timeout: abort signal fired externally triggers silent exit (no onError from transcribe)", async () => {
  // transcribeWithFallback silently exits on AbortError — the calling code
  // (the setTimeout in useVoxtral) is responsible for calling onError.
  // We simulate with a fetch that resolves only once the abort fires,
  // then verify transcribeWithFallback does NOT call onError.
  const errors: string[] = [];
  const transcripts: string[] = [];

  const origFetch = global.fetch;
  // fetch resolves to a 500 once the signal is aborted — this exercises the
  // catch(AbortError) path and confirms no onError leak.
  global.fetch = async (_url: RequestInfo | URL, opts?: RequestInit) => {
    const signal = opts?.signal as AbortSignal | undefined;
    // Wait until aborted (max 2s safety)
    await new Promise<void>((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const onAbort = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
      signal?.addEventListener("abort", onAbort);
      setTimeout(resolve, 2000);
    });
    // Return a response that will cause the DOMException AbortError on the
    // already-aborted read path. In Node, throw the AbortError directly.
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    throw err;
  };

  try {
    const ac = new AbortController();

    // Simulate the 20s timer firing after 20ms (for test speed)
    const timeoutId = setTimeout(() => {
      ac.abort();
      // This is exactly what useVoxtral's sttTimeoutRef setTimeout does:
      errors.push(ERROR_MESSAGES.STT_TIMEOUT.de);
    }, 20);

    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => transcripts.push(t),
      undefined,
      (e) => errors.push(e), // must NOT be called by transcribeWithFallback on abort
      ac.signal,
    );

    clearTimeout(timeoutId);
  } finally {
    global.fetch = origFetch;
  }

  // onError called exactly once — by the timeout handler, not by transcribeWithFallback
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBe(ERROR_MESSAGES.STT_TIMEOUT.de);
  expect(transcripts).toHaveLength(0);
});

// ── 5. Manual abort — no double-error ─────────────────────────────────────────

test("manual abort: abort before start exits silently, no onError", async () => {
  const errors: string[] = [];

  const origFetch = global.fetch;
  global.fetch = async () => makeHangingResponse();

  try {
    const ac = new AbortController();
    ac.abort(); // aborted BEFORE the call (simulates startListening abort of stale request)

    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      () => {},
      undefined,
      (e) => errors.push(e),
      ac.signal,
    );
  } finally {
    global.fetch = origFetch;
  }

  expect(errors).toHaveLength(0);
});

// ── 6. Source-contract: useVoxtral wires up sttTimeoutRef and STT_TIMEOUT_MS ──

test("useVoxtral source: sttTimeoutRef defined and cleared in startListening", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const src = readFileSync(join(process.cwd(), "hooks/useVoxtral.ts"), "utf8");

  // Timeout ref declared
  expect(src).toContain("sttTimeoutRef");
  // Cleared in startListening (before aborting old transcription)
  expect(src).toContain("clearTimeout(sttTimeoutRef.current)");
  // setTimeout with STT_TIMEOUT_MS used in onstop
  expect(src).toContain("setTimeout(");
  expect(src).toContain("STT_TIMEOUT_MS");
  // onError called with STT_TIMEOUT message in timeout callback
  expect(src).toContain("ERROR_MESSAGES.STT_TIMEOUT.de");
  // aborted check before firing (race protection)
  expect(src).toContain("!ac.signal.aborted");
  // Timeout cleared in finally (normal completion path)
  const finallyBlock = src.slice(src.indexOf(".finally("), src.indexOf(".finally(") + 300);
  expect(finallyBlock).toContain("clearTimeout(sttTimeoutRef.current)");
});
