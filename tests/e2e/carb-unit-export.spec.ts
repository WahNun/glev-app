// Unit / integration coverage for the carb-unit-aware exports.
//
// Why this exists:
//   The CSV header now flips between `carbs_grams (g)`, `carbs_be (BE)`
//   and `carbs_ke (KE)`, and the PDF cover surfaces the chosen unit in
//   its meta block ("Kohlenhydrat-Einheit"). A regression in the
//   gToUnit conversion (or in the header strings) would silently send
//   doctors numbers in the wrong unit — there's no UI banner that
//   warns when a CSV says "carbs_grams" but actually contains BE
//   values, so a wrong header is invisible until somebody reads the
//   PDF cover. This spec pins all three behaviours.
//
// What this asserts:
//   1. `mealsToCSV(meals, unit)` writes the right header + the right
//      numeric values for each of "g", "BE", "KE".
//   2. The conversion is the canonical 60g → 5 BE / 6 KE that the
//      carbUnits helpers promise.
//   3. The PDF cover (GlevReport) carries a "Kohlenhydrat-Einheit"
//      meta entry whose value matches the chosen unit.
//
// Why this is a Playwright spec (no browser):
//   The project's only test runner is Playwright, and the suite is
//   wired up via `npm test` → `playwright test`. Co-locating these
//   pure-function checks in `tests/e2e/` means they run automatically
//   alongside the existing theme-picker spec, with no new toolchain
//   to maintain. None of these tests touch `page` / the dev server,
//   so they execute as fast as a normal unit test.

import { test, expect } from "@playwright/test";
import type { ReactElement, ReactNode } from "react";

import { mealsToCSV } from "@/lib/export";
import { gToUnit } from "@/lib/carbUnits";
import { GlevReport } from "@/lib/pdfReport";
import type { Meal } from "@/lib/meals";

// Skip the global setup (which provisions a Supabase test user) for
// this spec — these checks don't need an authenticated user. Playwright
// runs `globalSetup` once per `npm test` invocation regardless, but we
// don't depend on its output, so the fixture is harmless if absent.

/**
 * Minimal Meal stub. We only populate fields the export actually reads
 * so the test stays focused on the carb-unit conversion. The rest stay
 * `null` — `mealsToCSV` already handles null by emitting empty cells.
 */
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

/** Pull a column value out of a CSV row by header name. */
function readColumn(csv: string, columnName: string, rowIndex = 0): string {
  const lines = csv.split("\r\n");
  const headers = lines[0].split(",");
  const idx = headers.indexOf(columnName);
  if (idx === -1) {
    throw new Error(
      `Column "${columnName}" not found in headers: ${headers.join(" | ")}`,
    );
  }
  // Naïve split is fine here — none of the values we read in this spec
  // contain commas or quotes that would need full CSV parsing.
  return lines[1 + rowIndex].split(",")[idx];
}

test.describe("mealsToCSV — carb-unit-aware header and values", () => {
  // 60g of carbs is the canonical fixture: it converts cleanly to
  //   60 / 12 = 5 BE   (DE / AT)
  //   60 / 10 = 6 KE   (CH)
  // so any rounding regression in `gToUnit` would change the integer
  // value and fail the assertion immediately.
  const meals: Meal[] = [
    makeMeal({ id: "a", carbs_grams: 60 }),
    makeMeal({ id: "b", carbs_grams: 24 }),
    // null carb row to verify null survives as an empty cell across
    // every unit (regression: an early version coerced null -> 0).
    makeMeal({ id: "c", carbs_grams: null }),
  ];

  test("emits `carbs_grams (g)` and unchanged values when unit is g", () => {
    const csv = mealsToCSV(meals, "g");
    const headers = csv.split("\r\n")[0].split(",");
    expect(headers).toContain("carbs_grams (g)");
    // No BE/KE columns leaking in.
    expect(headers).not.toContain("carbs_be (BE)");
    expect(headers).not.toContain("carbs_ke (KE)");

    expect(readColumn(csv, "carbs_grams (g)", 0)).toBe("60");
    expect(readColumn(csv, "carbs_grams (g)", 1)).toBe("24");
    // Null carbs → empty cell (NOT "0") so a clinician can tell apart
    // "no data" from "zero carbs".
    expect(readColumn(csv, "carbs_grams (g)", 2)).toBe("");
  });

  test("emits `carbs_be (BE)` and converts grams → BE when unit is BE", () => {
    const csv = mealsToCSV(meals, "BE");
    const headers = csv.split("\r\n")[0].split(",");
    expect(headers).toContain("carbs_be (BE)");
    expect(headers).not.toContain("carbs_grams (g)");

    // 60g / 12 = 5 BE — the canonical conversion every German
    // diabetologist expects.
    expect(readColumn(csv, "carbs_be (BE)", 0)).toBe("5");
    // 24g / 12 = 2 BE.
    expect(readColumn(csv, "carbs_be (BE)", 1)).toBe("2");
    // Null preserved as empty.
    expect(readColumn(csv, "carbs_be (BE)", 2)).toBe("");
  });

  test("emits `carbs_ke (KE)` and converts grams → KE when unit is KE", () => {
    const csv = mealsToCSV(meals, "KE");
    const headers = csv.split("\r\n")[0].split(",");
    expect(headers).toContain("carbs_ke (KE)");
    expect(headers).not.toContain("carbs_grams (g)");

    // 60g / 10 = 6 KE — the Swiss standard.
    expect(readColumn(csv, "carbs_ke (KE)", 0)).toBe("6");
    // 24g / 10 = 2.4 KE — exercise the .1 rounding branch.
    expect(readColumn(csv, "carbs_ke (KE)", 1)).toBe("2.4");
    // Null preserved as empty.
    expect(readColumn(csv, "carbs_ke (KE)", 2)).toBe("");
  });

  test("default unit (no arg) matches grams output for backward compatibility", () => {
    // Older callers pre-Task #56 didn't pass a unit. The signature
    // defaults to "g" so the legacy file shape stays identical — guard
    // that explicitly so a future signature tweak can't silently break
    // historical exports.
    const csv = mealsToCSV(meals);
    const headers = csv.split("\r\n")[0].split(",");
    expect(headers).toContain("carbs_grams (g)");
    expect(readColumn(csv, "carbs_grams (g)", 0)).toBe("60");
  });

  test("conversion stays consistent with gToUnit for arbitrary inputs", () => {
    // Cross-check: regardless of what value we feed in, the CSV cell
    // must equal `gToUnit(value, unit)`. Catches drift between the
    // export layer and the carb-units helper if either is changed in
    // isolation.
    const samples = [10, 15, 36, 100, 120];
    for (const grams of samples) {
      const m = [makeMeal({ id: `s-${grams}`, carbs_grams: grams })];
      for (const unit of ["g", "BE", "KE"] as const) {
        const csv = mealsToCSV(m, unit);
        const colName =
          unit === "g" ? "carbs_grams (g)" : `carbs_${unit.toLowerCase()} (${unit})`;
        expect(readColumn(csv, colName, 0)).toBe(String(gToUnit(grams, unit)));
      }
    }
  });
});

