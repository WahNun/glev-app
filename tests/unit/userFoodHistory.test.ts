// Unit coverage for `lib/nutrition/userFoodHistory.ts` — the per-user
// food memory layer (Phase B) that sits in front of OFF/USDA/GPT.
//
// Locks in the T1D-safety-critical invariants:
//   1. normalizeFoodName: lowercase, trim, collapse spaces, strip
//      trailing 'en'/'n'/'s' plural markers when long enough.
//   2. lookupUserFoodHistory: silently drops all-zero rows and rows
//      with non-positive typical_grams (otherwise the dose engine
//      would receive silent zeros via the short-circuit path).
//   3. recordItemsToHistory: refuses to learn from source='unknown',
//      from items with 0 grams, and from impossible >105 g/100g
//      densities — these are exactly the patterns that, if cached,
//      would poison the next parse.
//   4. user_confirmed is sticky: a passive 'history' upsert against
//      an existing user_confirmed row keeps every value field and
//      only bumps occurrences/last_seen_at.
//   5. EMA blending: weighted running average with denominator
//      capped at n=20 so the cache stays responsive to behavioural
//      changes.

import { test, expect } from "@playwright/test";

import {
  normalizeFoodName,
  lookupUserFoodHistory,
  recordItemsToHistory,
  type UserFoodHistoryRow,
} from "@/lib/nutrition/userFoodHistory";
import type { NutritionItem } from "@/lib/nutrition/types";

// ---------------------------------------------------------------------------
// In-memory Supabase double. Only the verbs the module actually uses:
// .from(table).select(...).eq(...).in(...) → { data, error }
// .from(table).upsert(rows, opts)           → { data, error }
// ---------------------------------------------------------------------------

interface QueryFilters {
  user_id?: string;
  normalized_names?: string[];
}

interface FakeSb {
  rows: UserFoodHistoryRow[];
  upserts: Array<Record<string, unknown>[]>;
  from: (t: string) => FakeQuery;
  readErr?: unknown;
}
interface FakeQuery {
  select: (cols: string) => FakeQuery;
  eq: (k: string, v: unknown) => FakeQuery;
  in: (k: string, vals: unknown[]) => Promise<{ data: UserFoodHistoryRow[]; error: unknown }>;
  upsert: (rows: Record<string, unknown>[], opts?: unknown) => Promise<{ error: unknown }>;
}

function makeFakeSb(initial: UserFoodHistoryRow[] = []): FakeSb {
  const sb: FakeSb = {
    rows: [...initial],
    upserts: [],
    from(_t: string) {
      const filters: QueryFilters = {};
      const q: FakeQuery = {
        select(_cols: string) { return q; },
        eq(k, v) {
          if (k === "user_id") filters.user_id = String(v);
          return q;
        },
        async in(k, vals) {
          if (sb.readErr) return { data: [], error: sb.readErr };
          if (k === "normalized_name") filters.normalized_names = vals as string[];
          const data = sb.rows.filter((r) =>
            (!filters.user_id || r.user_id === filters.user_id) &&
            (!filters.normalized_names || filters.normalized_names.includes(r.normalized_name))
          );
          return { data, error: null };
        },
        async upsert(rows, _opts) {
          sb.upserts.push(rows);
          return { error: null };
        },
      };
      return q;
    },
  };
  return sb;
}

function mkRow(over: Partial<UserFoodHistoryRow>): UserFoodHistoryRow {
  return {
    id:               over.id ?? "row_1",
    user_id:          over.user_id ?? "u1",
    normalized_name:  over.normalized_name ?? "banane",
    display_name:     over.display_name ?? "Banane",
    typical_grams:    over.typical_grams ?? 120,
    carbs_per_100g:   over.carbs_per_100g ?? 23,
    protein_per_100g: over.protein_per_100g ?? 1.1,
    fat_per_100g:     over.fat_per_100g ?? 0.3,
    fiber_per_100g:   over.fiber_per_100g ?? 2.6,
    source:           over.source ?? "history",
    occurrences:      over.occurrences ?? 1,
    created_at:       "2026-01-01T00:00:00Z",
    updated_at:       "2026-01-01T00:00:00Z",
    last_seen_at:     "2026-01-01T00:00:00Z",
  };
}

function mkItem(over: Partial<NutritionItem> & { name: string }): NutritionItem {
  return {
    name:    over.name,
    grams:   over.grams ?? 120,
    carbs:   over.carbs ?? 28,
    protein: over.protein ?? 1.3,
    fat:     over.fat ?? 0.4,
    fiber:   over.fiber ?? 3.1,
    source:  over.source ?? "open_food_facts",
  };
}

// ---------------------------------------------------------------------------
// 1. Normalisation
// ---------------------------------------------------------------------------

