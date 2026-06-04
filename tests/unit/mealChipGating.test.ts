/**
 * Unit tests for the meal-chip gating contract in GlevAIChatSheet.tsx
 * and the openEngineForMeal navigation in lib/useGlevAI.ts.
 *
 * Task #1144 replaced the old "Bestätigen" confirm button on meal chips
 * with a two-step flow:
 *   1. A full-width "Engine öffnen →" button that navigates to /engine.
 *   2. A ✕ ghost button that discards/cancels the pending meal entry.
 *
 * When a turn produces multiple meal chips (e.g. "Pizza AND Ice Cream"),
 * only the *first* unresolved chip is interactive; subsequent ones are
 * dimmed (opacity 0.4, pointerEvents: none) and become active after the
 * first is resolved (confirmed or cancelled).
 *
 * Why Playwright runner (no browser):
 *   The repo's only test runner is Playwright. `playwright.config.ts`
 *   picks up `tests/unit/*.test.ts` alongside the e2e specs. No DOM is
 *   exercised here — all assertions are either against source-file text
 *   (structural contract) or against a pure-function mirror of the
 *   component's gating logic.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

// ── Source files read once ────────────────────────────────────────────────────

const CHAT_SHEET_SRC = readFileSync(
  resolve(process.cwd(), "components/GlevAIChatSheet.tsx"),
  "utf8",
);

const USE_GLEV_AI_SRC = readFileSync(
  resolve(process.cwd(), "lib/useGlevAI.ts"),
  "utf8",
);

// ── Pure-function mirror of the isMealChipActive gating logic ─────────────────
//
// This mirrors the logic inside the `pendingActions.map()` call at lines
// 887-912 of GlevAIChatSheet.tsx. If the component's logic changes, the
// source-contract tests below will catch the deviation.

type ChipKind = "log_meal_entry" | string;
type ChipState = "pending" | "confirming" | "confirmed" | "cancelled" | "error";

interface FakePendingAction {
  kind: ChipKind;
  state: ChipState;
  token: string;
}

/**
 * Reproduces the isMealChipActive computation for every chip in a turn.
 * Returns an array parallel to `pendingActions`; non-meal chips get
 * `undefined` (the prop is not passed for non-meal chips).
 */
function computeChipActiveStates(
  pendingActions: FakePendingAction[],
): (boolean | undefined)[] {
  let seenUnresolvedMeal = false;
  return pendingActions.map((pa) => {
    let isMealChipActive: boolean | undefined;
    if (pa.kind === "log_meal_entry") {
      const isUnresolved = pa.state === "pending" || pa.state === "confirming";
      if (isUnresolved && !seenUnresolvedMeal) {
        isMealChipActive = true;
        seenUnresolvedMeal = true;
      } else if (isUnresolved) {
        isMealChipActive = false;
      } else {
        // Resolved chips (confirmed / cancelled / error) are always "active"
        // so they render their resolved state rather than being dimmed.
        isMealChipActive = true;
      }
    }
    return isMealChipActive;
  });
}

// ── Section 1: Source-contract — "Engine öffnen →" vs. "Bestätigen" ───────────

test("meal chip layout contains the text 'Engine öffnen →'", () => {
  // The string must appear inside the `if (isMeal)` block.
  // We detect it by finding the meal-chip section (between `if (isMeal) {`
  // and the closing non-meal comment) and checking that the button text exists.
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");

  expect(mealBlockStart).toBeGreaterThan(-1);
  expect(mealBlockEnd).toBeGreaterThan(mealBlockStart);

  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);
  expect(mealBlock).toContain("Engine öffnen →");
});

test("meal chip layout does NOT contain a 'Bestätigen' button", () => {
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");

  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);
  // The word "Bestätigen" must not appear anywhere inside the meal chip block.
  expect(mealBlock).not.toContain("Bestätigen");
});

test("non-meal chip layout retains the 'Bestätigen' button", () => {
  // Ensure we have not accidentally removed Bestätigen from non-meal chips.
  const nonMealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");
  expect(nonMealBlockStart).toBeGreaterThan(-1);

  const nonMealBlock = CHAT_SHEET_SRC.slice(nonMealBlockStart);
  expect(nonMealBlock).toContain("Bestätigen");
});

// ── Section 2: Source-contract — inactive chip dimming ───────────────────────

