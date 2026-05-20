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
//   6. parseFoodName: size modifier extraction, quantity word parsing,
//      combined cases ("zwei große Bananen").
//   7. backfillFoodHistory: outlier filtering at 3× median, early-
//      return when table already has data.

import { test, expect } from "@playwright/test";

import {
  normalizeFoodName,
  lookupUserFoodHistory,
  recordItemsToHistory,
  parseFoodName,
  backfillFoodHistory,
  type UserFoodHistoryRow,
} from "@/lib/nutrition/userFoodHistory";
import type { NutritionItem } from "@/lib/nutrition/types";

// ---------------------------------------------------------------------------
// In-memory Supabase double. Only the verbs the module actually uses:
// .from(table).select(...).eq(...).in(...)          → { data, error }
// .from(table).select(..., {count}).eq(...)         → { count, error }
// .from(table).not(...)                             → fluent
// .from(table).upsert(rows, opts)                   → { data, error }
// .from(table).insert(rows)                         → { error }
// .from(table).update(patch).eq(...).eq(...)        → { error }
// ---------------------------------------------------------------------------

interface QueryFilters {
  user_id?: string;
  normalized_names?: string[];
  headOnly?: boolean;
}

interface FakeSb {
  rows: UserFoodHistoryRow[];
  meals: Array<{ parsed_json: unknown[] }>;
  inserts: Array<Record<string, unknown>[]>;
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
  from: (t: string) => FakeQuery;
  readErr?: unknown;
}

interface FakeQuery {
  select: (cols: string, opts?: Record<string, unknown>) => FakeQuery;
  eq: (k: string, v: unknown) => FakeQuery;
  in: (k: string, vals: unknown[]) => Promise<{ data: UserFoodHistoryRow[]; error: unknown }>;
  not: (k: string, op: string, v: unknown) => FakeQuery;
  insert: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>;
  update: (patch: Record<string, unknown>) => FakeQuery;
  upsert: (rows: Record<string, unknown>[], opts?: unknown) => Promise<{ error: unknown }>;
  // resolves for select with count/head
  _resolveCount?: () => Promise<{ count: number; error: null }>;
  _resolveMeals?: () => Promise<{ data: Array<{ parsed_json: unknown[] }>; error: null }>;
}

function makeFakeSb(
  initial: UserFoodHistoryRow[] = [],
  meals: Array<{ parsed_json: unknown[] }> = [],
): FakeSb {
  let pendingUpdateId: string | null = null;
  const sb: FakeSb = {
    rows: [...initial],
    meals: [...meals],
    inserts: [],
    updates: [],
    from(table: string) {
      const filters: QueryFilters = {};
      let isHead = false;
      let isUpdate = false;
      let updatePatch: Record<string, unknown> = {};

      const q: FakeQuery = {
        select(_cols: string, opts?: Record<string, unknown>) {
          if (opts?.head) isHead = true;
          return q;
        },
        eq(k, v) {
          if (k === "user_id") filters.user_id = String(v);
          if (k === "id") pendingUpdateId = String(v);
          return q;
        },
        in(k, vals) {
          if (sb.readErr) return Promise.resolve({ data: [], error: sb.readErr });
          if (k === "normalized_name") filters.normalized_names = vals as string[];
          // Head/count path (backfill guard)
          if (isHead) {
            const count = sb.rows.filter((r) =>
              !filters.user_id || r.user_id === filters.user_id,
            ).length;
            return Promise.resolve({ data: [], error: null, count } as never);
          }
          const data = sb.rows.filter((r) =>
            (!filters.user_id || r.user_id === filters.user_id) &&
            (!filters.normalized_names || filters.normalized_names.includes(r.normalized_name)),
          );
          return Promise.resolve({ data, error: null });
        },
        not(_k, _op, _v) { return q; },
        insert(rows) {
          sb.inserts.push(rows);
          return Promise.resolve({ error: null });
        },
        update(patch) {
          isUpdate = true;
          updatePatch = patch;
          return q;
        },
        async upsert(rows, _opts) {
          sb.inserts.push(rows);
          return { error: null };
        },
        // The eq chain after update resolves the update
        async _resolveCount() {
          const count = sb.rows.filter((r) =>
            !filters.user_id || r.user_id === filters.user_id,
          ).length;
          return { count, error: null };
        },
        async _resolveMeals() {
          return { data: sb.meals, error: null };
        },
      };

      // Proxy: after .eq() is called following .update(), capture the update
      const origEq = q.eq.bind(q);
      q.eq = (k, v) => {
        origEq(k, v);
        if (isUpdate && k === "user_id") {
          const id = pendingUpdateId;
          if (id) sb.updates.push({ id, patch: updatePatch });
          pendingUpdateId = null;
          isUpdate = false;
        }
        return q;
      };

      // For meals table — return rows from sb.meals
      if (table === "meals") {
        const mq: FakeQuery = {
          select(_c, _o) { return mq; },
          eq(_k, _v) { return mq; },
          in(_k, _v) { return Promise.resolve({ data: sb.meals as never, error: null }); },
          not(_k, _o, _v) { return mq; },
          insert(rows) { sb.inserts.push(rows); return Promise.resolve({ error: null }); },
          update(_p) { return mq; },
          upsert(rows, _o) { sb.inserts.push(rows); return Promise.resolve({ error: null }); },
        };
        return mq;
      }

      return q;
    },
  };
  return sb;
}

