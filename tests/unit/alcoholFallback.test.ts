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

// ── Radler ────────────────────────────────────────────────────────────────

test("Radler 500ml (500g) → alcohol_g ≈ 12.5 (lower ABV than Bier)", () => {
  const result = applyAlcoholFallback([item("Radler", 500)]);
  // 500 * 0.025 = 12.5
  expect(result[0].alcohol_g).toBeCloseTo(12.5, 1);
});

test("Radler 330ml → alcohol_g less than same volume Bier", () => {
  const bier = applyAlcoholFallback([item("Bier", 330)])[0].alcohol_g!;
  const radler = applyAlcoholFallback([item("Radler", 330)])[0].alcohol_g!;
  expect(radler).toBeLessThan(bier);
});

// ── Cider ─────────────────────────────────────────────────────────────────

test("Cider 330ml (330g) → alcohol_g ≈ 14.9", () => {
  const result = applyAlcoholFallback([item("Cider", 330)]);
  // 330 * 0.045 = 14.85 → rounded to 14.9 by applyAlcoholFallback
  expect(result[0].alcohol_g).toBeCloseTo(14.9, 0);
});

test("Apple Cider 500ml → alcohol_g detected", () => {
  const result = applyAlcoholFallback([item("Apple Cider", 500)]);
  expect(result[0].alcohol_g).toBeGreaterThan(0);
});

// ── Stout / IPA / Craft Beer ───────────────────────────────────────────────

test("Stout 330ml (330g) → alcohol_g ≈ 13.2 (beer ABV)", () => {
  const result = applyAlcoholFallback([item("Stout", 330)]);
  // 330 * 0.04 = 13.2
  expect(result[0].alcohol_g).toBeCloseTo(330 * 0.04, 1);
});

test("IPA 330ml (330g) → alcohol_g detected", () => {
  const result = applyAlcoholFallback([item("IPA", 330)]);
  expect(result[0].alcohol_g).toBeGreaterThan(0);
});

test("craft beer 500ml (500g) → alcohol_g ≈ 20 (beer ABV)", () => {
  const result = applyAlcoholFallback([item("craft beer", 500)]);
  expect(result[0].alcohol_g).toBeCloseTo(500 * 0.04, 1);
});

// ── Sangria ───────────────────────────────────────────────────────────────

test("Sangria 200ml (200g) → alcohol_g ≈ 18", () => {
  const result = applyAlcoholFallback([item("Sangria", 200)]);
  // 200 * 0.09 = 18
  expect(result[0].alcohol_g).toBeCloseTo(200 * 0.09, 1);
});

// ── Glühwein ──────────────────────────────────────────────────────────────

test("Glühwein 200ml (200g) → alcohol_g ≈ 18", () => {
  const result = applyAlcoholFallback([item("Glühwein", 200)]);
  // 200 * 0.09 = 18
  expect(result[0].alcohol_g).toBeCloseTo(200 * 0.09, 1);
});

test("mulled wine 200ml → alcohol_g detected", () => {
  const result = applyAlcoholFallback([item("mulled wine", 200)]);
  expect(result[0].alcohol_g).toBeGreaterThan(0);
});

// ── Federweißer ───────────────────────────────────────────────────────────

test("Federweißer 200ml (200g) → alcohol_g ≈ 12", () => {
  const result = applyAlcoholFallback([item("Federweißer", 200)]);
  // 200 * 0.06 = 12
  expect(result[0].alcohol_g).toBeCloseTo(200 * 0.06, 1);
});

