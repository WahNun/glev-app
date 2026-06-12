// Unit coverage for the voice intent classification and confirmation chip flow.
//
// What these tests pin:
//
//   1. classifyIntent() fast-path regex — bolus and navigate patterns
//      that resolve without a network round-trip. Each pattern is tested at a
//      representative value, a decimal separator variant, and the boundary
//      where the fast path SHOULD NOT fire (0-unit bolus).
//
//   2. WRITE_INTENTS membership — verifies the five intent types that require
//      user confirmation are present, and that navigate / fallback_chat are
//      NOT in the set (they are dispatched immediately or forwarded to chat).
//
//   3. useVoiceIntents routing logic — exercised via the exported __test__
//      helpers that mirror handleTranscript without touching React state:
//        • Every WRITE_INTENTS type → onPending callback, not dispatched.
//        • navigate → onDispatch immediately, no pending.
//        • fallback_chat → onFallback with the original transcript, no pending.
//
//   4. Confirm path — simulateConfirm verifies the correct CustomEvent type
//      is fired for each write intent (the contract between useVoiceIntents
//      and the log sheets that listen to these events).
//
//   5. Dismiss path — simulateDismiss verifies the ORIGINAL transcript (the
//      raw voice utterance) is passed back to onFallbackTranscript, not the
//      intent payload. This is the mis-classification escape hatch.
//
//   6. IntentConfirmChip auto-dismiss contract — AUTO_DISMISS_MS = 3 000 ms.
//      The constant is the shared clock between the progress-bar CSS animation
//      and the setTimeout; if either diverges the chip UI is broken.
//
// Note: /api/ai/classify-intent has been removed. Ambiguous transcripts now
// fall through directly to fallback_chat → gpt-4o-mini chat pipeline.

import { test, expect } from "@playwright/test";
import { classifyIntent, type IntentEnvelope } from "@/lib/ai/intentClassifier";
import { WRITE_INTENTS, __test__ as hookTest } from "@/hooks/useVoiceIntents";
import { AUTO_DISMISS_MS } from "@/components/IntentConfirmChip";

// ── 1. classifyIntent — fast-path (no fetch call) ─────────────────────────

test("classifyIntent fast-path: '4 Einheiten Novorapid' → log_bolus with correct units and name", async () => {
  const result = await classifyIntent("4 Einheiten Novorapid");
  expect(result.type).toBe("log_bolus");
  if (result.type === "log_bolus") {
    expect(result.payload.units).toBe(4);
    expect(result.payload.insulin_name).toBe("Novorapid");
  }
});

test("classifyIntent fast-path: '5 IE' shorthand → log_bolus, no insulin_name", async () => {
  const result = await classifyIntent("5 IE");
  expect(result.type).toBe("log_bolus");
  if (result.type === "log_bolus") {
    expect(result.payload.units).toBe(5);
    expect(result.payload.insulin_name).toBeUndefined();
  }
});

test("classifyIntent fast-path: '3,5 Units Fiasp' decimal comma → log_bolus with 3.5 units", async () => {
  const result = await classifyIntent("3,5 Units Fiasp");
  expect(result.type).toBe("log_bolus");
  if (result.type === "log_bolus") {
    expect(result.payload.units).toBeCloseTo(3.5);
    expect(result.payload.insulin_name).toBe("Fiasp");
  }
});

test("classifyIntent fast-path: '2u' compact unit → log_bolus", async () => {
  const result = await classifyIntent("2u");
  expect(result.type).toBe("log_bolus");
  if (result.type === "log_bolus") {
    expect(result.payload.units).toBe(2);
  }
});

test("classifyIntent fast-path: '0 IE' → NOT log_bolus (safety: 0-unit guard rejects it)", async () => {
  // The regex matches but units=0 is rejected by the > 0 guard, so the fast
  // path returns null and classifyIntent falls through directly to fallback_chat.
  // This is the important safety invariant — no network call needed.
  const result = await classifyIntent("0 IE");
  expect(result.type).toBe("fallback_chat");
});

test("classifyIntent fast-path: 'Geh zu Dashboard' → navigate screen=dashboard", async () => {
  const result = await classifyIntent("Geh zu Dashboard");
  expect(result.type).toBe("navigate");
  if (result.type === "navigate") {
    expect(result.payload.screen).toBe("dashboard");
  }
});

test("classifyIntent fast-path: 'Öffne Insights' → navigate screen=insights", async () => {
  const result = await classifyIntent("Öffne Insights");
  expect(result.type).toBe("navigate");
  if (result.type === "navigate") {
    expect(result.payload.screen).toBe("insights");
  }
});

test("classifyIntent fast-path: 'go to settings' (English) → navigate screen=settings", async () => {
  const result = await classifyIntent("go to settings");
  expect(result.type).toBe("navigate");
  if (result.type === "navigate") {
    expect(result.payload.screen).toBe("settings");
  }
});

