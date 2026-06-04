// Unit coverage for the Voxtral SSE streaming pipeline.
//
// Two layers are tested independently:
//
//   1. Server-side accumulation (processTranscriptionStream from
//      app/api/transcribe/mistral/stream/route.ts) — a pure async function
//      that walks a Mistral event stream and calls sendEvent() with the
//      correct SSE payloads. No I/O, no auth, no Mistral client needed.
//
//   2. Client-side fallback (transcribeWithFallback from hooks/useVoxtral.ts)
//      — uses fetch, so we swap global.fetch with a lightweight stub that
//      returns either a fake SSE stream or a non-200 response to exercise
//      the REST fallback path.
//
// Adding new Mistral event types? Cover them in section 1.
// Changing the REST fallback URL or payload shape? Cover it in section 2.

import { test, expect } from "@playwright/test";
import { processTranscriptionStream } from "@/app/api/transcribe/mistral/stream/route";
import { transcribeWithFallback } from "@/hooks/useVoxtral";

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a fake async iterable from an array of Mistral event objects. */
async function* fakeEventStream(
  events: Array<{ type: string; text?: string }>,
): AsyncIterable<{ data: { type: string; text?: string } }> {
  for (const e of events) {
    yield { data: e };
  }
}

/**
 * Create a minimal fetch stub that returns a fake SSE ReadableStream.
 * `lines` should be raw SSE lines, e.g. `["data: {...}", ""]`.
 * Each pair of (data line, blank line) forms one SSE event.
 */
function fetchReturningSSE(lines: string[]): typeof fetch {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(enc.encode(line + "\n"));
      }
      controller.close();
    },
  });
  return () =>
    Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as ReturnType<typeof fetch>;
}

/**
 * Create a fetch stub that returns a non-200 for the first call
 * and a JSON body for the second call (REST fallback).
 */
