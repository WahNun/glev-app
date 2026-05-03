// Unit coverage for the body of the doctor-facing patient PDF
// (`<GlevReport>` in `lib/pdfReport.tsx`).
//
// Why this exists:
//   Task #65 already pinned the CSV exporters and the cover meta block
//   (ICR / Korrekturfaktor) of the report. Everything *below* the cover
//   meta — the Insights overview cards, the per-section detail tables
//   (Mahlzeiten, Insulin, Sport, Fingerstick), the 14-day glucose trend
//   arrow, and the TIR / TBR / TAR aggregates — had no coverage at all.
//   A regression that drops a column from the meals table, swaps the
//   trend-arrow direction, or miscomputes TIR would silently ship a
//   misleading clinical document to a doctor. This file walks the
//   `<GlevReport>` JSX tree (same pattern as `tests/unit/export.test.ts`)
//   to assert every body element renders the values we expect.
//
// Why this is a Playwright spec (no browser):
//   The widened `testDir: "./tests"` in `playwright.config.ts` picks up
//   files under `tests/unit/*.test.ts` automatically. None of these
//   checks touch `page` / the dev server; they run as fast as a normal
//   unit test.

import { test, expect } from "@playwright/test";
import type { ReactElement, ReactNode } from "react";

import { GlevReport } from "@/lib/pdfReport";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";

/* ──────────────────────────────────────────────────────────────────
   Brand tokens — mirrored from `lib/pdfReport.tsx`. The trend arrow
   reads its color from the same brand palette the in-app charts use,
   so a renamed/removed token would silently drift the PDF and the
   app apart. Copying the literals here pins the contract: if a brand
   refactor changes ORANGE from #FF9500, the test fails loudly.
   ────────────────────────────────────────────────────────────────── */

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const ORANGE = "#FF9500";
const MUTED  = "#6B6B7A";

/* ──────────────────────────────────────────────────────────────────
   Fixture builders — same shape as `tests/unit/export.test.ts` so the
   two specs assert against the same input model. Every required field
   is populated with a deterministic default so a downstream property
   that we forgot to override doesn't surface as `undefined` mid-render.
   ────────────────────────────────────────────────────────────────── */

function makeMeal(overrides: Partial<Meal>): Meal {
  return {
    id: "m1",
    user_id: "u1",
    input_text: "",
    parsed_json: [],
    glucose_before: null,
    glucose_after: null,
    bg_1h: null,
    bg_1h_at: null,
    bg_2h: null,
    bg_2h_at: null,
    glucose_30min: null,
    glucose_30min_at: null,
    glucose_1h: null,
    glucose_1h_at: null,
    glucose_90min: null,
    glucose_90min_at: null,
    glucose_2h: null,
    glucose_2h_at: null,
    glucose_3h: null,
    glucose_3h_at: null,
    outcome_state: null,
    min_bg_180: null, max_bg_180: null, time_to_peak_min: null,
    auc_180: null, had_hypo_window: null, min_bg_60_180: null,
    meal_time: null,
    carbs_grams: null,
    protein_grams: null,
    fat_grams: null,
    fiber_grams: null,
    calories: null,
    insulin_units: null,
    meal_type: null,
    evaluation: null,
    related_meal_id: null,
    created_at: "2026-04-30T08:00:00Z",
    ...overrides,
  };
}

function makeInsulin(overrides: Partial<InsulinLog>): InsulinLog {
  return {
    id: "i1",
    user_id: "u1",
    created_at: "2026-04-30T09:00:00Z",
    insulin_type: "bolus",
    insulin_name: "NovoRapid",
    units: 5,
    cgm_glucose_at_log: null,
    notes: null,
    glucose_after_1h: null,
    glucose_after_2h: null,
    glucose_after_12h: null,
    glucose_after_24h: null,
    related_entry_id: null,
    ...overrides,
  };
}

