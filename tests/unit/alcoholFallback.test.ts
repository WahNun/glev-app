// tests/unit/alcoholFallback.test.ts
//
// Unit tests for the server-side alcohol keyword fallback.
// Covers keyword detection, estimation, non-alcoholic override, and
// dual-emission readiness (totalAlcoholG > 0 when Mistral omits alcohol_g).

import { test, expect } from "@playwright/test";
import { applyAlcoholFallback, sumAlcoholG } from "@/lib/ai/alcoholFallback";

// ── Helpers ───────────────────────────────────────────────────────────────

function item(name: string, grams: number, alcohol_g?: number) {
  return alcohol_g !== undefined ? { name, grams, alcohol_g } : { name, grams };
}

// ── Non-alcoholic items: no trigger ───────────────────────────────────────

test("Spaghetti → no alcohol_g set", () => {
  const result = applyAlcoholFallback([item("Spaghetti", 200)]);
  expect(result[0].alcohol_g).toBeUndefined();
});

test("Hähnchenbrust → no alcohol_g set", () => {
  const result = applyAlcoholFallback([item("Hähnchenbrust", 150)]);
  expect(result[0].alcohol_g).toBeUndefined();
});

test("Apfelsaft → no alcohol_g set", () => {
  const result = applyAlcoholFallback([item("Apfelsaft", 200)]);
  expect(result[0].alcohol_g).toBeUndefined();
});

// ── Non-alcoholic override (exempt keywords) ──────────────────────────────

test("Alkoholfreies Bier → alcohol_g = 0", () => {
  const result = applyAlcoholFallback([item("Alkoholfreies Bier", 330)]);
  expect(result[0].alcohol_g).toBe(0);
});

test("non-alcoholic beer → alcohol_g = 0", () => {
  const result = applyAlcoholFallback([item("non-alcoholic beer", 330)]);
  expect(result[0].alcohol_g).toBe(0);
});

test("Bier 0,0% → alcohol_g = 0", () => {
  const result = applyAlcoholFallback([item("Bier 0,0%", 500)]);
  expect(result[0].alcohol_g).toBe(0);
});

test("alcohol-free wine → alcohol_g = 0", () => {
  const result = applyAlcoholFallback([item("alcohol-free wine", 200)]);
  expect(result[0].alcohol_g).toBe(0);
});

// ── Bier ──────────────────────────────────────────────────────────────────

test("Bier 500ml (500g) → alcohol_g ≈ 20", () => {
  const result = applyAlcoholFallback([item("Bier", 500)]);
  // 500 * 0.04 = 20
  expect(result[0].alcohol_g).toBeCloseTo(20, 0);
});

test("Pils 330ml (330g) → alcohol_g ≈ 13.2", () => {
  const result = applyAlcoholFallback([item("Pils", 330)]);
  expect(result[0].alcohol_g).toBeCloseTo(330 * 0.04, 1);
});

test("Starkbier 500ml → alcohol_g ≈ 37.5", () => {
  const result = applyAlcoholFallback([item("Starkbier", 500)]);
  expect(result[0].alcohol_g).toBeCloseTo(500 * 0.075, 1);
});

test("Doppelbock 500ml → alcohol_g ≈ 37.5 (Starkbier-path)", () => {
  const result = applyAlcoholFallback([item("Doppelbock Bier", 500)]);
  expect(result[0].alcohol_g).toBeCloseTo(500 * 0.075, 1);
});

// ── Wein ──────────────────────────────────────────────────────────────────

test("Rotwein 200ml (200g) → alcohol_g ≈ 20", () => {
  const result = applyAlcoholFallback([item("Rotwein", 200)]);
  // 200 * 0.10 = 20
  expect(result[0].alcohol_g).toBeCloseTo(20, 0);
});

test("Weißwein 150ml → alcohol_g ≈ 15", () => {
  const result = applyAlcoholFallback([item("Weißwein", 150)]);
  expect(result[0].alcohol_g).toBeCloseTo(15, 1);
});

test("Glas Wein 0.2L (200g) → alcohol_g ≈ 20", () => {
  const result = applyAlcoholFallback([item("Glas Rotwein 0.2L", 200)]);
  expect(result[0].alcohol_g).toBeCloseTo(20, 0);
});

// ── Sekt / Prosecco ───────────────────────────────────────────────────────

test("Prosecco 125ml → alcohol_g ≈ 12.5", () => {
  const result = applyAlcoholFallback([item("Prosecco", 125)]);
  expect(result[0].alcohol_g).toBeCloseTo(12.5, 1);
});

test("Sekt 125ml → alcohol_g ≈ 12.5", () => {
  const result = applyAlcoholFallback([item("Sekt", 125)]);
  expect(result[0].alcohol_g).toBeCloseTo(12.5, 1);
});

// ── Aperol Spritz ─────────────────────────────────────────────────────────

test("Aperol Spritz 200ml → alcohol_g ≈ 12", () => {
  const result = applyAlcoholFallback([item("Aperol Spritz", 200)]);
  // 200 * 0.06 = 12
  expect(result[0].alcohol_g).toBeCloseTo(12, 0);
});

// ── Spirits ───────────────────────────────────────────────────────────────

test("Vodka 40ml → alcohol_g ≈ 14", () => {
  const result = applyAlcoholFallback([item("Vodka", 40)]);
  expect(result[0].alcohol_g).toBeCloseTo(40 * 0.35, 1);
});