test("classifyIntent fast-path: 'Öffne Einstellungen' (German synonym) → navigate screen=settings", async () => {
  const result = await classifyIntent("Öffne Einstellungen");
  expect(result.type).toBe("navigate");
  if (result.type === "navigate") {
    expect(result.payload.screen).toBe("settings");
  }
});

// ── 2. WRITE_INTENTS membership ────────────────────────────────────────────

test("WRITE_INTENTS: contains all five write intent types", () => {
  const required = [
    "log_bolus",
    "log_meal",
    "log_exercise",
    "log_symptom",
    "edit_macro",
  ];
  for (const type of required) {
    expect(WRITE_INTENTS.has(type)).toBe(true);
  }
  // Exactly five — no accidental extras
  expect(WRITE_INTENTS.size).toBe(5);
});

test("WRITE_INTENTS: does NOT include navigate (dispatched immediately)", () => {
  expect(WRITE_INTENTS.has("navigate")).toBe(false);
});

test("WRITE_INTENTS: does NOT include fallback_chat (forwarded to chat)", () => {
  expect(WRITE_INTENTS.has("fallback_chat")).toBe(false);
});

// ── 4. Intent routing logic ────────────────────────────────────────────────

test("routing: log_bolus → held as pendingIntent, not dispatched", () => {
  const pending: IntentEnvelope[] = [];
  const dispatched: string[] = [];
  const fallbacks: string[] = [];

  hookTest.routeIntent(
    { type: "log_bolus", payload: { units: 4 } },
    "4 IE",
    {
      onPending: (i) => pending.push(i),
      onDispatch: (t) => dispatched.push(t),
      onFallback: (txt) => fallbacks.push(txt),
    },
  );

  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("log_bolus");
  expect(dispatched).toHaveLength(0);
  expect(fallbacks).toHaveLength(0);
});

test("routing: log_meal → held as pendingIntent", () => {
  const pending: IntentEnvelope[] = [];

  hookTest.routeIntent(
    { type: "log_meal", payload: { input_text: "Pasta Bolognese" } },
    "Pasta Bolognese",
    {
      onPending: (i) => pending.push(i),
      onDispatch: () => {},
      onFallback: () => {},
    },
  );

  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("log_meal");
});

test("routing: log_exercise → held as pendingIntent", () => {
  const pending: IntentEnvelope[] = [];

  hookTest.routeIntent(
    { type: "log_exercise", payload: { duration_minutes: 45, exercise_type: "Radfahren" } },
    "45 Minuten Radfahren",
    {
      onPending: (i) => pending.push(i),
      onDispatch: () => {},
      onFallback: () => {},
    },
  );

  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("log_exercise");
});

test("routing: log_symptom → held as pendingIntent", () => {
  const pending: IntentEnvelope[] = [];

  hookTest.routeIntent(
    { type: "log_symptom", payload: { symptom_types: ["Schwindel", "Schwitzen"] } },
    "Ich fühle mich schwindelig und schwitze",
    {
      onPending: (i) => pending.push(i),
      onDispatch: () => {},
      onFallback: () => {},
    },
  );

  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("log_symptom");
});

test("routing: edit_macro → held as pendingIntent", () => {
  const pending: IntentEnvelope[] = [];

  hookTest.routeIntent(
    { type: "edit_macro", payload: { field: "carbs", value: 45 } },
    "Setze KH auf 45",
    {
      onPending: (i) => pending.push(i),
      onDispatch: () => {},
      onFallback: () => {},
    },
  );

  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("edit_macro");
});

test("routing: navigate → dispatched immediately, no pendingIntent", () => {
  const pending: IntentEnvelope[] = [];
  const dispatched: string[] = [];

  hookTest.routeIntent(
    { type: "navigate", payload: { screen: "engine" } },
    "Geh zu Engine",
    {
      onPending: (i) => pending.push(i),
      onDispatch: (t) => dispatched.push(t),
      onFallback: () => {},
    },
  );

  expect(pending).toHaveLength(0);
  expect(dispatched).toEqual(["navigate"]);
});

test("routing: fallback_chat → onFallback called with original transcript, no pending", () => {
  const pending: IntentEnvelope[] = [];
  const fallbacks: string[] = [];

  hookTest.routeIntent(
    { type: "fallback_chat", payload: { transcript: "Was ist IOB?" } },
    "Was ist IOB?",
    {
      onPending: (i) => pending.push(i),
      onDispatch: () => {},
      onFallback: (txt) => fallbacks.push(txt),
    },
  );

  expect(pending).toHaveLength(0);
  expect(fallbacks).toEqual(["Was ist IOB?"]);
});

// ── 5. Confirm path — CustomEvent types ───────────────────────────────────