function makeExercise(overrides: Partial<ExerciseLog>): ExerciseLog {
  return {
    id: "e1",
    user_id: "u1",
    created_at: "2026-04-30T10:00:00Z",
    exercise_type: "run",
    duration_minutes: 30,
    intensity: "medium",
    cgm_glucose_at_log: null,
    notes: null,
    glucose_at_end: null,
    glucose_after_1h: null,
    ...overrides,
  };
}

function makeFingerstick(
  overrides: Partial<FingerstickReading>,
): FingerstickReading {
  return {
    id: "f1",
    user_id: "u1",
    measured_at: "2026-04-30T11:00:00Z",
    value_mg_dl: 95,
    notes: null,
    created_at: "2026-04-30T11:00:00Z",
    ...overrides,
  };
}

const baseProps = {
  email: "patient@example.com",
  meals: [] as Meal[],
  insulin: [] as InsulinLog[],
  exercise: [] as ExerciseLog[],
  fingersticks: [] as FingerstickReading[],
};

/* ──────────────────────────────────────────────────────────────────
   JSX-tree-walk helpers
   ──────────────────────────────────────────────────────────────────
   These mirror `collectStrings` / `hasTightLabelValuePair` from the
   sibling export.test.ts spec, but add the few extras this file needs:

     * findElements   — list every element matching a predicate
     * childrenArray  — flatten React children (handles arrays and
                        nested arrays from `.map()` returns) into a
                        single positional list of nodes
     * findTable      — locate a `<View>` whose first child is a
                        header row whose direct Text leaves equal a
                        given column-header set; returns the matched
                        header element + the sibling row elements
                        (everything after the header). Used as the
                        per-section table-presence + row-count check.
     * findTrendArrow — locate the local `TrendArrow` component
                        instance by function name and read back the
                        `direction` / `color` props the cover-page
                        14-day trend chip is invoked with
     * findKpiPercent — locate a 3-leaf KPI tile [label, n, "%"] and
                        return the numeric `n` so the TIR/TBR/TAR
                        spec can pin the percent string

   None of these invoke function components — we only inspect the
   JSX tree as authored, exactly like export.test.ts.
   ────────────────────────────────────────────────────────────────── */

function collectStrings(node: ReactNode): string[] {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return collectStrings(el.props?.children);
  }
  return [];
}

function findElements(
  node: ReactNode,
  predicate: (el: ReactElement) => boolean,
): ReactElement[] {
  const out: ReactElement[] = [];
  function walk(n: ReactNode) {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === "object" && "props" in n) {
      const el = n as ReactElement<{ children?: ReactNode }>;
      if (predicate(el)) out.push(el);
      walk(el.props?.children ?? null);
    }
  }
  walk(node);
  return out;
}

function childrenArray(c: ReactNode): ReactNode[] {
  if (c == null || typeof c === "boolean") return [];
  if (Array.isArray(c)) return c.flatMap(childrenArray);
  return [c];
}

interface FoundTable {
  th: ReactElement;
  rows: ReactElement[];
}