test("Federweisser (ASCII fallback) 200ml → alcohol_g detected", () => {
  const result = applyAlcoholFallback([item("Federweisser", 200)]);
  expect(result[0].alcohol_g).toBeGreaterThan(0);
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

// ── hasAlcoholKeyword: log_influence_entry guard ──────────────────────────

import { hasAlcoholKeyword } from "@/lib/ai/alcoholFallback";

test("hasAlcoholKeyword: 'Bier' returns true", () => {
  expect(hasAlcoholKeyword("Bier")).toBe(true);
});

test("hasAlcoholKeyword: 'ein Glas Wein' returns true", () => {
  expect(hasAlcoholKeyword("ein Glas Wein")).toBe(true);
});

test("hasAlcoholKeyword: 'Vodka Tonic' returns true", () => {
  expect(hasAlcoholKeyword("Vodka Tonic")).toBe(true);
});

test("hasAlcoholKeyword: 'Prosecco' returns true", () => {
  expect(hasAlcoholKeyword("Prosecco")).toBe(true);
});

test("hasAlcoholKeyword: 'Empanada mit Schwein' returns false", () => {
  expect(hasAlcoholKeyword("Empanada mit Schwein")).toBe(false);
});

test("hasAlcoholKeyword: 'Pizza Margherita' returns false", () => {
  expect(hasAlcoholKeyword("Pizza Margherita")).toBe(false);
});

test("hasAlcoholKeyword: 'Hähnchenbrust mit Reis' returns false", () => {
  expect(hasAlcoholKeyword("Hähnchenbrust mit Reis")).toBe(false);
});

test("hasAlcoholKeyword: empty string returns false", () => {
  expect(hasAlcoholKeyword("")).toBe(false);
});

test("hasAlcoholKeyword: 'alkoholfreies Bier' returns false (exempt)", () => {
  expect(hasAlcoholKeyword("alkoholfreies Bier")).toBe(false);
});

test("hasAlcoholKeyword: 'Pasta Bolognese' returns false", () => {
  expect(hasAlcoholKeyword("Pasta Bolognese")).toBe(false);
});

// ── hasAlcoholKeyword: new keywords ───────────────────────────────────────

test("hasAlcoholKeyword: 'Radler' returns true", () => {
  expect(hasAlcoholKeyword("Radler")).toBe(true);
});

test("hasAlcoholKeyword: 'ein Radler bitte' returns true", () => {
  expect(hasAlcoholKeyword("ein Radler bitte")).toBe(true);
});

test("hasAlcoholKeyword: 'Cider' returns true", () => {
  expect(hasAlcoholKeyword("Cider")).toBe(true);
});

test("hasAlcoholKeyword: 'Apple Cider 330ml' returns true", () => {
  expect(hasAlcoholKeyword("Apple Cider 330ml")).toBe(true);
});

test("hasAlcoholKeyword: 'Stout' returns true", () => {
  expect(hasAlcoholKeyword("Stout")).toBe(true);
});

test("hasAlcoholKeyword: 'Guinness Stout' returns true", () => {
  expect(hasAlcoholKeyword("Guinness Stout")).toBe(true);
});

test("hasAlcoholKeyword: 'IPA' returns true", () => {
  expect(hasAlcoholKeyword("IPA")).toBe(true);
});

test("hasAlcoholKeyword: 'craft beer 500ml' returns true", () => {
  expect(hasAlcoholKeyword("craft beer 500ml")).toBe(true);
});

test("hasAlcoholKeyword: 'Sangria' returns true", () => {
  expect(hasAlcoholKeyword("Sangria")).toBe(true);
});

test("hasAlcoholKeyword: 'Glühwein' returns true", () => {
  expect(hasAlcoholKeyword("Glühwein")).toBe(true);
});

test("hasAlcoholKeyword: 'mulled wine' returns true", () => {
  expect(hasAlcoholKeyword("mulled wine")).toBe(true);
});

test("hasAlcoholKeyword: 'Federweißer' returns true", () => {
  expect(hasAlcoholKeyword("Federweißer")).toBe(true);
});

test("hasAlcoholKeyword: 'Federweisser' (ASCII) returns true", () => {
  expect(hasAlcoholKeyword("Federweisser")).toBe(true);
});

test("hasAlcoholKeyword: 'Sake' returns true", () => {
  expect(hasAlcoholKeyword("Sake")).toBe(true);
});

test("hasAlcoholKeyword: 'Sake mit Sushi' returns true", () => {
  expect(hasAlcoholKeyword("Sake mit Sushi")).toBe(true);
});

// ── hasAlcoholKeyword: false-positive guards for new keywords ─────────────

test("hasAlcoholKeyword: 'Apfelsaft' returns false (not cider)", () => {
  expect(hasAlcoholKeyword("Apfelsaft")).toBe(false);
});

test("hasAlcoholKeyword: 'Rindersteak' returns false (no 'stout' substring)", () => {
  expect(hasAlcoholKeyword("Rindersteak")).toBe(false);
});

test("hasAlcoholKeyword: 'Obstsalat' returns false (no sangria)", () => {
  expect(hasAlcoholKeyword("Obstsalat")).toBe(false);
});

test("hasAlcoholKeyword: 'Heiße Schokolade' returns false (not Glühwein)", () => {
  expect(hasAlcoholKeyword("Heiße Schokolade")).toBe(false);
});

test("hasAlcoholKeyword: 'Traubensaft' returns false (not Federweißer)", () => {
  expect(hasAlcoholKeyword("Traubensaft")).toBe(false);
});

// ── log_influence_entry alcohol guard integration ─────────────────────────

import { readFileSync as readFileSyncGuard } from "node:fs";
import { join as joinGuard } from "node:path";

test("confirm-action: hasAlcoholKeyword import is present", () => {
  const src = readFileSyncGuard(joinGuard(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain("hasAlcoholKeyword");
  expect(src).toContain("no_alcohol_keyword");
});

test("confirm-action: alcohol guard fires before DB write in execLogInfluenceEntry", () => {
  const src = readFileSyncGuard(joinGuard(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain('influenceType === "alcohol"');
  expect(src).toContain("rejected: true");
});

test("confirm-action: dual-emission entries (source_meal_token present) bypass the guard", () => {
  const src = readFileSyncGuard(joinGuard(process.cwd(), "app/api/ai/confirm-action/route.ts"), "utf8");
  expect(src).toContain("sourceMealToken");
  expect(src).toContain("!sourceMealToken");
});

test("glevChatPrompt: log_influence_entry alcohol restriction rule present", () => {
  const src = readFileSyncGuard(joinGuard(process.cwd(), "lib/ai/glevChatPrompt.ts"), "utf8");
  expect(src).toContain("ALKOHOL-PFLICHT-EINSCHRÄNKUNG");
  expect(src).toContain("explizit erwähnt hat");
});

// ── Behavioral: toolLogInfluenceEntry guard in glevTools.ts ───────────────
// These tests use executeGlevTool (public) with a mock SupabaseClient.
// The "throwing" mock ensures the DB is never reached when the guard fires.
// The "permissive" mock allows the call to reach DB but returns a mock error,
// letting us confirm the guard did NOT fire for legitimate inputs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { executeGlevTool } from "@/lib/ai/glevTools";

function makeThrowingMockSb(): SupabaseClient {
  return {
    from: () => {
      throw new Error("[test] DB must not be called — guard should block this request first");
    },
  } as unknown as SupabaseClient;
}

function makePermissiveMockSb(): SupabaseClient {
  const terminal = Promise.resolve({ data: null, error: { message: "mock-db-error" } });
  const singleFn = () => terminal;
  const selectFn = () => ({ single: singleFn });
  const insertFn = () => ({ select: selectFn });
  return { from: () => ({ insert: insertFn }) } as unknown as SupabaseClient;
}

const ALCOHOL_GUARD_MSG = "Kein Alkohol in dieser Mahlzeit erkannt";

test("behavioral: log_influence_entry(alcohol) with 'Empanadas' details → blocked before any DB call", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "alcohol", details: "Empanadas mit Käse", logged_at: "2026-06-07T12:00:00Z" }),
    makeThrowingMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  expect(result).toHaveProperty("error");
  expect(String(result.error)).toContain(ALCOHOL_GUARD_MSG);
});

test("behavioral: log_influence_entry(alcohol) with 'Pizza Margherita' → blocked before any DB call", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "alcohol", notes: "Pizza Margherita 300g", logged_at: "2026-06-07T12:00:00Z" }),
    makeThrowingMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  expect(result).toHaveProperty("error");
  expect(String(result.error)).toContain(ALCOHOL_GUARD_MSG);
});