// Override: for the count/head path used by backfillFoodHistory
function makeBackfillSb(
  rowCount: number,
  meals: Array<{ parsed_json: unknown[] }>,
): { sb: FakeSb; inserts: FakeSb["inserts"]; updates: FakeSb["updates"] } {
  const sb = makeFakeSb(
    Array.from({ length: rowCount }, (_, i) => mkRow({ id: `row_${i}`, user_id: "u1" })),
    meals,
  );
  // Intercept the count query
  const origFrom = sb.from.bind(sb);
  sb.from = (table: string) => {
    const q = origFrom(table);
    // Override `in` on the food-history table to support count/head
    const origIn = q.in.bind(q);
    q.in = async (k, vals) => {
      const r = await origIn(k, vals);
      return r;
    };
    // For head-only select on user_food_history, return count
    const origSelect = q.select.bind(q);
    q.select = (cols: string, opts?: Record<string, unknown>) => {
      if (opts?.head && table === "user_food_history") {
        // Monkey-patch .eq to capture user_id and resolve count
        const qHead = origSelect(cols, opts);
        const origEq2 = qHead.eq.bind(qHead);
        qHead.eq = (k: string, v: unknown) => {
          origEq2(k, v);
          // After the eq() call that sets user_id, the next chain
          // is normally nothing. We patch `in` to resolve as count.
          qHead.in = async (_k2: string, _v2: unknown[]) => {
            const count2 = sb.rows.filter((r) => r.user_id === String(v)).length;
            return { data: [] as never, error: null, count: count2 } as never;
          };
          return qHead;
        };
        return qHead;
      }
      return origSelect(cols, opts);
    };
    return q;
  };
  return { sb, inserts: sb.inserts, updates: sb.updates };
}

function mkRow(over: Partial<UserFoodHistoryRow>): UserFoodHistoryRow {
  return {
    id:               over.id ?? "row_1",
    user_id:          over.user_id ?? "u1",
    normalized_name:  over.normalized_name ?? "banan",
    display_name:     over.display_name ?? "Banane",
    size_modifier:    over.size_modifier ?? null,
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
  expect(normalizeFoodName("Apfels")).toBe("apfel");
  expect(normalizeFoodName("Apfel")).toBe("apfel");
});

// ---------------------------------------------------------------------------
// 2. parseFoodName — Phase B addition
// ---------------------------------------------------------------------------

test("parseFoodName: plain food name returns unmodified", () => {
  const r = parseFoodName("Banane");
  expect(r.foodName).toBe("banan");
  expect(r.sizeModifier).toBeNull();
  expect(r.quantity).toBe(1);
});

test("parseFoodName: leading size adjective extracted as sizeModifier", () => {
  const groß = parseFoodName("große Banane");
  expect(groß.sizeModifier).toBe("groß");
  expect(groß.foodName).toBe("banan");
  expect(groß.quantity).toBe(1);

  const klein = parseFoodName("kleine Banane");
  expect(klein.sizeModifier).toBe("klein");
  expect(klein.foodName).toBe("banan");
});