function findTable(
  tree: ReactNode,
  expectedHeaders: string[],
): FoundTable | null {
  const matches = findElements(tree, (el) => {
    const kids = childrenArray(el.props?.children);
    if (kids.length === 0) return false;
    const first = kids[0];
    if (typeof first !== "object" || first === null || !("props" in first)) {
      return false;
    }
    const firstEl = first as ReactElement<{ children?: ReactNode }>;
    // Pull the leaf text of every direct child of the candidate
    // header row. A real `th` row is a flat list of single-text
    // `<Text>` cells, so each direct child collects to exactly one
    // string. Anything else (nested Views, mixed leaves) means
    // we're looking at a body container, not a header row.
    const headerKids = childrenArray(firstEl.props?.children);
    const headerTexts: string[] = [];
    for (const hk of headerKids) {
      if (typeof hk !== "object" || hk === null || !("props" in hk)) continue;
      const leaves = collectStrings(
        (hk as ReactElement<{ children?: ReactNode }>).props?.children ?? null,
      );
      // A header cell with template-literal interpolation (e.g.
      // `KH (${carbLabel})`) collects to multiple text leaves
      // (`["KH (", "g", ")"]`). Concatenating with no separator
      // reconstructs the rendered cell text exactly.
      if (leaves.length >= 1) headerTexts.push(leaves.join(""));
    }
    if (headerTexts.length !== expectedHeaders.length) return false;
    return expectedHeaders.every((h) => headerTexts.includes(h));
  });
  if (matches.length === 0) return null;
  const table = matches[0];
  const arr = childrenArray(table.props?.children);
  const th = arr[0] as ReactElement;
  const rows = arr.slice(1).filter(
    (c): c is ReactElement =>
      typeof c === "object" && c !== null && "props" in c,
  );
  return { th, rows };
}

function findTrendArrow(
  tree: ReactNode,
): { direction: string; color: string } | null {
  const matches = findElements(
    tree,
    (el) =>
      typeof el.type === "function" &&
      (el.type as { name?: string }).name === "TrendArrow",
  );
  if (matches.length === 0) return null;
  const props = matches[0].props as { direction: string; color: string };
  return { direction: props.direction, color: props.color };
}

/**
 * Locate a 3-leaf KPI tile of the form [label, percentString, "%"]
 * and return the `percentString`. The `<View style={styles.kpi}>`
 * tile renders exactly one label Text + one value Text whose nested
 * Text appends the "%" suffix — so the smallest container that
 * collects to those three leaves IS the KPI tile.
 */
function findKpiPercent(tree: ReactNode, label: string): string | null {
  const matches = findElements(tree, (el) => {
    const leaves = collectStrings(el.props?.children ?? null);
    return (
      leaves.length === 3 &&
      leaves[0] === label &&
      leaves[2] === "%"
    );
  });
  if (matches.length === 0) return null;
  const leaves = collectStrings(matches[0].props?.children ?? null);
  return leaves[1];
}

/* ──────────────────────────────────────────────────────────────────
   1. Insights — Übersicht (cover-page card grid)
   ──────────────────────────────────────────────────────────────────
   Seven explicitly-requested headline metrics. We assert every label
   string appears anywhere in the tree — losing a label would mean
   either the card was deleted or its label string was renamed,
   either of which should be an explicit, reviewed change.
   ────────────────────────────────────────────────────────────────── */

test.describe("GlevReport — Insights overview cards", () => {
  test("renders all 7 insight card labels on the cover", () => {
    const tree = GlevReport({
      ...baseProps,
      meals: [makeMeal({ id: "m1", carbs_grams: 60 })],
      insulin: [makeInsulin({ id: "i1", units: 5 })],
      fingersticks: [makeFingerstick({ id: "f1", value_mg_dl: 110 })],
    }) as ReactElement;
    const leaves = collectStrings(tree);
    for (const label of [
      "Total Meals",
      "Ø Carbs / Mahlzeit",
      "Letzte 7 Tage · Mahlzeiten",
      "Letzte 7 Tage · Carbs",
      "Letzte 7 Tage · Insulin",
      "Ø Glucose",
      "14-Tage Trend",
    ]) {
      expect(
        leaves.includes(label),
        `expected insight card "${label}" to be present`,
      ).toBe(true);
    }
  });

  test("Total Meals value matches the fixture meal count", () => {
    // Three meals → headline number "3" must appear in the tree.
    const meals = [
      makeMeal({ id: "m1" }),
      makeMeal({ id: "m2" }),
      makeMeal({ id: "m3" }),
    ];
    const tree = GlevReport({ ...baseProps, meals }) as ReactElement;
    // The Total Meals insight card has exactly 3 text leaves:
    //   [label, headline number, explanation paragraph].
    // Find the smallest container whose first two leaves are
    // ["Total Meals", "3"] — pinning both that the card exists and
    // that its headline number tracks the fixture meal count.
    const card = findElements(tree, (el) => {
      const ls = collectStrings(el.props?.children ?? null);
      return ls.length === 3 && ls[0] === "Total Meals" && ls[1] === "3";
    });
    expect(
      card.length,
      'expected a Total Meals card whose headline reads "3"',
    ).toBeGreaterThan(0);
  });

  test("Ø Carbs / Mahlzeit honours carbUnit (BE → average in BE)", () => {
    // 24g + 36g over 2 meals → 30g average → 2.5 BE (12g per BE).
    // Locks in the formatCarbs(avg, 'BE') path: a regression that
    // forgets to thread the unit would surface "30 g KH" instead.
    const meals = [
      makeMeal({ id: "m1", carbs_grams: 24 }),
      makeMeal({ id: "m2", carbs_grams: 36 }),
    ];
    const tree = GlevReport({
      ...baseProps,
      meals,
      carbUnit: "BE",
    }) as ReactElement;
    const leaves = collectStrings(tree);
    expect(leaves).toContain("2.5 BE");
    expect(leaves).toContain("/ Mahlzeit");
  });
});

