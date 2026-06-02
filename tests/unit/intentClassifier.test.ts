// Unit tests for the voice intent classifier (lib/ai/intentClassifier.ts).
//
// Two layers are tested:
//
//   1. Fast-path regex heuristics (no network call, < 1 ms) —
//      the most safety-critical path because a mis-fire here would
//      pre-fill the wrong values into a log sheet without the user
//      having said anything that maps to that intent.
//
//   2. Slow-path fetch behaviour — when the regex doesn't match,
//      classifyIntent() calls POST /api/ai/classify-intent. These
//      tests stub global.fetch so we can exercise the happy path,
//      the parse-error fallback, and the network-error fallback
//      without a real Mistral key or a running dev server.
//
// The compliance gate (D-003) is enforced by the caller (useVoiceIntents)
// and by InsulinForm — classifyIntent() itself only produces an envelope,
// it never writes data. The unit tests here verify that the envelope
// shape is correct so callers can rely on it.

import { test, expect } from "@playwright/test";
import { classifyIntent } from "@/lib/ai/intentClassifier";

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a fetch stub that returns a JSON body with the given intent object. */
function fetchReturningIntent(intent: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ intent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as ReturnType<typeof fetch>;
}

/** Build a fetch stub that returns a non-200 response. */
function fetchReturningError(status = 500): typeof fetch {
  return () =>
    Promise.resolve(
      new Response("Server Error", { status }),
    ) as ReturnType<typeof fetch>;
}

/** Build a fetch stub that returns unparseable JSON. */
function fetchReturningBadJson(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as ReturnType<typeof fetch>;
}

// ── 1. Fast-path regex: Bolus utterances ──────────────────────────────────

test('fast-path: "4 Einheiten Novorapid" → log_bolus with units=4', async () => {
  const result = await classifyIntent("4 Einheiten Novorapid");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBe(4);
  expect(result.payload.insulin_name).toBe("Novorapid");
});

test('fast-path: "5 ie" (German abbreviation) → log_bolus with units=5', async () => {
  const result = await classifyIntent("5 ie");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBe(5);
});

test('fast-path: "3.5 units Fiasp" → log_bolus with units=3.5', async () => {
  const result = await classifyIntent("3.5 units Fiasp");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBeCloseTo(3.5);
  expect(result.payload.insulin_name).toBe("Fiasp");
});

test('fast-path: "7,5 Einheiten" (German decimal comma) → log_bolus with units=7.5', async () => {
  const result = await classifyIntent("7,5 Einheiten");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBeCloseTo(7.5);
});

test('fast-path: "2u" (short unit suffix) → log_bolus with units=2', async () => {
  const result = await classifyIntent("2u");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBe(2);
});

test('fast-path: "10 Unit Tresiba" → log_bolus with units=10', async () => {
  const result = await classifyIntent("10 Unit Tresiba");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBe(10);
  expect(result.payload.insulin_name).toBe("Tresiba");
});

test("fast-path: bolus without insulin name sets insulin_name to undefined", async () => {
  const result = await classifyIntent("6 Einheiten");
  expect(result.type).toBe("log_bolus");
  if (result.type !== "log_bolus") return;
  expect(result.payload.units).toBe(6);
  expect(result.payload.insulin_name).toBeUndefined();
});