test("behavioral: log_influence_entry(alcohol) with 'Hähnchenbrust' → blocked before any DB call", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "alcohol", details: "Hähnchenbrust mit Reis", amount: "200g", logged_at: "2026-06-07T12:00:00Z" }),
    makeThrowingMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  expect(result).toHaveProperty("error");
  expect(String(result.error)).toContain(ALCOHOL_GUARD_MSG);
});

test("behavioral: log_influence_entry(alcohol) with 'Bier 330ml' → guard passes, reaches DB", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "alcohol", details: "Bier 330ml", logged_at: "2026-06-07T12:00:00Z" }),
    makePermissiveMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  // Guard must NOT have fired — error is from DB mock, not from the keyword check
  if (result.error) {
    expect(String(result.error)).not.toContain(ALCOHOL_GUARD_MSG);
  } else {
    // pending_action created — even better, guard definitely didn't fire
    expect(result).toHaveProperty("pending_action");
  }
});

test("behavioral: log_influence_entry(alcohol) with 'Rotwein 200ml' → guard passes, reaches DB", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "alcohol", amount: "Rotwein 200ml", logged_at: "2026-06-07T12:00:00Z" }),
    makePermissiveMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  if (result.error) {
    expect(String(result.error)).not.toContain(ALCOHOL_GUARD_MSG);
  } else {
    expect(result).toHaveProperty("pending_action");
  }
});