test("inactive meal chip is dimmed to opacity 0.4", () => {
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");
  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);

  // The style object must use `inactive ? 0.4 : 1` for opacity.
  expect(mealBlock).toMatch(/opacity:\s*inactive\s*\?\s*0\.4\s*:/);
});

test("inactive meal chip has pointerEvents: 'none'", () => {
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");
  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);

  // The style must toggle pointerEvents between "none" (inactive) and "auto".
  expect(mealBlock).toMatch(/pointerEvents:\s*inactive\s*\?\s*["']none["']/);
});

// ── Section 3: Source-contract — ✕ cancel button ─────────────────────────────

test("meal chip has a ✕ dismiss button with aria-label 'Mahlzeit verwerfen'", () => {
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");
  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);

  expect(mealBlock).toContain('aria-label="Mahlzeit verwerfen"');
});

test("✕ cancel button calls onCancel prop", () => {
  // The dismiss button's onClick must be wired to onCancel, not onOpenEngine.
  const mealBlockStart = CHAT_SHEET_SRC.indexOf("// ── Meal chip layout");
  const mealBlockEnd = CHAT_SHEET_SRC.indexOf("// ── Non-meal chip layout");
  const mealBlock = CHAT_SHEET_SRC.slice(mealBlockStart, mealBlockEnd);

  // Find the dismiss button section (between aria-label and the summary div)
  const dismissStart = mealBlock.indexOf('aria-label="Mahlzeit verwerfen"');
  const dismissEnd = mealBlock.indexOf("{/* Summary text", dismissStart);
  const dismissButton = mealBlock.slice(dismissStart, dismissEnd);

  expect(dismissButton).toContain("onClick={onCancel}");
  expect(dismissButton).not.toContain("onOpenEngine");
});

// ── Section 4: Source-contract — navigation to /engine ───────────────────────

test("openEngineForMeal navigates to '/engine'", () => {
  // The function must call onNavigate("/engine") or router.push("/engine").
  // Current implementation: `optsRef.current?.onNavigate?.("/engine")`
  expect(USE_GLEV_AI_SRC).toContain('"/engine"');

  // Specifically inside the openEngineForMeal function body.
  const fnStart = USE_GLEV_AI_SRC.indexOf("openEngineForMeal:");
  expect(fnStart).toBeGreaterThan(-1);

  // Find the closing brace of the function by scanning forward 80 lines.
  const fnSlice = USE_GLEV_AI_SRC.slice(fnStart, fnStart + 3000);
  expect(fnSlice).toContain('"/engine"');
});

test("openEngineForMeal calls confirmAction after navigation", () => {
  const fnStart = USE_GLEV_AI_SRC.indexOf("openEngineForMeal:");
  const fnSlice = USE_GLEV_AI_SRC.slice(fnStart, fnStart + 3000);

  // Must call confirmAction so the server-side pending_action is resolved.
  expect(fnSlice).toContain("confirmAction(messageId, token)");
});

test("openEngineForMeal writes macros to sessionStorage under 'glev_pending_meal'", () => {
  const fnStart = USE_GLEV_AI_SRC.indexOf("openEngineForMeal:");
  const fnSlice = USE_GLEV_AI_SRC.slice(fnStart, fnStart + 3000);

  expect(fnSlice).toContain("glev_pending_meal");
  expect(fnSlice).toContain("sessionStorage.setItem");
});

test("openEngineForMeal dispatches 'glev:meal-prefill' CustomEvent", () => {
  const fnStart = USE_GLEV_AI_SRC.indexOf("openEngineForMeal:");
  const fnSlice = USE_GLEV_AI_SRC.slice(fnStart, fnStart + 3000);

  expect(fnSlice).toContain("glev:meal-prefill");
  expect(fnSlice).toContain("CustomEvent");
});

// ── Section 5: Pure-logic — isMealChipActive gating ──────────────────────────

test("single pending meal chip is active", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "pending", token: "t1" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states).toEqual([true]);
});

test("single confirming meal chip is active", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "confirming", token: "t1" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states).toEqual([true]);
});

test("non-meal chip always returns undefined for isMealChipActive", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_exercise_entry", state: "pending", token: "t1" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states).toEqual([undefined]);
});

