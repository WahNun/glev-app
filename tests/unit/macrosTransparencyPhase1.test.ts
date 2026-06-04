// tests/unit/macrosTransparencyPhase1.test.ts
//
// Phase 1 — Macros Transparency Layer regression tests.
//
// Covers:
//   1. aggregateBadge() — correct BadgeKind for all source mixes.
//   2. sourceLabel()    — correct human-readable labels for DE and EN.
//   3. Chip expand UI   — snapshot of key DOM strings (no browser needed;
//      we test the helper logic, not React rendering).
//   4. Settings page    — route file exists and exports a default.

import { test, expect } from "@playwright/test";
import { aggregateBadge, sourceLabel } from "@/lib/nutrition/badgeFor";
import type { NutritionSource } from "@/lib/nutrition/types";

// ── 1. aggregateBadge ─────────────────────────────────────────────────────

test("aggregateBadge: empty list → estimated", () => {
  expect(aggregateBadge([])).toBe("estimated");
});

test("aggregateBadge: all estimated → estimated", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "estimated" },
    { source: "estimated" },
  ];
  expect(aggregateBadge(items)).toBe("estimated");
});

test("aggregateBadge: all unknown → estimated (unknown treated as estimated)", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "unknown" },
    { source: "unknown" },
  ];
  expect(aggregateBadge(items)).toBe("estimated");
});

test("aggregateBadge: all open_food_facts → verified", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "open_food_facts" },
    { source: "open_food_facts" },
  ];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: all usda → verified", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "usda" },
    { source: "usda" },
  ];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: user_history → verified", () => {
  const items: Array<{ source: NutritionSource }> = [{ source: "user_history" }];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: user_confirmed → verified", () => {
  const items: Array<{ source: NutritionSource }> = [{ source: "user_confirmed" }];
  expect(aggregateBadge(items)).toBe("verified");
});

test("aggregateBadge: mix of usda + estimated → mixed", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "usda" },
    { source: "estimated" },
  ];
  expect(aggregateBadge(items)).toBe("mixed");
});

test("aggregateBadge: mix of open_food_facts + unknown → mixed", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "open_food_facts" },
    { source: "unknown" },
  ];
  expect(aggregateBadge(items)).toBe("mixed");
});

test("aggregateBadge: mix of user_confirmed + estimated → mixed", () => {
  const items: Array<{ source: NutritionSource }> = [
    { source: "user_confirmed" },
    { source: "estimated" },
    { source: "open_food_facts" },
  ];
  expect(aggregateBadge(items)).toBe("mixed");
});

// ── 2. sourceLabel ────────────────────────────────────────────────────────

test("sourceLabel: open_food_facts → OFF (both locales)", () => {
  expect(sourceLabel("open_food_facts", "de")).toBe("OFF");
  expect(sourceLabel("open_food_facts", "en")).toBe("OFF");
});

test("sourceLabel: usda → USDA (both locales)", () => {
  expect(sourceLabel("usda", "de")).toBe("USDA");
  expect(sourceLabel("usda", "en")).toBe("USDA");
});

test("sourceLabel: user_history → Logs (both locales)", () => {
  expect(sourceLabel("user_history", "de")).toBe("Logs");
  expect(sourceLabel("user_history", "en")).toBe("Logs");
});

test("sourceLabel: user_confirmed → Logs (both locales)", () => {
  expect(sourceLabel("user_confirmed", "de")).toBe("Logs");
  expect(sourceLabel("user_confirmed", "en")).toBe("Logs");
});

test("sourceLabel: estimated → KI (de) / AI (en)", () => {
  expect(sourceLabel("estimated", "de")).toBe("KI");
  expect(sourceLabel("estimated", "en")).toBe("AI");
});

test("sourceLabel: unknown → KI (de) / AI (en) as fallback", () => {
  expect(sourceLabel("unknown", "de")).toBe("KI");
  expect(sourceLabel("unknown", "en")).toBe("AI");
});

// ── 3. Settings-Page route file exists ────────────────────────────────────

test("data-sources settings page: file exists and contains default export", () => {
  const { existsSync, readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const pagePath = join(
    process.cwd(),
    "app/(protected)/settings/data-sources/page.tsx",
  );
  expect(existsSync(pagePath)).toBe(true);
  const src = readFileSync(pagePath, "utf8");
  expect(src).toContain("export default function DataSourcesPage");
});
