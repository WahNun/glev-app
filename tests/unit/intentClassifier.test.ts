// Unit tests for the voice intent classifier (lib/ai/intentClassifier.ts).
//
// Fast-path regex heuristics (no network call, < 1 ms) —
// the most safety-critical path because a mis-fire here would
// pre-fill the wrong values into a log sheet without the user
// having said anything that maps to that intent.
//
// Slow-path: /api/ai/classify-intent has been removed. Ambiguous
// transcripts now fall through directly to fallback_chat, which
// routes them to the main gpt-4o-mini chat pipeline.
//
// The compliance gate (D-003) is enforced by the caller (useVoiceIntents)
// and by InsulinForm — classifyIntent() itself only produces an envelope,
// it never writes data. The unit tests here verify that the envelope
// shape is correct so callers can rely on it.

import { test, expect } from "@playwright/test";
import { classifyIntent } from "@/lib/ai/intentClassifier";

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

test("fast-path: 0 units is rejected (must be > 0) → fallback_chat directly", async () => {
  // 0 units would be a dangerous mis-fire — must not produce log_bolus.
  // Fast-path rejects it; no network call exists, so it falls straight to fallback_chat.
  const result = await classifyIntent("0 Einheiten");
  expect(result.type).toBe("fallback_chat");
});

test("fast-path: 101 units is rejected (above 100 cap) → fallback_chat directly", async () => {
  const result = await classifyIntent("101 Einheiten");
  expect(result.type).toBe("fallback_chat");
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

// ── 3. Slow-path: ambiguous transcripts fall through directly ─────────────

test("slow-path removed: ambiguous transcript → fallback_chat directly (no fetch)", async () => {
  // /api/ai/classify-intent has been removed. Ambiguous utterances that
  // don't match the fast-path regex return fallback_chat immediately so
  // the caller routes them into the main gpt-4o-mini chat pipeline.
  const result = await classifyIntent("Was denkt du über meinen Blutzucker?");
  expect(result.type).toBe("fallback_chat");
  if (result.type === "fallback_chat") {
    expect(result.payload.transcript).toBe("Was denkt du über meinen Blutzucker?");
  }
});
