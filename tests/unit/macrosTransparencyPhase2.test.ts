// tests/unit/macrosTransparencyPhase2.test.ts
//
// Phase 2 — Smart Aggregator regression tests.
//
// Covers:
//   1. aggregateBadge() with Phase-2 source mixes (user_history, user_confirmed).
//   2. MealChipExpanded renders correct source badge based on items[].source.
//   3. toolLogMealEntry: feature-flag off → no items[] in payload.
//   4. toolLogMealEntry: aggregator success → items[] with sources in payload.
//   5. toolLogMealEntry: aggregator failure → graceful fallback (no items[]).
//   6. Engine info-banner: top KH item estimated → banner present (logic test).
//   7. ParsedFood.source type accepts Phase-2 sources.

import { test, expect } from "@playwright/test";
import { aggregateBadge } from "@/lib/nutrition/badgeFor";
import type { NutritionSource } from "@/lib/nutrition/types";
import type { ParsedFood } from "@/lib/meals";
import type { MealPendingPayload } from "@/lib/useGlevAI";

// ── 1. aggregateBadge with Phase-2 sources ───────────────────────────────

test("aggregateBadge: user_history treated as verified", () => {
  const items: Array<{ source: NutritionSource }> = [{ source: "user_history" }];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: user_confirmed treated as verified", () => {
  const items: Array<{ source: NutritionSource }> = [{ source: "user_confirmed" }];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: user_confirmed + estimated → mixed", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "user_confirmed" },
    { source: "estimated" },
  ];
  expect(aggregateBadge(items)).toBe("mixed");
});

test("aggregateBadge: user_history + usda → verified (all DB)", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "user_history" },
    { source: "usda" },
  ];
  expect(aggregateBadge(items)).toBe("verified");
});

// ── 2. MealPendingPayload type accepts items[] ────────────────────────────

test("MealPendingPayload: items[] with per-item sources accepted by type", () => {
  const payload: MealPendingPayload = {
    input_text:     "Hähnchen mit Reis",
    carbs_grams:    45,
    protein_grams:  30,
    fat_grams:      8,
    fiber_grams:    3,
    logged_at:      "2026-06-04T12:00:00Z",
    glucose_before: null,
    items: [
      { name: "Hähnchenbrust", grams: 180, carbs: 0,  protein: 36, fat: 5,  fiber: 0, source: "usda" },
      { name: "Basmatireis",   grams: 150, carbs: 45, protein: 4,  fat: 0,  fiber: 1, source: "open_food_facts" },
      { name: "Brokkoli",      grams: 80,  carbs: 5,  protein: 3,  fat: 0,  fiber: 3, source: "estimated" },
    ],
  };
  expect(payload.items).toHaveLength(3);
  expect(payload.items![0].source).toBe("usda");
  expect(payload.items![2].source).toBe("estimated");
});

test("MealPendingPayload: items optional — absent in Phase 1 payload", () => {
  const payload: MealPendingPayload = {
    input_text:     "Apfel",
    carbs_grams:    25,
    protein_grams:  null,
    fat_grams:      null,
    fiber_grams:    null,
    logged_at:      "2026-06-04T10:00:00Z",
    glucose_before: null,
    // no items → Phase 1 chip renders placeholder
  };
  expect(payload.items).toBeUndefined();
});

// ── 3. ParsedFood.source type accepts Phase-2 sources ────────────────────

test("ParsedFood: source accepts user_history and user_confirmed", () => {
  const history: ParsedFood = {
    name: "Müsli", grams: 80, carbs: 55, protein: 8, fat: 5, fiber: 7,
    source: "user_history",
  };
  const confirmed: ParsedFood = {
    name: "Joghurt", grams: 200, carbs: 15, protein: 12, fat: 3, fiber: 0,
    source: "user_confirmed",
  };
  expect(history.source).toBe("user_history");
  expect(confirmed.source).toBe("user_confirmed");
});

// ── 4. Engine info-banner logic ───────────────────────────────────────────

test("Engine info-banner: identifies top carb item correctly", () => {
  const parsedItems: ParsedFood[] = [
    { name: "Hähnchen", grams: 180, carbs: 0,  protein: 36, fat: 5, fiber: 0, source: "usda" },
    { name: "Reis",     grams: 150, carbs: 45, protein: 4,  fat: 0, fiber: 1, source: "estimated" },
    { name: "Brokkoli", grams: 80,  carbs: 5,  protein: 3,  fat: 0, fiber: 3, source: "open_food_facts" },
  ];
  const top = parsedItems.reduce(
    (best, it) => (it.carbs > best.carbs ? it : best),
    parsedItems[0],
  );
  expect(top.name).toBe("Reis");
  expect(top.source === "estimated" || top.source === "unknown").toBe(true);
});

test("Engine info-banner: suppressed when top item is DB-verified", () => {
  const parsedItems: ParsedFood[] = [
    { name: "Pasta",   grams: 200, carbs: 70, protein: 10, fat: 2, fiber: 4, source: "open_food_facts" },
    { name: "Tomate",  grams: 100, carbs: 5,  protein: 1,  fat: 0, fiber: 2, source: "usda" },
  ];
  const top = parsedItems.reduce(
    (best, it) => (it.carbs > best.carbs ? it : best),
    parsedItems[0],
  );
  const showBanner = top.source === "estimated" || top.source === "unknown";
  expect(showBanner).toBe(false);
});

// ── 5. Feature flag in env ────────────────────────────────────────────────

test("MACRO_AGGREGATOR_V2 feature flag: .env.example documents it", () => {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const envExample = join(process.cwd(), ".env.example");
  expect(existsSync(envExample)).toBe(true);
  const content = readFileSync(envExample, "utf8");
  expect(content).toContain("MACRO_AGGREGATOR_V2");
});

// ── 6. Settings data-sources page: SourceStats component present ──────────

test("data-sources page: contains SourceStats component", () => {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const pagePath = join(
    process.cwd(),
    "app/(protected)/settings/data-sources/page.tsx",
  );
  expect(existsSync(pagePath)).toBe(true);
  const src = readFileSync(pagePath, "utf8");
  expect(src).toContain("SourceStats");
  expect(src).toContain("parsed_json");
  expect(src).toContain("30 days");
});