/* ──────────────────────────────────────────────────────────────────
   PDF cover — Kohlenhydrat-Einheit chip next to the Insights heading
   ──────────────────────────────────────────────────────────────────
   We invoke `GlevReport` as a plain function call (it's a React
   function component) and walk the returned React element tree to
   find the chip that sits in the Insights header row. We deliberately
   do NOT render to PDF bytes:
     * pdf().toBuffer() pulls in font + canvas paths that crash in a
       headless Node test runner.
     * The text we care about lives in plain `<Text>` primitives at
       known positions in the tree, so a JSX walk gives us the same
       guarantee with none of the runtime cost.

   Why the structure is now a chip (not a meta row):
     The "Kohlenhydrat-Einheit" entry used to be a separate
     label/value pair in the cover meta block, which pushed the KPI
     grid down so far that the last KPI cards spilled onto page 2.
     The unit info now lives as a small chip on the same line as the
     "Insights — Übersicht" heading, so the meta block stays compact
     and every KPI card fits on page 1. The contract this spec pins
     therefore changed: instead of a 2-leaf meta tile the cover now
     carries a single Text leaf "KH-Einheit: <unit>" alongside the
     heading.
   ────────────────────────────────────────────────────────────────── */

/**
 * Recursively collect every string / number leaf reachable through
 * `props.children`. Custom function components (e.g. `BrandHeader`)
 * are NOT invoked — we only inspect the JSX tree as authored. That
 * is sufficient because the meta block is built from React-PDF
 * primitives directly inside `GlevReport`.
 */
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

/**
 * Return true if some element in the tree is a "tight container" whose
 * descendant text leaves are exactly `[label, value]` (in any order).
 *
 * This is the meta-item adjacency check: the cover meta block is a row
 * of small `<View style={styles.metaItem}>` containers, each holding
 * exactly two `<Text>` nodes — a label and its value. By insisting on
 * a 2-leaf container we guarantee the asserted unit ("g" / "BE" / "KE")
 * sits next to the "Kohlenhydrat-Einheit" label, not somewhere
 * unrelated like a table header or an insight card. Without this guard
 * a regression that wrote the wrong unit into the cover meta value
 * could pass simply because the same unit token also appears further
 * down the page.
 */
function hasTightLabelValuePair(
  node: ReactNode,
  label: string,
  value: string,
): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string" || typeof node === "number") return false;
  if (Array.isArray(node)) {
    return node.some((child) => hasTightLabelValuePair(child, label, value));
  }
  if (typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    const leaves = new Set(collectStrings(el));
    if (leaves.size === 2 && leaves.has(label) && leaves.has(value)) {
      return true;
    }
    return hasTightLabelValuePair(el.props?.children ?? null, label, value);
  }
  return false;
}

/**
 * Return true if some Text leaf in the tree reads exactly
 * "KH-Einheit: <unit>". The chip is rendered as a single Text node
 * with a template-literal child, so the chip text collects to a
 * single leaf — checking for that exact leaf (rather than e.g. a
 * substring search) rejects accidental matches if the same token
 * appeared in a longer paragraph elsewhere on the page.
 */