test("Whisky 40ml → alcohol_g ≈ 14", () => {
  const result = applyAlcoholFallback([item("Whisky", 40)]);
  expect(result[0].alcohol_g).toBeCloseTo(14, 1);
});

test("Rum 40ml → alcohol_g ≈ 14", () => {
  const result = applyAlcoholFallback([item("Rum", 40)]);
  expect(result[0].alcohol_g).toBeCloseTo(14, 1);
});

test("Tequila 40ml → alcohol_g ≈ 14", () => {
  const result = applyAlcoholFallback([item("Tequila", 40)]);
  expect(result[0].alcohol_g).toBeCloseTo(14, 1);
});

test("Gin 40ml → alcohol_g ≈ 14", () => {
  const result = applyAlcoholFallback([item("Gin", 40)]);
  expect(result[0].alcohol_g).toBeCloseTo(14, 1);
});

// ── Cocktails ─────────────────────────────────────────────────────────────

test("Mojito 250ml → alcohol_g ≈ 20", () => {
  const result = applyAlcoholFallback([item("Mojito", 250)]);
  expect(result[0].alcohol_g).toBeCloseTo(250 * 0.08, 1);
});

test("Caipirinha 250ml → alcohol_g ≈ 20", () => {
  const result = applyAlcoholFallback([item("Caipirinha", 250)]);
  expect(result[0].alcohol_g).toBeCloseTo(250 * 0.08, 1);
});

test("Cocktail (generic) 200ml → alcohol_g ≈ 16", () => {
  const result = applyAlcoholFallback([item("Cocktail", 200)]);
  expect(result[0].alcohol_g).toBeCloseTo(200 * 0.08, 1);
});

// ── Mistral already set alcohol_g ─────────────────────────────────────────

test("Mistral sets alcohol_g=20 for Bier → keep unchanged", () => {
  const result = applyAlcoholFallback([item("Bier", 500, 20)]);
  expect(result[0].alcohol_g).toBe(20);
});

test("Mistral sets alcohol_g=16 for Wein → keep unchanged", () => {
  const result = applyAlcoholFallback([item("Rotwein", 200, 16)]);
  expect(result[0].alcohol_g).toBe(16);
});

// ── Mixed meal: Bockwurst + Bier ──────────────────────────────────────────

test("Bockwurst + Bier (500g) → Bier gets alcohol_g ≈ 20, Bockwurst none", () => {
  const result = applyAlcoholFallback([
    item("Bockwurst", 200),
    item("Bier", 500),
  ]);
  expect(result[0].alcohol_g).toBeUndefined();  // Bockwurst: no match
  expect(result[1].alcohol_g).toBeCloseTo(20, 0); // Bier: 500 * 0.04
});

// ── sumAlcoholG ───────────────────────────────────────────────────────────

test("sumAlcoholG: sums all alcohol_g values", () => {
  const enriched = applyAlcoholFallback([
    item("Bier", 500),   // 20g
    item("Rotwein", 200), // 20g
    item("Bockwurst", 200), // 0
  ]);
  expect(sumAlcoholG(enriched)).toBeCloseTo(40, 0);
});

test("sumAlcoholG: returns 0 for non-alcoholic meal", () => {
  const enriched = applyAlcoholFallback([
    item("Hähnchenbrust", 180),
    item("Basmatireis", 150),
  ]);
  expect(sumAlcoholG(enriched)).toBe(0);
});

// ── Dual-emission readiness ───────────────────────────────────────────────

test("dual-emission fires when Mistral omits alcohol_g but item is Bier", () => {
  // Simulates what toolLogMealEntry does: Mistral returns items without alcohol_g
  const mistralItems = [
    { name: "Bockwurst", grams: 200 },
    { name: "Bier", grams: 500 },       // alcohol_g NOT set by Mistral
  ];
  const enriched = applyAlcoholFallback(mistralItems);
  const totalAlcoholG = sumAlcoholG(enriched);
  // totalAlcoholG > 0 → dual-emission would fire
  expect(totalAlcoholG).toBeGreaterThan(0);
  expect(totalAlcoholG).toBeCloseTo(20, 0);
});

test("dual-emission does NOT fire for plain food without alcohol", () => {
  const mistralItems = [
    { name: "Spaghetti Bolognese", grams: 350 },
    { name: "Parmesan", grams: 20 },
  ];
  const enriched = applyAlcoholFallback(mistralItems);
  const totalAlcoholG = sumAlcoholG(enriched);
  expect(totalAlcoholG).toBe(0);
});

// ── glevTools source guards ───────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

test("glevTools: uses sumAlcoholG(enrichedItems) not resolvedItems.reduce", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  expect(src).toContain("sumAlcoholG(enrichedItems)");
  expect(src).toContain("applyAlcoholFallback(rawItems)");
  expect(src).not.toContain("(resolvedItems ?? []).reduce");
});

test("GlevAIChatSheet: duplicate bottom-bar Engine button removed", () => {
  const src = readFileSync(join(process.cwd(), "components/GlevAIChatSheet.tsx"), "utf8");
  // The redundant button rendered `label — open_engine_chip` text with `pendingMealNavQueue`
  expect(src).not.toContain("pendingMealNavQueue[0].label || t.meal_fallback} — {t.open_engine_chip}");
  // The primary mini-chip button (PendingActionWidget → open_engine) must still exist
  expect(src).toContain("open_engine_chip");
  expect(src).toContain("PendingActionWidget");
});