/* ──────────────────────────────────────────────────────────────────
   2. Per-section detail tables — headers + row counts
   ──────────────────────────────────────────────────────────────────
   Each table is identified by its unique header set (`findTable`).
   Once located, we assert the row count matches the fixture entry
   count. A regression that drops a column changes the header set
   and `findTable` returns null; a regression that drops the row
   render makes `rows.length` mismatch the fixture count.
   ────────────────────────────────────────────────────────────────── */

test.describe("GlevReport — per-section detail tables", () => {
  test("Mahlzeiten table: 7 column headers + one row per fixture meal (carbUnit defaults to g)", () => {
    const meals = [
      makeMeal({ id: "m1", input_text: "Müsli",  carbs_grams: 60, insulin_units: 5 }),
      makeMeal({ id: "m2", input_text: "Pasta",  carbs_grams: 80, insulin_units: 6 }),
      makeMeal({ id: "m3", input_text: "Apfel",  carbs_grams: 20, insulin_units: 2 }),
    ];
    const tree = GlevReport({ ...baseProps, meals }) as ReactElement;
    const table = findTable(tree, [
      "Datum/Zeit",
      "Typ",
      "Beschreibung",
      "KH (g)",
      "Insulin (U)",
      "Glucose vor",
      "+2h",
    ]);
    expect(table, "expected the Mahlzeiten table").not.toBeNull();
    expect(table!.rows.length).toBe(meals.length);
  });

  test("Mahlzeiten table KH header tracks carbUnit (BE → 'KH (BE)')", () => {
    // The carb-unit suffix on the column header is computed at render
    // time — pin both the BE header AND the absence of the legacy
    // gram header so a regression that hard-codes "KH (g)" surfaces.
    const tree = GlevReport({
      ...baseProps,
      meals: [makeMeal({ id: "m1", input_text: "Müsli", carbs_grams: 60 })],
      carbUnit: "BE",
    }) as ReactElement;
    expect(
      findTable(tree, [
        "Datum/Zeit",
        "Typ",
        "Beschreibung",
        "KH (BE)",
        "Insulin (U)",
        "Glucose vor",
        "+2h",
      ]),
    ).not.toBeNull();
    // Negative assertion — the gram-unit header must NOT also appear,
    // otherwise the doctor sees two carb columns.
    expect(collectStrings(tree)).not.toContain("KH (g)");
  });

  test("Insulin table: 7 column headers + one row per fixture log", () => {
    const insulin = [
      makeInsulin({ id: "i1", insulin_name: "NovoRapid", units: 5 }),
      makeInsulin({ id: "i2", insulin_name: "Humalog",   units: 4, insulin_type: "bolus" }),
      makeInsulin({ id: "i3", insulin_name: "Tresiba",   units: 18, insulin_type: "basal" }),
    ];
    const tree = GlevReport({ ...baseProps, insulin }) as ReactElement;
    const table = findTable(tree, [
      "Datum/Zeit",
      "Typ",
      "Präparat",
      "Dosis (U)",
      "BG vorher",
      "BG +1h",
      "BG +2h",
    ]);
    expect(table, "expected the Insulin-Einträge table").not.toBeNull();
    expect(table!.rows.length).toBe(insulin.length);
  });

  test("Sport table: 6 column headers + one row per fixture log", () => {
    const exercise = [
      makeExercise({ id: "e1", exercise_type: "run",   duration_minutes: 30 }),
      makeExercise({ id: "e2", exercise_type: "swim",  duration_minutes: 45 }),
      makeExercise({ id: "e3", exercise_type: "yoga",  duration_minutes: 20 }),
      makeExercise({ id: "e4", exercise_type: "cycle", duration_minutes: 60 }),
    ];
    const tree = GlevReport({ ...baseProps, exercise }) as ReactElement;
    const table = findTable(tree, [
      "Datum/Zeit",
      "Typ",
      "Dauer",
      "Intensität",
      "BG Start",
      "BG Ende",
    ]);
    expect(table, "expected the Sport & Aktivität table").not.toBeNull();
    expect(table!.rows.length).toBe(exercise.length);
  });

  test("Fingerstick table: 3 column headers + one row per fixture reading", () => {
    const fingersticks = [
      makeFingerstick({ id: "f1", value_mg_dl: 95 }),
      makeFingerstick({ id: "f2", value_mg_dl: 142 }),
      makeFingerstick({ id: "f3", value_mg_dl: 65 }),
      makeFingerstick({ id: "f4", value_mg_dl: 210 }),
      makeFingerstick({ id: "f5", value_mg_dl: 110 }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const table = findTable(tree, [
      "Datum/Zeit",
      "Wert (mg/dL)",
      "Notiz",
    ]);
    expect(table, "expected the Fingerstick-Messungen table").not.toBeNull();
    expect(table!.rows.length).toBe(fingersticks.length);
  });

  test("each detail-table section heading still appears", () => {
    // Belt-and-suspenders against a regression that wipes the
    // `<Page>` for a section entirely (table + heading both gone).
    // findTable would surface that already, but a plain heading check
    // documents the expected document structure for a future reader.
    const tree = GlevReport({
      ...baseProps,
      meals:        [makeMeal({ id: "m1" })],
      insulin:      [makeInsulin({ id: "i1" })],
      exercise:     [makeExercise({ id: "e1" })],
      fingersticks: [makeFingerstick({ id: "f1" })],
    }) as ReactElement;
    const leaves = collectStrings(tree);
    for (const heading of [
      "Mahlzeiten",
      "Insulin-Einträge",
      "Fingerstick-Messungen",
      "Sport & Aktivität",
    ]) {
      expect(
        leaves.includes(heading),
        `expected section heading "${heading}" to be present`,
      ).toBe(true);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────
   3. 14-day trend arrow — direction + color follow the ±5 mg/dL band
   ──────────────────────────────────────────────────────────────────
   The trend chip drives a real-geometry SVG arrow (Helvetica doesn't
   ship the U+2191/U+2193 glyphs in WinAnsi). Direction + color are
   passed as props to the local `TrendArrow` component, which we
   locate by function name. The thresholds we pin:

       delta > +5    → "up"   + ORANGE (warning)
       delta < -5    → "down" + GREEN  (improvement)
       |delta| ≤ 5   → "flat" + ACCENT (≈ stable)
       null delta    → "none" + MUTED  (no data either window)

   `computeInsightsMetrics` reads `Date.now()` at render time so the
   fixtures use timestamps relative to "now": ~10 days back ≡ older
   half (days 7-13), ~3 days back ≡ newer half (days 0-6).
   ────────────────────────────────────────────────────────────────── */

test.describe("GlevReport — 14-day trend arrow", () => {
  const DAY = 86_400_000;
  const isoDaysAgo = (d: number) =>
    new Date(Date.now() - d * DAY).toISOString();

  test('newer avg > older avg by more than 5 mg/dL → direction="up", color=ORANGE', () => {
    const fingersticks = [
      makeFingerstick({ id: "fold", value_mg_dl: 100, measured_at: isoDaysAgo(10) }),
      makeFingerstick({ id: "fnew", value_mg_dl: 120, measured_at: isoDaysAgo(3) }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow, "expected a TrendArrow on the cover").not.toBeNull();
    expect(arrow!.direction).toBe("up");
    expect(arrow!.color).toBe(ORANGE);
  });

  test('newer avg < older avg by more than 5 mg/dL → direction="down", color=GREEN', () => {
    const fingersticks = [
      makeFingerstick({ id: "fold", value_mg_dl: 150, measured_at: isoDaysAgo(10) }),
      makeFingerstick({ id: "fnew", value_mg_dl: 130, measured_at: isoDaysAgo(3) }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("down");
    expect(arrow!.color).toBe(GREEN);
  });

  test('|delta| within ±5 mg/dL → direction="flat", color=ACCENT', () => {
    const fingersticks = [
      makeFingerstick({ id: "fold", value_mg_dl: 110, measured_at: isoDaysAgo(10) }),
      makeFingerstick({ id: "fnew", value_mg_dl: 113, measured_at: isoDaysAgo(3) }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("flat");
    expect(arrow!.color).toBe(ACCENT);
  });

  test("exactly +5 mg/dL is treated as flat (closed-band lower edge)", () => {
    // The threshold uses strict `> 5` / `< -5`, so the boundary
    // values themselves still read as flat. Pin both edges so a
    // future refactor that swaps `>` for `>=` is caught.
    const fingersticks = [
      makeFingerstick({ id: "fold", value_mg_dl: 110, measured_at: isoDaysAgo(10) }),
      makeFingerstick({ id: "fnew", value_mg_dl: 115, measured_at: isoDaysAgo(3) }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("flat");
    expect(arrow!.color).toBe(ACCENT);
  });

  test("exactly -5 mg/dL is treated as flat (closed-band upper edge)", () => {
    const fingersticks = [
      makeFingerstick({ id: "fold", value_mg_dl: 115, measured_at: isoDaysAgo(10) }),
      makeFingerstick({ id: "fnew", value_mg_dl: 110, measured_at: isoDaysAgo(3) }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("flat");
    expect(arrow!.color).toBe(ACCENT);
  });

  test('no readings in the 14-day window → direction="none", color=MUTED', () => {
    // Empty fingersticks AND empty meals → both windows are empty,
    // delta is null → the arrow falls back to the em-dash placeholder.
    const tree = GlevReport({ ...baseProps }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("none");
    expect(arrow!.color).toBe(MUTED);
  });

  test("meal-context glucose values feed the trend (not just fingersticks)", () => {
    // No fingersticks at all — the trend should still produce a
    // direction because the meal's glucose_before / bg_2h / etc are
    // pulled into the same windowed average. Locks in the dual-source
    // contract from `computeInsightsMetrics`'s `pushReading` calls.
    const meals = [
      makeMeal({
        id: "mold",
        created_at: isoDaysAgo(10),
        glucose_before: 100,
        bg_2h: 100,
      }),
      makeMeal({
        id: "mnew",
        created_at: isoDaysAgo(3),
        glucose_before: 130,
        bg_2h: 130,
      }),
    ];
    const tree = GlevReport({ ...baseProps, meals }) as ReactElement;
    const arrow = findTrendArrow(tree);
    expect(arrow!.direction).toBe("up");
    expect(arrow!.color).toBe(ORANGE);
  });
});

/* ──────────────────────────────────────────────────────────────────
   4. TIR / TBR / TAR aggregates
   ──────────────────────────────────────────────────────────────────
   The KPI tiles render the percent as a 3-leaf [label, n, "%"] block.
   We pin the percent string (not the raw float) so a regression in
   the formatter or in the integer/float boundary is visible. The
   fixtures intentionally mix fingerstick + meal-context values to
   guard against a refactor that drops one of the two sources.
   ────────────────────────────────────────────────────────────────── */

test.describe("GlevReport — TIR / TBR / TAR aggregates", () => {
  test("computes percentages across fingersticks AND meal-context glucose values", () => {
    // 6 fingersticks: 2 below (60,65), 2 in range (90,130), 2 above (200,220)
    // 1 meal contributes 4 glucose values:
    //   glucose_before=90 → in range
    //   glucose_after=160 → in range
    //   bg_1h=180         → in range (≤180 is in range per the
    //                       `v >= 70 && v <= 180` check)
    //   bg_2h=210         → above range
    // Totals: 10 samples. TBR=2 (20%), TIR=5 (50%), TAR=3 (30%).
    const fingersticks = [
      makeFingerstick({ id: "f1", value_mg_dl: 60 }),
      makeFingerstick({ id: "f2", value_mg_dl: 65 }),
      makeFingerstick({ id: "f3", value_mg_dl: 90 }),
      makeFingerstick({ id: "f4", value_mg_dl: 130 }),
      makeFingerstick({ id: "f5", value_mg_dl: 200 }),
      makeFingerstick({ id: "f6", value_mg_dl: 220 }),
    ];
    const meals = [
      makeMeal({
        id: "m1",
        glucose_before: 90,
        glucose_after: 160,
        bg_1h: 180,
        bg_2h: 210,
      }),
    ];
    const tree = GlevReport({
      ...baseProps,
      fingersticks,
      meals,
    }) as ReactElement;
    expect(findKpiPercent(tree, "Time in Range")).toBe("50");
    expect(findKpiPercent(tree, "Time below 70")).toBe("20");
    expect(findKpiPercent(tree, "Time above 180")).toBe("30");
  });

  test("the in-range band is closed (70 and 180 themselves count as in range)", () => {
    // Both boundary values must classify as TIR (`v >= 70 && v <= 180`),
    // so a 4-reading set of {70, 100, 180, 250} reads as TBR=0/TIR=3/TAR=1.
    // Pin the boundary behaviour so a refactor that uses strict `>` or
    // `<` somewhere drifts the report off the standard TIR definition.
    const fingersticks = [
      makeFingerstick({ id: "f1", value_mg_dl: 70 }),
      makeFingerstick({ id: "f2", value_mg_dl: 100 }),
      makeFingerstick({ id: "f3", value_mg_dl: 180 }),
      makeFingerstick({ id: "f4", value_mg_dl: 250 }),
    ];
    const tree = GlevReport({ ...baseProps, fingersticks }) as ReactElement;
    expect(findKpiPercent(tree, "Time in Range")).toBe("75");
    expect(findKpiPercent(tree, "Time below 70")).toBe("0");
    expect(findKpiPercent(tree, "Time above 180")).toBe("25");
  });

  test("zero glucose samples → TIR/TBR/TAR all render as 0%", () => {
    // Defensive guard inside `computeAggregates`: when
    // `glucoseSamples === 0` it must short-circuit to 0 instead of
    // dividing by zero (which would render as "NaN%" on the report).
    const tree = GlevReport({ ...baseProps }) as ReactElement;
    expect(findKpiPercent(tree, "Time in Range")).toBe("0");
    expect(findKpiPercent(tree, "Time below 70")).toBe("0");
    expect(findKpiPercent(tree, "Time above 180")).toBe("0");
  });
});