test("normalizeFoodName lowercases, trims, collapses spaces", () => {
  expect(normalizeFoodName("  HaFer  Flocken  ")).toBe("hafer flock"); // strips trailing 'en'
  expect(normalizeFoodName("Müsli")).toBe("müsli"); // diacritics preserved on purpose
});

test("normalizeFoodName strips trailing plural marker when long enough", () => {
  expect(normalizeFoodName("Bananen")).toBe("banan"); // 'en' off
  expect(normalizeFoodName("Apfel")).toBe("apfel");   // no marker → unchanged
  expect(normalizeFoodName("Reis")).toBe("rei");      // 's' off (len ≥ 4)
  expect(normalizeFoodName("Ei")).toBe("ei");         // too short, no strip
  expect(normalizeFoodName("")).toBe("");
  expect(normalizeFoodName("   ")).toBe("");
});

test("normalizeFoodName: 'Apfel' and 'Apfels' map to same key", () => {
  // Genitive 's' (≥4 chars) strips; bare form is already short of the rule.
  expect(normalizeFoodName("Apfels")).toBe("apfel");
  expect(normalizeFoodName("Apfel")).toBe("apfel");
});

// ---------------------------------------------------------------------------
// 2. lookupUserFoodHistory safety guards
// ---------------------------------------------------------------------------

test("lookup: all-zero rows are dropped (silent-zero guard)", async () => {
  // 'Apfels' → strip trailing 's' (len 6 ≥ 4) → 'apfel'
  const sb = makeFakeSb([
    mkRow({ normalized_name: "apfel",
            carbs_per_100g: 0, protein_per_100g: 0, fat_per_100g: 0 }),
  ]);
  const hits = await lookupUserFoodHistory(sb as never, "u1", ["Apfels"]);
  expect(hits.size).toBe(0);
});

test("lookup: rows with non-positive typical_grams are dropped", async () => {
  const sb = makeFakeSb([
    mkRow({ normalized_name: "apfel", typical_grams: 0 }),
  ]);
  const hits = await lookupUserFoodHistory(sb as never, "u1", ["Apfels"]);
  expect(hits.size).toBe(0);
});

test("lookup: returns per100 + typicalGrams for valid row, keyed by normalized name", async () => {
  const sb = makeFakeSb([
    mkRow({ normalized_name: "apfel", typical_grams: 130, carbs_per_100g: 24 }),
  ]);
  const hits = await lookupUserFoodHistory(sb as never, "u1", ["Apfel"]);
  expect(hits.size).toBe(1);
  const hit = hits.get("apfel")!;
  expect(hit.typicalGrams).toBe(130);
  expect(hit.per100.carbs_g).toBe(24);
});

test("lookup: DB error is swallowed (returns empty map) so pipeline falls through", async () => {
  const sb = makeFakeSb();
  sb.readErr = { message: "relation does not exist" };
  const hits = await lookupUserFoodHistory(sb as never, "u1", ["Banane"]);
  expect(hits.size).toBe(0);
});

test("lookup: short-circuits on empty inputs", async () => {
  const sb = makeFakeSb([mkRow({})]);
  expect((await lookupUserFoodHistory(sb as never, "",   ["x"])).size).toBe(0);
  expect((await lookupUserFoodHistory(sb as never, "u1", [])).size).toBe(0);
});

// ---------------------------------------------------------------------------
// 3. recordItemsToHistory write-side guards
// ---------------------------------------------------------------------------

test("record: refuses to learn from source='unknown' items", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Mystery", source: "unknown" })],
    { source: "history" },
  );
  expect(sb.upserts.length).toBe(0);
});

test("record: skips items with zero grams or all-zero macros", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [
      mkItem({ name: "Zero grams", grams: 0 }),
      mkItem({ name: "Zero macros", carbs: 0, protein: 0, fat: 0 }),
    ],
    { source: "history" },
  );
  expect(sb.upserts.length).toBe(0);
});

test("record: rejects impossible >105 g/100g densities (typo'd grams)", async () => {
  // 200g of carbs declared for a 50g portion → 400g/100g (impossible)
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Bad", grams: 50, carbs: 200, protein: 0, fat: 0 })],
    { source: "history" },
  );
  expect(sb.upserts.length).toBe(0);
});

// The pairs below use 'Apfel' (singular) and 'Apfels' (genitive) — both
// normalise to "apfel" (the 's' strip kicks in at len ≥ 4, the singular
// has no trailing s/n/en to strip), so the existing-row vs. incoming-
// item lookup actually matches in our fake DB.

test("record: brand-new row inserts with occurrences=1 and computed per-100g", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Apfel", grams: 120, carbs: 24, protein: 1.2, fat: 0.3, fiber: 3 })],
    { source: "history" },
  );
  expect(sb.upserts.length).toBe(1);
  const row = sb.upserts[0][0];
  expect(row.normalized_name).toBe("apfel");
  expect(row.occurrences).toBe(1);
  expect(row.source).toBe("history");
  expect(row.typical_grams).toBe(120);
  // 24g / 120g * 100 = 20
  expect(row.carbs_per_100g).toBe(20);
});