test("behavioral: log_influence_entry(stress) — non-alcohol type, no keyword check, reaches DB", async () => {
  const result = await executeGlevTool(
    "log_influence_entry",
    JSON.stringify({ influence_type: "stress", details: "Prüfungsstress", logged_at: "2026-06-07T12:00:00Z" }),
    makePermissiveMockSb(),
    "user-test-123",
    "Europe/Berlin",
  ) as Record<string, unknown>;
  // Guard must not have fired — no ALCOHOL_GUARD_MSG in error
  if (result.error) {
    expect(String(result.error)).not.toContain(ALCOHOL_GUARD_MSG);
  }
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

test("glevTools: primary alcohol guard is inside toolLogInfluenceEntry, before createPendingAction", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/glevTools.ts"), "utf8");
  // Guard must be present in glevTools.ts (primary layer — blocks chip creation)
  expect(src).toContain("hasAlcoholKeyword");
  expect(src).toContain("Kein Alkohol in dieser Mahlzeit erkannt");
  // Guard must reference the guard message before createPendingAction to prove ordering
  const guardIdx = src.indexOf("Kein Alkohol in dieser Mahlzeit erkannt");
  const createIdx = src.lastIndexOf("createPendingAction(sb, userId, \"log_influence_entry\"");
  expect(guardIdx).toBeGreaterThan(0);
  expect(createIdx).toBeGreaterThan(0);
  expect(guardIdx).toBeLessThan(createIdx);
});

test("GlevAIChatSheet: duplicate bottom-bar Engine button removed", () => {
  const src = readFileSync(join(process.cwd(), "components/GlevAIChatSheet.tsx"), "utf8");
  // The redundant button rendered `label — open_engine_chip` text with `pendingMealNavQueue`
  expect(src).not.toContain("pendingMealNavQueue[0].label || t.meal_fallback} — {t.open_engine_chip}");
  // The primary mini-chip button (PendingActionWidget → open_engine) must still exist
  expect(src).toContain("open_engine_chip");
  expect(src).toContain("PendingActionWidget");
});