function hasCarbUnitChip(node: ReactNode, unit: string): boolean {
  return collectStrings(node).includes(`KH-Einheit: ${unit}`);
}

test.describe("GlevReport — PDF cover advertises the chosen carb unit", () => {
  const baseProps = {
    email: "patient@example.com",
    meals: [] as Meal[],
    insulin: [],
    exercise: [],
    fingersticks: [],
  };

  for (const { unit, expectedLabel } of [
    { unit: "g" as const,  expectedLabel: "g" },
    { unit: "BE" as const, expectedLabel: "BE" },
    { unit: "KE" as const, expectedLabel: "KE" },
  ]) {
    test(`shows a "KH-Einheit: ${expectedLabel}" chip on the cover`, () => {
      // Call the component as a function — returns the React-PDF
      // <Document>...<Page>...</Page></Document> tree.
      const tree = GlevReport({ ...baseProps, carbUnit: unit }) as ReactElement;

      // The chip lives as a single Text leaf "KH-Einheit: <unit>" in
      // the Insights heading row. Asserting the exact joined leaf
      // rejects the false-positive case where the unit token happens
      // to appear elsewhere on the cover (e.g. inside a "KH (BE)"
      // table header) while the chip silently regressed to the wrong
      // unit — only an exact "KH-Einheit: <unit>" match counts.
      expect(hasCarbUnitChip(tree, expectedLabel)).toBe(true);

      // Belt-and-suspenders: the legacy meta-row label must NOT come
      // back. If a future refactor accidentally restored the meta
      // tile, the cover would carry the unit info twice and push the
      // KPIs off page 1 again.
      expect(collectStrings(tree)).not.toContain("Kohlenhydrat-Einheit");
    });
  }

  test("defaults to grams when no carbUnit prop is passed", () => {
    // Backward compatibility: legacy callers haven't been threaded
    // with the user preference yet. The `?? "g"` default in
    // GlevReport's destructuring must keep them on the gram chip.
    const tree = GlevReport(baseProps) as ReactElement;
    expect(hasCarbUnitChip(tree, "g")).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────
   PDF cover — Zeitraum line reflects the user-chosen export range
   ──────────────────────────────────────────────────────────────────
   When the user picks "30d" / "90d" / a custom from–to, the cover's
   "Zeitraum" line must echo *that* slice — not the slice that
   happens to span the data. The line is the only place the report
   surfaces the export window, so a clinician relies on it to know
   exactly what they're being handed. We assert the rendered string
   matches the formatted from/to dates and is co-located with the
   "Zeitraum" label inside the same metaItem container so a stray
   date elsewhere on the cover can't accidentally satisfy the test.
   ────────────────────────────────────────────────────────────────── */

test.describe("GlevReport — PDF cover Zeitraum reflects the export range", () => {
  // A meal at a known date so the data-derived `dateRange()` would
  // produce a deterministic fallback string. The chosen-range test
  // *must* override this — that's the whole point of the feature.
  const meals: Meal[] = [
    makeMeal({ id: "m1", carbs_grams: 60, created_at: "2026-01-15T12:00:00Z" }),
  ];
  const baseProps = {
    email: "patient@example.com",
    meals,
    insulin: [],
    exercise: [],
    fingersticks: [],
  };

  test("uses the chosen window when `range` prop is provided", () => {
    // Pick a window that does NOT overlap the data so we can tell
    // unambiguously whether the cover shows the chosen range or
    // silently fell back to the data-derived one.
    const tree = GlevReport({
      ...baseProps,
      range: {
        from: "2026-03-01T00:00:00.000Z",
        to:   "2026-03-31T23:59:59.999Z",
      },
    }) as ReactElement;
    // de-DE date format used by `fmtDate` inside pdfReport.tsx.
    expect(
      hasTightLabelValuePair(tree, "Zeitraum", "01.03.2026 – 31.03.2026"),
    ).toBe(true);
  });

  test("renders open-ended bounds with Anfang / heute placeholders", () => {
    // A custom range with only a `from` should still produce a
    // grammatical line, not an em-dash placeholder. Same for `to`-
    // only. The placeholders match the German wording used in the
    // pdfReport.tsx fallback branch.
    const fromOnly = GlevReport({
      ...baseProps,
      range: { from: "2026-02-10T00:00:00.000Z" },
    }) as ReactElement;
    expect(
      hasTightLabelValuePair(fromOnly, "Zeitraum", "10.02.2026 – heute"),
    ).toBe(true);

    const toOnly = GlevReport({
      ...baseProps,
      range: { to: "2026-02-10T23:59:59.999Z" },
    }) as ReactElement;
    expect(
      hasTightLabelValuePair(toOnly, "Zeitraum", "Anfang – 10.02.2026"),
    ).toBe(true);
  });

  test("falls back to data-derived earliest/latest when no range prop", () => {
    // Legacy "all" path: the cover should show the span of the
    // data itself, just like before this feature landed.
    const tree = GlevReport(baseProps) as ReactElement;
    expect(
      hasTightLabelValuePair(tree, "Zeitraum", "15.01.2026 – 15.01.2026"),
    ).toBe(true);
  });
});