test("record: user_confirmed is sticky — passive history write preserves values", async () => {
  const sb = makeFakeSb([
    mkRow({
      normalized_name: "apfel",
      source: "user_confirmed",
      typical_grams: 100,
      carbs_per_100g: 22,
      protein_per_100g: 1,
      fat_per_100g: 0.2,
      fiber_per_100g: 2,
      occurrences: 5,
    }),
  ]);
  await recordItemsToHistory(
    sb as never, "u1",
    // Passive write tries to overwrite with very different values.
    [mkItem({ name: "Apfel", grams: 200, carbs: 60, protein: 5, fat: 3, fiber: 4 })],
    { source: "history" },
  );
  const row = sb.upserts[0][0];
  // Values preserved …
  expect(row.typical_grams).toBe(100);
  expect(row.carbs_per_100g).toBe(22);
  expect(row.protein_per_100g).toBe(1);
  expect(row.fat_per_100g).toBe(0.2);
  // … source flag stays user_confirmed …
  expect(row.source).toBe("user_confirmed");
  // … and occurrence counter bumps.
  expect(row.occurrences).toBe(6);
});

test("record: user_confirmed incoming overwrites + flips source flag", async () => {
  const sb = makeFakeSb([
    mkRow({
      normalized_name: "apfel",
      source: "history",
      typical_grams: 100,
      carbs_per_100g: 22,
      occurrences: 3,
    }),
  ]);
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Apfel", grams: 200, carbs: 50, protein: 2, fat: 1, fiber: 4 })],
    { source: "user_confirmed" },
  );
  const row = sb.upserts[0][0];
  expect(row.source).toBe("user_confirmed");
  expect(row.typical_grams).toBe(200);
  // 50g / 200g * 100 = 25
  expect(row.carbs_per_100g).toBe(25);
  expect(row.occurrences).toBe(4);
});

test("record: repeat upserts always carry a defined display_name (NOT NULL guard)", async () => {
  // Regression guard: the table's display_name column is NOT NULL.
  // Both the sticky and blend branches read prev.display_name to
  // re-emit it in the upsert payload, so the select column list MUST
  // include display_name. If it ever gets dropped, every existing-row
  // write would silently fail (catch {}) and the cache would stop
  // learning. This test would catch that immediately.
  const sb = makeFakeSb([
    mkRow({
      normalized_name: "apfel",
      display_name: "Apfel (golden)",
      source: "user_confirmed",
      occurrences: 4,
    }),
    mkRow({
      id: "row_2",
      normalized_name: "hafer flock",
      display_name: "Haferflocken zart",
      source: "history",
      occurrences: 7,
    }),
  ]);
  await recordItemsToHistory(
    sb as never, "u1",
    [
      mkItem({ name: "Apfel",          grams: 150, carbs: 30, protein: 0.5, fat: 0.2, fiber: 3 }),
      mkItem({ name: "Haferflocken",   grams: 60,  carbs: 36, protein: 8,   fat: 4,   fiber: 6 }),
    ],
    { source: "history" },
  );
  expect(sb.upserts.length).toBe(1);
  for (const row of sb.upserts[0]) {
    expect(typeof row.display_name).toBe("string");
    expect((row.display_name as string).length).toBeGreaterThan(0);
  }
});

test("record: history + history blends via weighted EMA, denominator capped at 20", async () => {
  // prev had 50g/100g carbs after 100 samples. New sample is 0g/100g.
  // n = min(occurrences, 20) = 20
  // blended = (50 * 20 + 0) / 21 ≈ 47.62
  const sb = makeFakeSb([
    mkRow({
      normalized_name: "apfel",
      source: "history",
      typical_grams: 100,
      carbs_per_100g: 50,
      protein_per_100g: 0,
      fat_per_100g: 0,
      occurrences: 100, // way above cap
    }),
  ]);
  await recordItemsToHistory(
    sb as never, "u1",
    // Pure-protein 100g item → 0 carbs / 100g, 10 protein / 100g
    [mkItem({ name: "Apfel", grams: 100, carbs: 0, protein: 10, fat: 0, fiber: 0 })],
    { source: "history" },
  );
  const row = sb.upserts[0][0];
  // Cap at 20 means the new sample carries 1/21 weight, not 1/101.
  // (50 * 20 + 0) / 21 = 47.619...  → round2 → 47.62
  expect(row.carbs_per_100g).toBe(47.62);
  // (0 * 20 + 10) / 21 = 0.476... → 0.48
  expect(row.protein_per_100g).toBe(0.48);
  expect(row.occurrences).toBe(101);
});