test("parseFoodName: 'halb' treated as size modifier not quantity", () => {
  const r = parseFoodName("halbe Banane");
  expect(r.sizeModifier).toBe("halb");
  expect(r.quantity).toBe(1);
  expect(r.foodName).toBe("banan");
});

test("parseFoodName: quantity word prefix multiplies quantity, no sizeModifier", () => {
  const r = parseFoodName("zwei Bananen");
  expect(r.quantity).toBe(2);
  expect(r.sizeModifier).toBeNull();
  expect(r.foodName).toBe("banan");
});

test("parseFoodName: numeric prefix parsed as quantity", () => {
  const r = parseFoodName("3 Eier");
  expect(r.quantity).toBe(3);
  expect(r.sizeModifier).toBeNull();
  expect(r.foodName).toBe("ei");
});

test("parseFoodName: combined 'zwei große Bananen'", () => {
  const r = parseFoodName("zwei große Bananen");
  expect(r.quantity).toBe(2);
  expect(r.sizeModifier).toBe("groß");
  expect(r.foodName).toBe("banan");
});

test("parseFoodName: 'doppelt' size modifier", () => {
  const r = parseFoodName("doppelte Portion Haferflocken");
  expect(r.sizeModifier).toBe("doppelt");
  expect(r.foodName).toContain("portion");
});

test("parseFoodName: empty string", () => {
  const r = parseFoodName("");
  expect(r.foodName).toBe("");
  expect(r.sizeModifier).toBeNull();
  expect(r.quantity).toBe(1);
});

// ---------------------------------------------------------------------------
// 3. lookupUserFoodHistory safety guards
// ---------------------------------------------------------------------------

test("lookup: all-zero rows are dropped (silent-zero guard)", async () => {
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
// 4. recordItemsToHistory write-side guards
// ---------------------------------------------------------------------------

test("record: refuses to learn from source='unknown' items", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Mystery", source: "unknown" })],
    { source: "history" },
  );
  expect(sb.inserts.length).toBe(0);
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
  expect(sb.inserts.length).toBe(0);
});

test("record: rejects impossible >105 g/100g densities (typo'd grams)", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Bad", grams: 50, carbs: 200, protein: 0, fat: 0 })],
    { source: "history" },
  );
  expect(sb.inserts.length).toBe(0);
});

test("record: brand-new row inserts with occurrences=1 and computed per-100g", async () => {
  const sb = makeFakeSb();
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Apfel", grams: 120, carbs: 24, protein: 1.2, fat: 0.3, fiber: 3 })],
    { source: "history" },
  );
  expect(sb.inserts.length).toBe(1);
  const row = sb.inserts[0][0];
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
    [mkItem({ name: "Apfel", grams: 200, carbs: 60, protein: 5, fat: 3, fiber: 4 })],
    { source: "history" },
  );
  // Should have issued an update (not an insert of a new row)
  expect(sb.updates.length).toBe(1);
  const patch = sb.updates[0].patch;
  expect(patch.typical_grams).toBe(100);
  expect(patch.carbs_per_100g).toBe(22);
  expect(patch.source).toBe("user_confirmed");
  expect(patch.occurrences).toBe(6);
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
  expect(sb.updates.length).toBe(1);
  const patch = sb.updates[0].patch;
  expect(patch.source).toBe("user_confirmed");
  expect(patch.typical_grams).toBe(200);
  expect(patch.carbs_per_100g).toBe(25); // 50/200*100
  expect(patch.occurrences).toBe(4);
});

test("record: repeat upserts always carry a defined display_name (NOT NULL guard)", async () => {
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
      mkItem({ name: "Apfel",        grams: 150, carbs: 30, protein: 0.5, fat: 0.2, fiber: 3 }),
      mkItem({ name: "Haferflocken", grams: 60,  carbs: 36, protein: 8,   fat: 4,   fiber: 6 }),
    ],
    { source: "history" },
  );
  for (const upd of sb.updates) {
    expect(typeof upd.patch.display_name).toBe("string");
    expect((upd.patch.display_name as string).length).toBeGreaterThan(0);
  }
});

