// tests/unit/alcoholDualEmission.test.ts
//
// Alcohol Dual-Emission feature regression tests.
//
// Covers:
//   1. ParsedFood.alcohol_g type extension (backward-compat).
//   2. DualPendingActionEnvelope type guard works.
//   3. Tool schema: alcohol_g field present in items[] spec.
//   4. System-prompt: alcohol instruction present.
//   5. Dual-emission logic: total_alcohol_g in MealPendingPayload.
//   6. InfluencePrepPayload shape.
//   7. confirm-action: source_meal_token field recognised.
//   8. evaluation.ts: linkedAlcoholG field accepted, alcohol_extended_window tagged.
//   9. Migration file exists with source_meal_id + alcohol_g columns.
//  10. InfluencePrepChip component file exists.

import { test, expect } from "@playwright/test";
import { isDualPendingActionEnvelope } from "@/lib/ai/glevTools";
import type { ParsedFood } from "@/lib/meals";
import type { MealPendingPayload, InfluencePrepPayload } from "@/lib/useGlevAI";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── 1. ParsedFood.alcohol_g backward-compat ───────────────────────────────

test("ParsedFood: alcohol_g optional, absent in non-alcoholic items", () => {
  const food: ParsedFood = {
    name: "Hähnchenbrust", grams: 180, carbs: 0, protein: 36, fat: 5, fiber: 0,
  };
  expect(food.alcohol_g).toBeUndefined();
});

test("ParsedFood: alcohol_g present for alcoholic items", () => {
  const beer: ParsedFood = {
    name: "Bier 0.5l", grams: 500, carbs: 15, protein: 1, fat: 0, fiber: 0,
    alcohol_g: 20,
  };
  expect(beer.alcohol_g).toBe(20);
});

// ── 2. DualPendingActionEnvelope type guard ───────────────────────────────

test("isDualPendingActionEnvelope: returns false for single PendingActionEnvelope", () => {
  expect(isDualPendingActionEnvelope({ pending_action: { token: "x", kind: "log_meal_entry", summary: "" } })).toBe(false);
});

test("isDualPendingActionEnvelope: returns false for non-array", () => {
  expect(isDualPendingActionEnvelope({ dual_pending_actions: "not-array" })).toBe(false);
});

test("isDualPendingActionEnvelope: returns false for wrong-length array", () => {
  expect(isDualPendingActionEnvelope({ dual_pending_actions: [{ token: "a" }] })).toBe(false);
});

test("isDualPendingActionEnvelope: returns true for correct dual envelope", () => {
  const dual = {
    dual_pending_actions: [
      { token: "meal-token", kind: "log_meal_entry", summary: "Bockwurst + Bier" },
      { token: "infl-token", kind: "log_influence_entry", summary: "Alkohol 20g" },
    ],
  };
  expect(isDualPendingActionEnvelope(dual)).toBe(true);
});

// ── 3. Tool schema: alcohol_g in items[] ─────────────────────────────────

test("glevTools: log_meal_entry items schema includes alcohol_g", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain("alcohol_g");
  expect(src).toContain("0.33l Bier");
});

// ── 4. System-prompt: alcohol instruction ─────────────────────────────────

test("system-prompt: contains alcohol_g instruction for items[]", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevChatPrompt.ts"), "utf8");
  expect(src).toContain("ALKOHOL in items[]");
  expect(src).toContain("0.5l Bier");
  expect(src).toContain("log_influence_entry NICHT separat aufrufen");
});

// ── 5. MealPendingPayload: total_alcohol_g + linked_influence_token ───────

test("MealPendingPayload: total_alcohol_g optional field", () => {
  const payload: MealPendingPayload = {
    input_text: "Bockwurst und Bier",
    carbs_grams: 16,
    protein_grams: 12,
    fat_grams: 14,
    fiber_grams: 0,
    logged_at: "2026-06-04T19:00:00Z",
    glucose_before: null,
    total_alcohol_g: 20,
    linked_influence_token: "infl-token-abc",
  };
  expect(payload.total_alcohol_g).toBe(20);
  expect(payload.linked_influence_token).toBe("infl-token-abc");
});

test("MealPendingPayload: total_alcohol_g absent for non-alcoholic meals", () => {
  const payload: MealPendingPayload = {
    input_text: "Hähnchen mit Reis",
    carbs_grams: 45,
    protein_grams: 36,
    fat_grams: 5,
    fiber_grams: 1,
    logged_at: "2026-06-04T12:00:00Z",
    glucose_before: null,
  };
  expect(payload.total_alcohol_g).toBeUndefined();
});

// ── 6. InfluencePrepPayload shape ─────────────────────────────────────────

test("InfluencePrepPayload: correct shape for alcohol influence", () => {
  const p: InfluencePrepPayload = {
    influence_type:    "alcohol",
    alcohol_g:         20,
    source_meal_token: "meal-token-xyz",
    note:              "aus Mahlzeit: Bockwurst und Bier",
    logged_at:         "2026-06-04T19:00:00Z",
  };
  expect(p.influence_type).toBe("alcohol");
  expect(p.alcohol_g).toBe(20);
  expect(p.source_meal_token).toBe("meal-token-xyz");
});

// ── 7. confirm-action: source_meal_token recognised ──────────────────────

test("confirm-action route: handles source_meal_token for linkage", () => {
  const src = readFileSync(join(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain("source_meal_token");
  expect(src).toContain("source_meal_id");
  expect(src).toContain("alcohol_g");
});

// ── 8. evaluation.ts: linkedAlcoholG + alcohol_extended_window ───────────

test("evaluation.ts: accepts linkedAlcoholG input field", () => {
  const src = readFileSync(join(process.cwd(), "lib/engine/evaluation.ts"), "utf8");
  expect(src).toContain("linkedAlcoholG");
  expect(src).toContain("alcohol_extended_window");
});

// ── 9. Migration file ─────────────────────────────────────────────────────

test("migration: influence_meal_linkage.sql exists with source_meal_id", () => {
  const migDir = join(process.cwd(), "supabase/migrations");
  const files = require("node:fs").readdirSync(migDir) as string[];
  const file = files.find((f) => f.includes("influence_meal_linkage"));
  expect(file).toBeTruthy();
  const content = readFileSync(join(migDir, file!), "utf8");
  expect(content).toContain("source_meal_id");
  expect(content).toContain("alcohol_g");
  expect(content).toContain("ON DELETE SET NULL");
});

// ── 10. InfluencePrepChip component ──────────────────────────────────────

test("InfluencePrepChip: component file exists with correct exports", () => {
  const path = join(process.cwd(), "components/InfluencePrepChip.tsx");
  expect(existsSync(path)).toBe(true);
  const src = readFileSync(path, "utf8");
  expect(src).toContain("export default function InfluencePrepChip");
  expect(src).toContain("InfluencePrepPayload");
  // Chip shows hint about extended hypo monitoring
  expect(src).toContain("6–8h");
});

// ── 11. Doppel-Counting-Schutz ────────────────────────────────────────────

test("glevTools: alcohol_g is NOT added to carbs (double-counting guard)", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  // Alcohol summing only targets alcohol_g, not carbs
  expect(src).toContain("totalAlcoholG");
  // The carbs resolved values (resolvedCarbs etc.) must NOT include alcohol_g
  expect(src).toContain("resolvedCarbs   = Math.round(totals.carbs");
  // alcohol_g sum is separate from carbs sum
  expect(src).toContain("total_alcohol_g");
});
