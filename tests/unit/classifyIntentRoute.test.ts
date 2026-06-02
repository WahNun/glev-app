// Unit tests for the POST /api/ai/classify-intent route handler.
//
// The core Mistral-calling logic is extracted into `handleClassifyPost()`
// so we can inject a mock Mistral client without needing auth, the
// Next.js runtime, or a real Mistral API key.
//
// What is tested:
//   1. Happy path — valid JSON from Mistral → response carries the intent.
//   2. Unknown intent type from Mistral → fallback_chat (guard rail).
//   3. Empty model response → fallback_chat (guard rail).
//   4. Model returns non-JSON → fallback_chat (parse error graceful
//      degradation — the safety-critical path flagged in the task).
//   5. Mistral client throws → fallback_chat (network / SDK error).
//   6. All seven known intent types are returned verbatim.

import { test, expect } from "@playwright/test";
import { handleClassifyPost, KNOWN_INTENT_TYPES } from "@/app/api/ai/classify-intent/route";
import type { Mistral } from "@mistralai/mistralai";

// ── Mistral client factory ─────────────────────────────────────────────────
//
// We only need the `.chat.complete()` method. The type cast keeps TS happy
// without pulling in the full Mistral SDK at test time.

function makeMistral(content: string | null | (() => never)): Mistral {
  return {
    chat: {
      complete: typeof content === "function"
        ? content
        : async () => ({
          choices: content === null
            ? []
            : [{ message: { content } }],
        }),
    },
  } as unknown as Mistral;
}

// ── 1. Happy path ──────────────────────────────────────────────────────────

test("route: valid log_bolus JSON from Mistral → response carries intent", async () => {
  const mistral = makeMistral(
    JSON.stringify({ type: "log_bolus", payload: { units: 4, insulin_name: "NovoRapid" } }),
  );

  const res = await handleClassifyPost(mistral, "vier Einheiten NovoRapid");
  expect(res.status).toBe(200);

  const body = await res.json() as { intent: { type: string; payload: { units: number; insulin_name: string } } };
  expect(body.intent.type).toBe("log_bolus");
  expect(body.intent.payload.units).toBe(4);
  expect(body.intent.payload.insulin_name).toBe("NovoRapid");
});

test("route: valid navigate JSON from Mistral → response carries intent", async () => {
  const mistral = makeMistral(
    JSON.stringify({ type: "navigate", payload: { screen: "insights" } }),
  );

  const res = await handleClassifyPost(mistral, "take me to insights please");
  const body = await res.json() as { intent: { type: string; payload: { screen: string } } };
  expect(body.intent.type).toBe("navigate");
  expect(body.intent.payload.screen).toBe("insights");
});

test("route: valid log_meal JSON from Mistral → intent returned verbatim", async () => {
  const mistral = makeMistral(
    JSON.stringify({ type: "log_meal", payload: { input_text: "Pasta Bolognese", carbs_grams: 70 } }),
  );

  const res = await handleClassifyPost(mistral, "Pasta Bolognese");
  const body = await res.json() as { intent: { type: string; payload: { input_text: string; carbs_grams: number } } };
  expect(body.intent.type).toBe("log_meal");
  expect(body.intent.payload.input_text).toBe("Pasta Bolognese");
  expect(body.intent.payload.carbs_grams).toBe(70);
});

// ── 2. All known intent types are returned verbatim ────────────────────────

test("route: all seven KNOWN_INTENT_TYPES are accepted without fallback", async () => {
  const fixtures: Array<{ type: string; payload: Record<string, unknown> }> = [
    { type: "log_bolus",    payload: { units: 5 } },
    { type: "log_meal",     payload: { input_text: "Brot" } },
    { type: "log_exercise", payload: { duration_minutes: 30, exercise_type: "cardio", intensity: "medium" } },
    { type: "log_symptom",  payload: { symptom_types: ["headache"] } },
    { type: "edit_macro",   payload: { field: "carbs", value: 60 } },
    { type: "navigate",     payload: { screen: "dashboard" } },
    { type: "fallback_chat",payload: { transcript: "Hallo?" } },
  ];

  expect(fixtures).toHaveLength(KNOWN_INTENT_TYPES.size);

  for (const fixture of fixtures) {
    const mistral = makeMistral(JSON.stringify(fixture));
    const res = await handleClassifyPost(mistral, "test");
    const body = await res.json() as { intent: { type: string } };
    expect(body.intent.type, `expected ${fixture.type} to be returned verbatim`).toBe(fixture.type);
  }
});

// ── 3. Guard rails: unknown / invalid Mistral output → fallback_chat ───────

test("route: unknown intent type from Mistral → fallback_chat (guard rail)", async () => {
  const mistral = makeMistral(
    JSON.stringify({ type: "delete_all_entries", payload: {} }),
  );

  const res = await handleClassifyPost(mistral, "nuke everything");
  const body = await res.json() as { intent: { type: string; payload: { transcript: string } } };
  expect(body.intent.type).toBe("fallback_chat");
  expect(body.intent.payload.transcript).toBe("nuke everything");
});

test("route: empty model response → fallback_chat", async () => {
  // choices array is empty — content falls back to ""
  const mistral = makeMistral(null);

  const res = await handleClassifyPost(mistral, "leere Antwort");
  const body = await res.json() as { intent: { type: string } };
  expect(body.intent.type).toBe("fallback_chat");
});

test("route: non-JSON model response → fallback_chat (parse-error graceful degradation)", async () => {
  // The model returned prose instead of JSON — this is the safety-critical
  // path: a parse error must NEVER cause a 500 or an unhandled throw.
  const mistral = makeMistral("Sorry, I can't help with that.");

  const res = await handleClassifyPost(mistral, "irgendwas");
  expect(res.status).toBe(200);
  const body = await res.json() as { intent: { type: string } };
  expect(body.intent.type).toBe("fallback_chat");
});

test("route: Mistral client throws (network error) → fallback_chat, not 500", async () => {
  const mistral = makeMistral(() => {
    throw new Error("upstream timeout");
  });

  const res = await handleClassifyPost(mistral, "timeoutest");
  expect(res.status).toBe(200);
  const body = await res.json() as { intent: { type: string } };
  expect(body.intent.type).toBe("fallback_chat");
});

test("route: model returns intent with no type field → fallback_chat", async () => {
  const mistral = makeMistral(JSON.stringify({ payload: { units: 5 } })); // missing .type

  const res = await handleClassifyPost(mistral, "fehlerhaft");
  const body = await res.json() as { intent: { type: string } };
  expect(body.intent.type).toBe("fallback_chat");
});

test("route: whitespace-only model response → fallback_chat", async () => {
  const mistral = makeMistral("   ");

  const res = await handleClassifyPost(mistral, "leerzeichen");
  const body = await res.json() as { intent: { type: string } };
  expect(body.intent.type).toBe("fallback_chat");
});

// ── 4. Transcript is passed through in fallback payload ───────────────────

test("route: fallback_chat payload carries the original transcript", async () => {
  const mistral = makeMistral("not json");
  const transcript = "Wie war mein heutiger Verlauf?";

  const res = await handleClassifyPost(mistral, transcript);
  const body = await res.json() as { intent: { type: string; payload: { transcript?: string } } };
  expect(body.intent.type).toBe("fallback_chat");
  expect(body.intent.payload.transcript).toBe(transcript);
});