test("record: history + history blends via weighted EMA, denominator capped at 20", async () => {
  const sb = makeFakeSb([
    mkRow({
      normalized_name: "apfel",
      source: "history",
      typical_grams: 100,
      carbs_per_100g: 50,
      protein_per_100g: 0,
      fat_per_100g: 0,
      occurrences: 100,
    }),
  ]);
  await recordItemsToHistory(
    sb as never, "u1",
    [mkItem({ name: "Apfel", grams: 100, carbs: 0, protein: 10, fat: 0, fiber: 0 })],
    { source: "history" },
  );
  expect(sb.updates.length).toBe(1);
  const patch = sb.updates[0].patch;
  // n = min(100, 20) = 20 → blended = (50*20 + 0) / 21 ≈ 47.62
  expect(patch.carbs_per_100g).toBe(47.62);
  // protein: (0*20 + 10) / 21 ≈ 0.48
  expect(patch.protein_per_100g).toBe(0.48);
  expect(patch.occurrences).toBe(101);
});

// ---------------------------------------------------------------------------
// 5. backfillFoodHistory — Phase B addition (end-to-end with real DB fake)
// ---------------------------------------------------------------------------

/**
 * Minimal thenable fake for the Supabase client sufficient to drive
 * backfillFoodHistory (which uses the postgREST builder pattern where
 * every terminal call is awaitable via a `then` handler).
 *
 * State machine:
 *  - tracks table, head flag, filters, operation type
 *  - `then(resolve, reject)` fires when the caller awaits the builder
 *  - captures inserts for assertion
 */