test("confirm: log_bolus → fires glev:open-bolus-log with payload", () => {
  const events: Array<{ type: string; detail: unknown }> = [];

  const cleared = hookTest.simulateConfirm(
    { type: "log_bolus", payload: { units: 3, insulin_name: "Novorapid" } },
    (type, detail) => events.push({ type, detail }),
  );

  expect(cleared).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("glev:open-bolus-log");
  expect((events[0].detail as { units: number }).units).toBe(3);
});

test("confirm: log_meal → fires glev:open-meal-log", () => {
  const events: string[] = [];

  hookTest.simulateConfirm(
    { type: "log_meal", payload: { input_text: "Reis mit Gemüse" } },
    (type) => events.push(type),
  );

  expect(events[0]).toBe("glev:open-meal-log");
});

test("confirm: log_exercise → fires glev:open-exercise-log", () => {
  const events: string[] = [];

  hookTest.simulateConfirm(
    { type: "log_exercise", payload: { duration_minutes: 60 } },
    (type) => events.push(type),
  );

  expect(events[0]).toBe("glev:open-exercise-log");
});

test("confirm: log_symptom → fires glev:open-symptom-log", () => {
  const events: string[] = [];

  hookTest.simulateConfirm(
    { type: "log_symptom", payload: { symptom_types: ["Hypo"] } },
    (type) => events.push(type),
  );

  expect(events[0]).toBe("glev:open-symptom-log");
});

test("confirm: edit_macro → fires glev:set-macro with field and value", () => {
  const events: Array<{ type: string; detail: unknown }> = [];

  hookTest.simulateConfirm(
    { type: "edit_macro", payload: { field: "carbs", value: 60 } },
    (type, detail) => events.push({ type, detail }),
  );

  expect(events[0].type).toBe("glev:set-macro");
  const d = events[0].detail as { field: string; value: number };
  expect(d.field).toBe("carbs");
  expect(d.value).toBe(60);
});

test("confirm: navigate → fires glev:intent-navigate with screen", () => {
  const events: Array<{ type: string; detail: unknown }> = [];

  hookTest.simulateConfirm(
    { type: "navigate", payload: { screen: "insights" } },
    (type, detail) => events.push({ type, detail }),
  );

  expect(events[0].type).toBe("glev:intent-navigate");
  expect((events[0].detail as { screen: string }).screen).toBe("insights");
});

// ── 6. Dismiss path ────────────────────────────────────────────────────────

test("dismiss: calls onFallbackTranscript with the original voice utterance", () => {
  const fallbacks: string[] = [];
  const originalTranscript = "4 IE Novorapid";

  hookTest.simulateDismiss(
    { type: "log_bolus", payload: { units: 4, insulin_name: "Novorapid" } },
    originalTranscript,
    (txt) => fallbacks.push(txt),
  );

  expect(fallbacks).toHaveLength(1);
  expect(fallbacks[0]).toBe(originalTranscript);
});

test("dismiss: original transcript is used — not derived from the intent payload", () => {
  // The mis-classification scenario: the voice said something ambiguous that
  // the classifier mis-identified. The user taps "Ändern" — the raw utterance
  // goes back to chat so the user can rephrase. The intent payload is discarded.
  const fallbacks: string[] = [];
  const rawUtterance = "Was soll ich heute essen?"; // clearly NOT a bolus

  hookTest.simulateDismiss(
    { type: "log_bolus", payload: { units: 4 } }, // mis-classified
    rawUtterance,
    (txt) => fallbacks.push(txt),
  );

  expect(fallbacks[0]).toBe(rawUtterance);
  // The intent payload ("4 units") must NOT appear in the fallback text
  expect(fallbacks[0]).not.toContain("4");
});

test("dismiss: works for every write intent type without loss of transcript", () => {
  const intents: IntentEnvelope[] = [
    { type: "log_bolus", payload: { units: 2 } },
    { type: "log_meal", payload: { input_text: "Salat" } },
    { type: "log_exercise", payload: {} },
    { type: "log_symptom", payload: {} },
    { type: "edit_macro", payload: { field: "fat", value: 10 } },
  ];
  const transcript = "Ich meinte eigentlich etwas anderes";

  for (const intent of intents) {
    const fallbacks: string[] = [];
    hookTest.simulateDismiss(intent, transcript, (t) => fallbacks.push(t));
    expect(fallbacks).toEqual([transcript]);
  }
});

// ── 7. IntentConfirmChip auto-dismiss contract ─────────────────────────────

test("IntentConfirmChip: AUTO_DISMISS_MS is exactly 3 000 ms", () => {
  // This constant is shared by the CSS animation (intentChipProgress) and
  // the useEffect setTimeout. If they diverge the progress bar and the actual
  // dismiss fire at different times, breaking the UX contract.
  expect(AUTO_DISMISS_MS).toBe(3000);
});
