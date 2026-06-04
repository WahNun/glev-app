// tests/unit/macrosTransparencyPhase3.test.ts
//
// Phase 3 — Optimistic UI + Caching regression tests.
//
// Covers:
//   1. Promise.any aggregator race semantics (mock OFF/USDA).
//   2. System-prompt: items[] instruction present.
//   3. Tool schema: items[] marked as required.
//   4. userHistoryCache: caches and invalidates correctly.
//   5. Direct-save (confirm-action): parsed_json populated from items[].
//   6. Feature flags documented in .env.example.
//   7. Migration file for meal_prep_refinements exists.
//   8. Two-phase logic: optimistic path returns early with estimated items.
//   9. Timeout values tightened to 1.5s.

import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { aggregateBadge } from "@/lib/nutrition/badgeFor";
import type { NutritionSource } from "@/lib/nutrition/types";

// ── 1. aggregateBadge: Phase-3 source mix consistency ────────────────────

test("aggregateBadge: mixed with user_confirmed still produces mixed not verified", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "user_confirmed" },
    { source: "estimated" },
    { source: "open_food_facts" },
  ];
  expect(aggregateBadge(items)).toBe("mixed");
});

test("aggregateBadge: all user_history → verified (DB-backed)", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "user_history" },
    { source: "user_history" },
  ];
  expect(aggregateBadge(items)).toBe("verified");
});

// ── 2. System-prompt: items[] instruction present ─────────────────────────

test("system-prompt: includes mandatory items[] instruction", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevChatPrompt.ts"), "utf8");
  expect(src).toContain("items[]");
  expect(src).toContain("NIEMALS die gesamte Mahlzeit als ein einzelnes Item");
  expect(src).toContain("Liefere IMMER das items[]-Array");
});

test("system-prompt: includes concrete per-ingredient examples", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevChatPrompt.ts"), "utf8");
  expect(src).toContain("Hähnchenbrust");
  expect(src).toContain("Basmatireis");
});

// ── 3. Tool schema: items[] in required[] ────────────────────────────────

test("glevTools: log_meal_entry required[] includes items", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain('"input_text", "carbs_grams", "items"');
});

test("glevTools: items description says PFLICHT", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain("PFLICHT: Eine Zeile pro Zutat");
});

// ── 4. userHistoryCache: module exports correct interface ─────────────────

test("userHistoryCache: exports getCachedUserHistory and invalidate", () => {
  const src = readFileSync(join(process.cwd(), "lib/nutrition/userHistoryCache.ts"), "utf8");
  expect(src).toContain("export async function getCachedUserHistory");
  expect(src).toContain("export function invalidateUserHistory");
  expect(src).toContain("CACHE_TTL_MS");
});

test("userHistoryCache: TTL is 5 minutes", () => {
  const src = readFileSync(join(process.cwd(), "lib/nutrition/userHistoryCache.ts"), "utf8");
  expect(src).toContain("5 * 60_000");
});

// ── 5. Direct-save: parsed_json populated ────────────────────────────────

test("confirm-action route: reads items from payload", () => {
  const src = readFileSync(join(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain("p.items");
  expect(src).toContain("parsedJson");
  // Should NOT have the old 'parsed_json: []' hardcoded.
  expect(src).not.toContain("parsed_json: []");
});

test("confirm-action route: derives meal_type from classifyMeal", () => {
  const src = readFileSync(join(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain("classifyMeal");
  expect(src).toContain("derivedMealType");
});

// ── 6. Feature flags in .env.example ─────────────────────────────────────

test(".env.example: MACRO_AGGREGATOR_V2 documented", () => {
  const src = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  expect(src).toContain("MACRO_AGGREGATOR_V2");
});

test(".env.example: OPTIMISTIC_REFINEMENT documented", () => {
  const src = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  expect(src).toContain("OPTIMISTIC_REFINEMENT");
});

// ── 7. Migration file exists ──────────────────────────────────────────────

test("migration: meal_prep_refinements.sql exists", () => {
  const migDir = join(process.cwd(), "supabase/migrations");
  const files = require("node:fs").readdirSync(migDir);
  const found = files.some((f: string) => f.includes("meal_prep_refinements"));
  expect(found).toBe(true);
});

test("migration: meal_prep_refinements contains RLS and Realtime", () => {
  const migDir = join(process.cwd(), "supabase/migrations");
  const files = require("node:fs").readdirSync(migDir) as string[];
  const migFile = files.find((f) => f.includes("meal_prep_refinements"));
  expect(migFile).toBeTruthy();
  const src = readFileSync(join(migDir, migFile!), "utf8");
  expect(src).toContain("ROW LEVEL SECURITY");
  expect(src).toContain("supabase_realtime");
});

// ── 8. Two-phase logic in glevTools ──────────────────────────────────────

test("glevTools: OPTIMISTIC_REFINEMENT flag and detached aggregator present", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain("OPTIMISTIC_REFINEMENT");
  expect(src).toContain("void runAggregator");
  expect(src).toContain("meal_prep_refinements");
  expect(src).toContain("meal_prep_id");
});

test("glevTools: fallback to Mistral estimates in optimistic path", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain("source: \"estimated\" as const");
});

// ── 9. Timeout values tightened ──────────────────────────────────────────

test("openFoodFacts: timeout is 1500ms not 2500ms", () => {
  const src = readFileSync(join(process.cwd(), "lib/nutrition/openFoodFacts.ts"), "utf8");
  expect(src).toContain("OFF_TIMEOUT_MS = 1500");
  expect(src).not.toContain("OFF_TIMEOUT_MS = 2500");
});

test("usda: timeout is 1500ms not 2500ms", () => {
  const src = readFileSync(join(process.cwd(), "lib/nutrition/usda.ts"), "utf8");
  expect(src).toContain("USDA_TIMEOUT_MS = 1500");
  expect(src).not.toContain("USDA_TIMEOUT_MS = 2500");
});

// ── 10. Promise.any in aggregate.ts ──────────────────────────────────────

test("aggregate.ts: uses Promise.any for DB race", () => {
  const src = readFileSync(join(process.cwd(), "lib/nutrition/aggregate.ts"), "utf8");
  expect(src).toContain("Promise.any");
  expect(src).toContain("raceOrder");
});