function fetchSSEFailsThenREST(restResponseText: string): typeof fetch {
  let callCount = 0;
  return (..._args: Parameters<typeof fetch>) => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response("Service Unavailable", { status: 503 }),
      ) as ReturnType<typeof fetch>;
    }
    return Promise.resolve(
      new Response(JSON.stringify({ text: restResponseText }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as ReturnType<typeof fetch>;
  };
}

// ── 1. Server-side accumulation logic ─────────────────────────────────────

test("processTranscriptionStream: delta events accumulate and emit partial with full text", async () => {
  const events: Array<Record<string, unknown>> = [];
  const sendEvent = (e: Record<string, unknown>) => events.push(e);

  await processTranscriptionStream(
    fakeEventStream([
      { type: "transcription.text.delta", text: "Hallo" },
      { type: "transcription.text.delta", text: " Welt" },
    ]),
    sendEvent,
  );

  // Two partial events, each with the fully accumulated text so far
  expect(events[0]).toEqual({ type: "partial", text: "Hallo" });
  expect(events[1]).toEqual({ type: "partial", text: "Hallo Welt" });
  // No accumulated text means empty final is emitted — but here we DID
  // accumulate, so the "empty guard" final should NOT be emitted.
  // The transcription.done event is absent here so no final is sent by the loop —
  // only the empty-guard fires, but accumulated is non-empty so it must NOT fire.
  expect(events).toHaveLength(2);
});

test("processTranscriptionStream: transcription.done emits final with data.text when present", async () => {
  const events: Array<Record<string, unknown>> = [];

  await processTranscriptionStream(
    fakeEventStream([
      { type: "transcription.text.delta", text: "Teil1" },
      { type: "transcription.done", text: "Teil1 (full)" },
    ]),
    (e) => events.push(e),
  );

  const partial = events.find((e) => e.type === "partial");
  const final = events.find((e) => e.type === "final");

  expect(partial).toEqual({ type: "partial", text: "Teil1" });
  // done.text takes precedence over accumulated
  expect(final).toEqual({ type: "final", text: "Teil1 (full)" });
});

test("processTranscriptionStream: transcription.done falls back to accumulated when data.text is undefined", async () => {
  const events: Array<Record<string, unknown>> = [];

  await processTranscriptionStream(
    fakeEventStream([
      { type: "transcription.text.delta", text: "abc" },
      { type: "transcription.done" }, // no text field
    ]),
    (e) => events.push(e),
  );

  const final = events.find((e) => e.type === "final");
  expect(final).toEqual({ type: "final", text: "abc" });
});

test("processTranscriptionStream: empty result — no deltas → emits final with empty string", async () => {
  const events: Array<Record<string, unknown>> = [];

  await processTranscriptionStream(
    fakeEventStream([]), // Mistral returns nothing
    (e) => events.push(e),
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toEqual({ type: "final", text: "" });
});

test("processTranscriptionStream: unknown event types are silently ignored", async () => {
  const events: Array<Record<string, unknown>> = [];

  await processTranscriptionStream(
    fakeEventStream([
      { type: "session.created" },
      { type: "transcription.text.delta", text: "Hallo" },
      { type: "transcription.done", text: "Hallo" },
    ]),
    (e) => events.push(e),
  );

  // Only partial + final, the unknown event produces nothing
  expect(events.map((e) => e.type)).toEqual(["partial", "final"]);
});

// ── 2. Client-side transcribeWithFallback ──────────────────────────────────

test("transcribeWithFallback: partial SSE events are forwarded to onPartialTranscript", async () => {
  const partials: string[] = [];
  const finals: string[] = [];

  const originalFetch = global.fetch;
  global.fetch = fetchReturningSSE([
    `data: ${JSON.stringify({ type: "partial", text: "Hallo" })}`,
    "",
    `data: ${JSON.stringify({ type: "partial", text: "Hallo Welt" })}`,
    "",
    `data: ${JSON.stringify({ type: "final", text: "Hallo Welt!" })}`,
    "",
  ]);

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
      (p) => partials.push(p),
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(partials).toEqual(["Hallo", "Hallo Welt"]);
  expect(finals).toEqual(["Hallo Welt!"]);
});

test("transcribeWithFallback: SSE final event delivers transcript and stops reading", async () => {
  const finals: string[] = [];

  const originalFetch = global.fetch;
  global.fetch = fetchReturningSSE([
    `data: ${JSON.stringify({ type: "final", text: "Transkription fertig" })}`,
    "",
  ]);

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(finals).toHaveLength(1);
  expect(finals[0]).toBe("Transkription fertig");
});

test("transcribeWithFallback: REST fallback fires when SSE route returns non-200", async () => {
  const finals: string[] = [];

  const originalFetch = global.fetch;
  global.fetch = fetchSSEFailsThenREST("Fallback-Text");

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(finals).toHaveLength(1);
  expect(finals[0]).toBe("Fallback-Text");
});

test("transcribeWithFallback: SSE error event triggers REST fallback", async () => {
  const finals: string[] = [];

  const originalFetch = global.fetch;
  // First call → valid 200 SSE stream but carries an error event
  let callCount = 0;
  global.fetch = (..._args: Parameters<typeof fetch>) => {
    callCount++;
    if (callCount === 1) {
      return fetchReturningSSE([
        `data: ${JSON.stringify({ type: "error", error: "model_overloaded" })}`,
        "",
      ])(..._args);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ text: "REST-Ergebnis" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as ReturnType<typeof fetch>;
  };

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(finals).toHaveLength(1);
  expect(finals[0]).toBe("REST-Ergebnis");
});

// ── 3. Abort / error-recovery tests ────────────────────────────────────────

test("transcribeWithFallback: aborted before start → exits silently, onError NOT called", async () => {
  const errors: string[] = [];
  const finals: string[] = [];

  const ac = new AbortController();
  ac.abort(); // abort BEFORE the call

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = ((..._args: Parameters<typeof fetch>) => {
    fetchCalled = true;
    return Promise.resolve(new Response(JSON.stringify({ text: "should not arrive" }), { status: 200 }));
  }) as typeof fetch;

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
      undefined,
      (e) => errors.push(e),
      ac.signal,
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(errors).toHaveLength(0);
  expect(finals).toHaveLength(0);
  expect(fetchCalled).toBe(false);
});

test("transcribeWithFallback: aborted mid-SSE → exits silently, onError NOT called", async () => {
  const errors: string[] = [];
  const finals: string[] = [];

  const ac = new AbortController();

  const originalFetch = global.fetch;
  global.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    // Abort as soon as fetch is called (simulates abort arriving mid-request)
    ac.abort();
    // Simulate the browser rejecting the fetch due to abort
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    return Promise.reject(abortErr);
  }) as typeof fetch;

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      (t) => finals.push(t),
      undefined,
      (e) => errors.push(e),
      ac.signal,
    );
  } finally {
    global.fetch = originalFetch;
  }

  expect(errors).toHaveLength(0);
  expect(finals).toHaveLength(0);
});

test("transcribeWithFallback: signal is passed to fetch so the browser can abort the network request", async () => {
  const capturedSignals: (AbortSignal | undefined | null)[] = [];
  const ac = new AbortController();

  const originalFetch = global.fetch;
  global.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    capturedSignals.push(init?.signal);
    // Return a plain JSON body so REST path succeeds on the second call
    return Promise.resolve(
      new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/webm" }),
      "audio/webm",
      () => {},
      undefined,
      undefined,
      ac.signal,
    );
  } finally {
    global.fetch = originalFetch;
  }

  // At least the first fetch call must have received the signal.
  expect(capturedSignals.length).toBeGreaterThan(0);
  expect(capturedSignals[0]).toBe(ac.signal);
});

test("transcribeWithFallback: mp4 audio uses .m4a filename so Mistral decodes it correctly", async () => {
  const capturedForms: string[] = [];
  const originalFetch = global.fetch;

  global.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData | undefined;
    if (form instanceof FormData) {
      const file = form.get("audio");
      if (file instanceof File) capturedForms.push(file.name);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ text: "ok" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    // Simulate iOS audio/mp4 recording
    await transcribeWithFallback(
      new Blob(["audio"], { type: "audio/mp4" }),
      "audio/mp4",
      () => {},
    );
  } finally {
    global.fetch = originalFetch;
  }

  // Both attempts (SSE + REST fallback since SSE returned non-200 JSON)
  // should have used the .m4a extension
  expect(capturedForms.every((name) => name.endsWith(".m4a"))).toBe(true);
});