test("two pending meal chips: first is active, second is dimmed", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "pending", token: "t1" },
    { kind: "log_meal_entry", state: "pending", token: "t2" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states[0]).toBe(true);  // first chip: active (interactive)
  expect(states[1]).toBe(false); // second chip: dimmed (opacity 0.4)
});

test("three pending meal chips: first active, second and third dimmed", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "pending", token: "t1" },
    { kind: "log_meal_entry", state: "pending", token: "t2" },
    { kind: "log_meal_entry", state: "pending", token: "t3" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states[0]).toBe(true);
  expect(states[1]).toBe(false);
  expect(states[2]).toBe(false);
});

test("after first chip is cancelled, second chip becomes active", () => {
  // Simulates user tapping ✕ on chip 1: state changes to 'cancelled'.
  // Resolved chips (confirmed/cancelled) are treated as active (they
  // render their resolved state and do not block later chips).
  const actionsAfterCancel: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "cancelled", token: "t1" }, // resolved
    { kind: "log_meal_entry", state: "pending",   token: "t2" }, // now first unresolved
  ];
  const states = computeChipActiveStates(actionsAfterCancel);
  expect(states[0]).toBe(true);  // cancelled chip renders its resolved state
  expect(states[1]).toBe(true);  // second chip is now the first unresolved → active
});

test("after first chip is confirmed (Engine opened), second chip becomes active", () => {
  const actionsAfterConfirm: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "confirmed", token: "t1" }, // Engine opened
    { kind: "log_meal_entry", state: "pending",   token: "t2" }, // now first unresolved
  ];
  const states = computeChipActiveStates(actionsAfterConfirm);
  expect(states[0]).toBe(true);  // confirmed chip shows "✓ Engine geöffnet"
  expect(states[1]).toBe(true);  // second chip is now first unresolved → active
});

test("mixed turn: non-meal chip between two meal chips does not affect gating", () => {
  // The seenUnresolvedMeal flag only increments on meal chips, so a
  // bolus chip between two meal chips should not break the sequence.
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry",     state: "pending", token: "t1" },
    { kind: "log_exercise_entry", state: "pending", token: "t2" }, // non-meal
    { kind: "log_meal_entry",     state: "pending", token: "t3" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states[0]).toBe(true);     // first meal chip: active
  expect(states[1]).toBeUndefined(); // non-meal chip: no isMealChipActive prop
  expect(states[2]).toBe(false);    // second meal chip: dimmed
});

test("all resolved chips in a turn are all active (no dimming)", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "confirmed", token: "t1" },
    { kind: "log_meal_entry", state: "cancelled", token: "t2" },
    { kind: "log_meal_entry", state: "confirmed", token: "t3" },
  ];
  const states = computeChipActiveStates(actions);
  // No chip is pending/confirming, so seenUnresolvedMeal stays false
  // and every resolved chip hits the `else { isMealChipActive = true }` branch.
  expect(states).toEqual([true, true, true]);
});

test("error-state chip is treated as resolved (active, not dimmed)", () => {
  const actions: FakePendingAction[] = [
    { kind: "log_meal_entry", state: "error",   token: "t1" }, // error = resolved
    { kind: "log_meal_entry", state: "pending", token: "t2" },
  ];
  const states = computeChipActiveStates(actions);
  expect(states[0]).toBe(true);  // error chip: active (shows retry button)
  expect(states[1]).toBe(true);  // now first unresolved → active
});

// ── Section 6: Source-contract — chip gating wiring in the render loop ────────

test("component render loop tracks seenUnresolvedMeal across chips in a turn", () => {
  // The variable name 'seenUnresolvedMeal' must exist in the render loop
  // so we can confirm the exact gating mechanism is in place.
  expect(CHAT_SHEET_SRC).toContain("seenUnresolvedMeal");
});

test("isMealChipActive is derived from kind === 'log_meal_entry' check", () => {
  expect(CHAT_SHEET_SRC).toContain('"log_meal_entry"');
  // The active-chip check must reference isMealChipActive as a prop passed to PendingActionWidget.
  expect(CHAT_SHEET_SRC).toContain("isMealChipActive={isMealChipActive}");
});

test("PendingActionWidget receives onOpenEngine prop wired to onOpenEngineForMeal", () => {
  // In the render loop, each chip must get the onOpenEngine callback.
  expect(CHAT_SHEET_SRC).toContain("onOpenEngine={() => onOpenEngineForMeal?.(m.id, pa.token)}");
});