function makeBackfillFakeSb(opts: {
  historyRowCount: number;
  meals: Array<{ parsed_json: unknown[] }>;
}) {
  const inserts: Array<Record<string, unknown>[]> = [];

  function mkBuilder(table: string): Record<string, unknown> {
    let isHead = false;
    let isInsert = false;
    let insertPayload: Record<string, unknown>[] = [];
    let isUpdate = false;
    let updatePayload: Record<string, unknown> = {};
    let op: "count" | "meals" | "historyRead" | "insert" | "update" | "noop" = "noop";

    const resolve = (value: unknown) => value;
    void resolve;

    function makeResult(): Promise<unknown> {
      if (op === "count") {
        return Promise.resolve({ count: opts.historyRowCount, error: null });
      }
      if (op === "meals") {
        return Promise.resolve({ data: opts.meals, error: null });
      }
      if (op === "historyRead") {
        return Promise.resolve({ data: [] as UserFoodHistoryRow[], error: null });
      }
      if (op === "insert") {
        inserts.push(insertPayload);
        return Promise.resolve({ error: null });
      }
      if (op === "update") {
        void updatePayload;
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    // Every builder method returns a thenable proxy of itself
    const builder: Record<string, unknown> = {
      select(cols: string, selectOpts?: Record<string, unknown>) {
        void cols;
        if (selectOpts?.head && table === "user_food_history") {
          isHead = true;
          op = "count";
        } else if (table === "meals") {
          op = "meals";
        } else {
          op = "historyRead";
        }
        void isHead;
        return builder;
      },
      eq(_k: string, _v: unknown) { return builder; },
      in(_k: string, _v: unknown[]) { return builder; },
      not(_k: string, _op: string, _v: unknown) { return builder; },
      insert(rows: Record<string, unknown>[]) {
        isInsert = true;
        insertPayload = rows;
        op = "insert";
        void isInsert;
        return makeResult();
      },
      update(patch: Record<string, unknown>) {
        isUpdate = true;
        updatePayload = patch;
        op = "update";
        void isUpdate;
        return builder;
      },
      upsert(rows: Record<string, unknown>[]) {
        inserts.push(rows);
        return Promise.resolve({ error: null });
      },
      // PromiseLike — called when this builder is directly awaited
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return makeResult().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    inserts,
    from(table: string) { return mkBuilder(table); },
  };
}

test("backfillFoodHistory: no-op (returns 0) when table already has rows for user", async () => {
  const sb = makeBackfillFakeSb({ historyRowCount: 3, meals: [] });
  const seeded = await backfillFoodHistory(sb as never, "u1");
  expect(seeded).toBe(0);
  expect(sb.inserts.length).toBe(0);
});

test("backfillFoodHistory: outlier above 3× median is excluded; valid row is inserted", async () => {
  // [100g, 110g, 1000g] → median=110, threshold=330 → 1000g excluded.
  // Avg of valid (100+110)/2 = 105g → exactly one insert row for 'Banane'.
  const meals = [
    { parsed_json: [{ name: "Banane", grams: 100, carbs: 23, protein: 1, fat: 0.3, fiber: 2.5, source: "open_food_facts" }] },
    { parsed_json: [{ name: "Banane", grams: 110, carbs: 25, protein: 1.1, fat: 0.3, fiber: 2.6, source: "open_food_facts" }] },
    { parsed_json: [{ name: "Banane", grams: 1000, carbs: 230, protein: 11, fat: 3, fiber: 25, source: "open_food_facts" }] },
  ];
  const sb = makeBackfillFakeSb({ historyRowCount: 0, meals });
  const seeded = await backfillFoodHistory(sb as never, "u1");

  // One food group → one representative item inserted
  expect(seeded).toBe(1);
  // At least one insert batch was sent to the DB
  expect(sb.inserts.length).toBeGreaterThan(0);

  // The inserted typical_grams should be the average of [100, 110] = 105g,
  // NOT 1000g (which was above the 3× median threshold of 330).
  const allInserted = sb.inserts.flatMap((batch) => batch);
  const bananaRow = allInserted.find(
    (r) => typeof r.normalized_name === "string" && r.normalized_name.includes("banan"),
  );
  expect(bananaRow).toBeDefined();
  // Avg grams = 105, must be < 200 (i.e. outlier excluded)
  expect(Number(bananaRow!.typical_grams)).toBeLessThan(200);
  expect(Number(bananaRow!.typical_grams)).toBeGreaterThan(90);
});

test("backfillFoodHistory: items with source=unknown are silently skipped", async () => {
  const meals = [
    {
      parsed_json: [
        { name: "Mystery", grams: 100, carbs: 20, protein: 5, fat: 2, fiber: 1, source: "unknown" },
        { name: "Banane",  grams: 120, carbs: 28, protein: 1, fat: 0.3, fiber: 2.5, source: "open_food_facts" },
      ],
    },
  ];
  const sb = makeBackfillFakeSb({ historyRowCount: 0, meals });
  const seeded = await backfillFoodHistory(sb as never, "u1");

  // Only Banane survives; Mystery (source=unknown) must be absent
  expect(seeded).toBe(1);
  const allInserted = sb.inserts.flatMap((batch) => batch);
  const mysteryRow = allInserted.find(
    (r) => typeof r.normalized_name === "string" && r.normalized_name.includes("mystery"),
  );
  expect(mysteryRow).toBeUndefined();
});

test("backfillFoodHistory: multiple food groups each produce their own insert row", async () => {
  const meals = [
    { parsed_json: [
      { name: "Haferflocken", grams: 60,  carbs: 36, protein: 8, fat: 4, fiber: 6, source: "open_food_facts" },
      { name: "Milch",        grams: 200, carbs: 10, protein: 6, fat: 3, fiber: 0, source: "open_food_facts" },
    ] },
    { parsed_json: [
      { name: "Haferflocken", grams: 80,  carbs: 48, protein: 11, fat: 5, fiber: 8, source: "open_food_facts" },
    ] },
  ];
  const sb = makeBackfillFakeSb({ historyRowCount: 0, meals });
  const seeded = await backfillFoodHistory(sb as never, "u1");

  // Two distinct food groups
  expect(seeded).toBe(2);
  const allInserted = sb.inserts.flatMap((batch) => batch);
  const names = allInserted.map((r) => r.normalized_name as string);
  expect(names.some((n) => n.includes("hafer"))).toBe(true);
  expect(names.some((n) => n.includes("milch"))).toBe(true);
});