test("fast-path: 0 units is rejected (must be > 0) → falls through to slow-path", async () => {
  // 0 units would be a dangerous mis-fire — must not produce log_bolus.
  // With fetch stubbed to error, it should fall back to fallback_chat.
  const originalFetch = global.fetch;
  global.fetch = fetchReturningError(401);
  try {
    const result = await classifyIntent("0 Einheiten");
    expect(result.type).toBe("fallback_chat");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fast-path: 101 units is rejected (above 100 cap) → falls through to slow-path", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchReturningError(401);
  try {
    const result = await classifyIntent("101 Einheiten");
    expect(result.type).toBe("fallback_chat");
  } finally {
    global.fetch = originalFetch;
  }
});

// ── 2. Fast-path regex: Navigate utterances ────────────────────────────────

test('fast-path: "Geh zu Insights" → navigate with screen=insights', async () => {
  const result = await classifyIntent("Geh zu Insights");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("insights");
});

test('fast-path: "Öffne Dashboard" → navigate with screen=dashboard', async () => {
  const result = await classifyIntent("Öffne Dashboard");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("dashboard");
});

test('fast-path: "Go to Settings" → navigate with screen=settings', async () => {
  const result = await classifyIntent("Go to Settings");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("settings");
});

test('fast-path: "Zeig mir Einstellungen" → navigate with screen=settings', async () => {
  const result = await classifyIntent("Zeig mir Einstellungen");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("settings");
});

test('fast-path: "Open engine" → navigate with screen=engine', async () => {
  const result = await classifyIntent("Open engine");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("engine");
});

test('fast-path: "Show entries" → navigate with screen=entries', async () => {
  const result = await classifyIntent("Show entries");
  expect(result.type).toBe("navigate");
  if (result.type !== "navigate") return;
  expect(result.payload.screen).toBe("entries");
});

// ── 3. Slow-path: fetch is called when regex doesn't match ────────────────

test("slow-path: ambiguous transcript calls fetch and returns the API intent", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchReturningIntent({
    type: "log_meal",
    payload: { input_text: "Pasta mit Tomatensoße", carbs_grams: 80 },
  });

  try {
    const result = await classifyIntent("Ich hatte heute Abend Pasta mit Tomatensoße");
    expect(result.type).toBe("log_meal");
    if (result.type !== "log_meal") return;
    expect(result.payload.input_text).toBe("Pasta mit Tomatensoße");
    expect(result.payload.carbs_grams).toBe(80);
  } finally {
    global.fetch = originalFetch;
  }
});

test("slow-path: non-200 API response → fallback_chat with the original transcript", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchReturningError(503);

  try {
    const result = await classifyIntent("Was denkt du über meinen Blutzucker?");
    expect(result.type).toBe("fallback_chat");
    if (result.type !== "fallback_chat") return;
    expect(result.payload.transcript).toBe("Was denkt du über meinen Blutzucker?");
  } finally {
    global.fetch = originalFetch;
  }
});

test("slow-path: malformed JSON from API → fallback_chat (parse-error graceful degradation)", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchReturningBadJson();

  try {
    const result = await classifyIntent("Was denkt du?");
    expect(result.type).toBe("fallback_chat");
  } finally {
    global.fetch = originalFetch;
  }
});

test("slow-path: API response with a valid type string is returned verbatim", async () => {
  // classifyIntent() trusts the server to have validated the intent type;
  // it returns whatever the API sends as long as .type is a string.
  // The unknown-type guard (KNOWN_INTENT_TYPES check) lives in the route
  // handler (handleClassifyPost) and is tested in classifyIntentRoute.test.ts.
  const originalFetch = global.fetch;
  global.fetch = fetchReturningIntent({
    type: "log_exercise",
    payload: { duration_minutes: 45, exercise_type: "run", intensity: "high" },
  });

  try {
    const result = await classifyIntent("Ich bin 45 Minuten gelaufen");
    expect(result.type).toBe("log_exercise");
  } finally {
    global.fetch = originalFetch;
  }
});

test("slow-path: network error → fallback_chat without throwing", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error("Network unreachable")) as ReturnType<typeof fetch>;

  try {
    const result = await classifyIntent("Netzwerkproblem test");
    expect(result.type).toBe("fallback_chat");
  } finally {
    global.fetch = originalFetch;
  }
});

test("slow-path: API returns intent with no type field → fallback_chat", async () => {
  const originalFetch = global.fetch;
  global.fetch = fetchReturningIntent({ payload: { units: 5 } }); // missing .type

  try {
    const result = await classifyIntent("Fehlerhaftes API-Ergebnis");
    expect(result.type).toBe("fallback_chat");
  } finally {
    global.fetch = originalFetch;
  }
});
