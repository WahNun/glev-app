// Unit tests for the macro-goals blur-clamping logic (snap-back fix).
//
// Background: Task #1220 fixed a regression where clearing a macro input
// and re-typing caused the value to snap back to the previous number.
// The root cause was that onChange called parseInt + setState, so every
// keystroke that produced an invalid intermediate string (e.g. "") was
// immediately clamped back.  The fix decouples display state from numeric
// state and moves all clamping to onBlur via `clampMacroOnBlur`.
//
// These tests guard against a future regression reintroducing early clamping.
// Pure-function tests — no DOM, no DB, no Next.js runtime.

import { test, expect } from "@playwright/test";
import { clampMacroOnBlur } from "@/app/(protected)/settings/makros/page";
import { DEFAULT_MACRO_TARGETS } from "@/lib/userSettings";

// ── clampMacroOnBlur — empty / invalid input falls back to default ──────────

test("clampMacroOnBlur: empty string returns the default value", () => {
  // Simulates user clearing the carbs field and blurring — must snap to 250.
  expect(clampMacroOnBlur("", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(250);
});

test("clampMacroOnBlur: whitespace-only string returns the default value", () => {
  expect(clampMacroOnBlur("   ", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(250);
});

test("clampMacroOnBlur: non-numeric string returns the default value", () => {
  expect(clampMacroOnBlur("abc", 2000, DEFAULT_MACRO_TARGETS.protein)).toBe(120);
});

test("clampMacroOnBlur: minus sign alone returns the default value", () => {
  expect(clampMacroOnBlur("-", 2000, DEFAULT_MACRO_TARGETS.fat)).toBe(80);
});

// ── valid values are preserved ──────────────────────────────────────────────

test("clampMacroOnBlur: valid in-range number is kept as-is", () => {
  // User typed 180 — within [0, 2000] — must come out as 180.
  expect(clampMacroOnBlur("180", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(180);
});

test("clampMacroOnBlur: value of 0 is valid and preserved", () => {
  expect(clampMacroOnBlur("0", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(0);
});

test("clampMacroOnBlur: value equal to max is preserved", () => {
  // Fiber max is 200.
  expect(clampMacroOnBlur("200", 200, DEFAULT_MACRO_TARGETS.fiber)).toBe(200);
});

test("clampMacroOnBlur: value of 1 (minimum positive) is preserved", () => {
  expect(clampMacroOnBlur("1", 2000, DEFAULT_MACRO_TARGETS.protein)).toBe(1);
});

// ── values above max are clamped to max ────────────────────────────────────

test("clampMacroOnBlur: value above max is clamped to max (carbs, max 2000)", () => {
  expect(clampMacroOnBlur("9999", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(2000);
});

test("clampMacroOnBlur: value above max is clamped to max (fiber, max 200)", () => {
  // User typed 500 but fiber cap is 200.
  expect(clampMacroOnBlur("500", 200, DEFAULT_MACRO_TARGETS.fiber)).toBe(200);
});

test("clampMacroOnBlur: one over max is clamped to max", () => {
  expect(clampMacroOnBlur("201", 200, DEFAULT_MACRO_TARGETS.fiber)).toBe(200);
});

// ── negative values are clamped to 0 ───────────────────────────────────────

test("clampMacroOnBlur: negative number is clamped to 0", () => {
  // parseInt("-5") = -5 which is finite but below 0 → clamp to 0.
  expect(clampMacroOnBlur("-5", 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(0);
});

// ── regression guard: the default targets themselves survive a round-trip ──

test("clampMacroOnBlur: default carbs survives a blur round-trip", () => {
  const raw = String(DEFAULT_MACRO_TARGETS.carbs); // "250"
  expect(clampMacroOnBlur(raw, 2000, DEFAULT_MACRO_TARGETS.carbs)).toBe(250);
});

test("clampMacroOnBlur: default fiber survives a blur round-trip", () => {
  const raw = String(DEFAULT_MACRO_TARGETS.fiber); // "30"
  expect(clampMacroOnBlur(raw, 200, DEFAULT_MACRO_TARGETS.fiber)).toBe(30);
});
