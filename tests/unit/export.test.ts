// Unit coverage for the CSV exporters in `lib/export.ts` and the
// matching `<GlevReport>` cover meta block in `lib/pdfReport.tsx`.
//
// Why this exists:
//   The exporters have grown a handful of optional, conditional
//   columns (insulin: ICR + CF; meals: BE/KE unit headers; PDF cover:
//   ICR + Korrekturfaktor lines). A future refactor that drops one of
//   the conditional branches — or, worse, surfaces a misleading
//   "0 BE/IE" / "0 mg/dL/IE" to a clinician — would otherwise be
//   invisible until a user complains. This file pins:
//
//     1. The legacy default output of every `*ToCSV` function
//        (no opts → byte-for-byte identical headers + rows). Locks
//        in column order, serialization (null → empty, JSON for
//        objects, CSV-escaping for commas/quotes), and CRLF row
//        separators.
//     2. `insulinToCSV`'s per-row ICR snapshot behaviour and CF column
//        emit/suppress rules: column appears when carbUnit is set
//        (regardless of icrGperIE); each cell uses the row's own
//        `icr_g_per_ie_at_log` snapshot (null → "—"); CF suppression
//        follows the legacy finite-positive guard.
//     3. The `<GlevReport>` cover meta block: the "ICR (aktuell)"
//        and "Korrekturfaktor" lines must render only when a finite
//        positive value is supplied, never on null / 0 / negative.
//
// Why this is a Playwright spec (no browser):
//   The project's only test runner is Playwright (`npm test` →
//   `playwright test`). The widened `testDir: "./tests"` in
//   `playwright.config.ts` means files under `tests/unit/*.test.ts`
//   are picked up automatically alongside the existing e2e specs,
//   with no new toolchain to maintain. None of these checks touch
//   `page` / the dev server, so they run as fast as a normal unit
//   test.

import { test, expect } from "@playwright/test";
import type { ReactElement, ReactNode } from "react";

import {
  mealsToCSV,
  insulinToCSV,
  exerciseToCSV,
  fingersticksToCSV,
  buildCSVZip,
} from "@/lib/export";
import { icrToUnit } from "@/lib/carbUnits";
import { GlevReport } from "@/lib/pdfReport";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";

/* ──────────────────────────────────────────────────────────────────
   Fixture builders — populate every required field with a
   deterministic value so the tests assert on real input shape,
   not on whatever the type-checker happens to infer from `as any`.
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
    pre_meal_trend: null,
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

/** Headers row of a CSV (first line, before the first CRLF). */
function headerCells(csv: string): string[] {
  return csv.split("\r\n")[0].split(",");
}

/* ──────────────────────────────────────────────────────────────────
   1. Legacy default output — byte-for-byte
   ──────────────────────────────────────────────────────────────────
   Each test below pins the *entire* CSV string a default-options call
   produces. That is intentionally stricter than a header-membership
   check: it locks column order, empty-cell serialization, the JSON
   encoding of `parsed_json`, the CRLF row separator, and the
   csv-escaping of commas/quotes/newlines inside a single string.
   ────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────
   0. SPIKE_STRONG in CSV export — outcome value round-trips correctly
   ──────────────────────────────────────────────────────────────────
   The `evaluation` column in mealsToCSV is a raw string passthrough:
   whatever string value is stored in the DB is emitted verbatim. This
   test pins that SPIKE_STRONG is NOT silently coerced, normalised, or
   dropped by the exporter — the doctor/researcher receiving the CSV
   can filter on the exact DB value without guessing.
   ────────────────────────────────────────────────────────────────── */

test.describe("mealsToCSV — SPIKE_STRONG evaluation value is preserved in export", () => {
  test("SPIKE_STRONG in evaluation column appears verbatim in the CSV row", () => {
    const meals: Meal[] = [
      makeMeal({
        id: "m_spike",
        created_at: "2026-04-30T08:00:00Z",
        evaluation: "SPIKE_STRONG",
      }),
    ];
    const csv = mealsToCSV(meals);
    const rows = csv.split("\r\n");
    expect(rows.length).toBe(2); // header + 1 data row
    // The evaluation column header must be present.
    expect(rows[0].split(",")).toContain("evaluation");
    // The data row must contain "SPIKE_STRONG" exactly.
    const evalIdx = rows[0].split(",").indexOf("evaluation");
    expect(evalIdx, "evaluation column must exist").toBeGreaterThanOrEqual(0);
    const evalCell = rows[1].split(",")[evalIdx];
    expect(evalCell).toBe("SPIKE_STRONG");
  });

  test("SPIKE (not strong) also round-trips correctly — distinguishable from SPIKE_STRONG", () => {
    // Verifies the two spike variants are NOT conflated in the export.
    // A bug that normalises SPIKE_STRONG → SPIKE would make the CSV
    // useless for severity analysis.
    const csvStrong = mealsToCSV([makeMeal({ id: "m1", evaluation: "SPIKE_STRONG" })]);
    const csvWeak   = mealsToCSV([makeMeal({ id: "m2", evaluation: "SPIKE" })]);
    const headers = csvStrong.split("\r\n")[0].split(",");
    const evalIdx = headers.indexOf("evaluation");
    expect(csvStrong.split("\r\n")[1].split(",")[evalIdx]).toBe("SPIKE_STRONG");
    expect(csvWeak.split("\r\n")[1].split(",")[evalIdx]).toBe("SPIKE");
  });
});

test.describe("`*ToCSV` default output is byte-for-byte stable", () => {
  test("mealsToCSV (no unit arg) emits the legacy gram-only layout", () => {
    const meals: Meal[] = [
      // Populate enough columns to exercise null → empty, numeric
      // serialization, and the parsed_json JSON encoding all in one
      // row. Anything we leave null in `makeMeal` will surface as an
      // empty cell, which is exactly the behaviour we want to lock in.
      makeMeal({
        id: "m1",
        created_at: "2026-04-30T08:00:00Z",
        meal_time: "2026-04-30T08:00:00Z",
        meal_type: "breakfast",
        input_text: "Müsli",
        carbs_grams: 60,
        protein_grams: 12,
        fat_grams: 5,
        fiber_grams: 4,
        calories: 350,
        insulin_units: 5,
        glucose_before: 110,
        glucose_after: 145,
        outcome_state: "final",
      }),
    ];
    const expected =
      "id,created_at,meal_time,meal_type,input_text," +
      "carbs_grams (g),protein_grams,fat_grams,fiber_grams,calories," +
      "insulin_units,glucose_before,glucose_after," +
      "bg_1h,bg_1h_at,bg_2h,bg_2h_at," +
      "outcome_state,evaluation,related_meal_id,parsed_json" +
      "\r\n" +
      "m1,2026-04-30T08:00:00Z,2026-04-30T08:00:00Z,breakfast,Müsli," +
      "60,12,5,4,350," +
      "5,110,145," +
      ",,,," +
      "final,,,[]";
    expect(mealsToCSV(meals)).toBe(expected);
  });

  test("insulinToCSV (no opts) suppresses both ICR and CF columns", () => {
    const logs: InsulinLog[] = [
      makeInsulin({
        id: "i1",
        created_at: "2026-04-30T09:00:00Z",
        insulin_type: "bolus",
        insulin_name: "NovoRapid",
        units: 5,
        cgm_glucose_at_log: 120,
        glucose_after_1h: 140,
        glucose_after_2h: 110,
        notes: "post-Frühstück",
      }),
    ];
    const expected =
      "id,created_at,insulin_type,insulin_name,units," +
      "cgm_glucose_at_log," +
      "glucose_after_1h,glucose_after_2h," +
      "glucose_after_12h,glucose_after_24h," +
      "related_entry_id,notes" +
      "\r\n" +
      "i1,2026-04-30T09:00:00Z,bolus,NovoRapid,5," +
      "120,140,110,,,," +
      "post-Frühstück";
    expect(insulinToCSV(logs)).toBe(expected);
  });

  test("exerciseToCSV emits the legacy header + null-as-empty rows", () => {
    const logs: ExerciseLog[] = [
      makeExercise({
        id: "e1",
        created_at: "2026-04-30T10:00:00Z",
        exercise_type: "run",
        duration_minutes: 30,
        intensity: "medium",
        cgm_glucose_at_log: 130,
        glucose_at_end: 110,
        glucose_after_1h: 105,
        notes: null,
      }),
    ];
    const expected =
      "id,created_at,exercise_type,duration_minutes,intensity," +
      "cgm_glucose_at_log,glucose_at_end,glucose_after_1h,notes" +
      "\r\n" +
      "e1,2026-04-30T10:00:00Z,run,30,medium,130,110,105,";
    expect(exerciseToCSV(logs)).toBe(expected);
  });

  test("fingersticksToCSV emits the legacy 5-column layout", () => {
    const readings: FingerstickReading[] = [
      makeFingerstick({
        id: "f1",
        measured_at: "2026-04-30T11:00:00Z",
        value_mg_dl: 95,
        notes: null,
        created_at: "2026-04-30T11:00:00Z",
      }),
    ];
    const expected =
      "id,measured_at,value_mg_dl,notes,created_at" +
      "\r\n" +
      "f1,2026-04-30T11:00:00Z,95,,2026-04-30T11:00:00Z";
    expect(fingersticksToCSV(readings)).toBe(expected);
  });

  test("csv-escaping: commas / quotes / newlines in a notes field stay valid", () => {
    // `notes` is the only common free-text column on the four exporters,
    // and it's the most likely place a user will type a value that
    // demands quoting. Pin the behaviour here rather than spread across
    // each exporter's spec — `csvCell` is shared, so one regression
    // test for the escape rules is enough.
    const logs: InsulinLog[] = [
      makeInsulin({
        id: "i1",
        created_at: "2026-04-30T09:00:00Z",
        units: 4,
        notes: 'Erst 2 IE, dann nochmal 2 IE — "Korrektur"',
      }),
    ];
    const csv = insulinToCSV(logs);
    // Embedded `"` is doubled, the entire cell is wrapped in `"…"`,
    // and the row ends with that quoted cell — no trailing comma drift.
    expect(csv.endsWith('"Erst 2 IE, dann nochmal 2 IE — ""Korrektur"""')).toBe(true);
    // CRLF row separator survives the quoted cell.
    expect(csv.split("\r\n").length).toBe(2);
  });
});

/* ──────────────────────────────────────────────────────────────────
   2. `insulinToCSV` — ICR / CF column independence (per-row ICR)
   ──────────────────────────────────────────────────────────────────
   The ICR column now emits the per-row historic snapshot from
   `l.icr_g_per_ie_at_log` instead of a single current setting. The
   gate is: carbUnit present → column appears; no carbUnit → suppressed.
   The `icrGperIE` opt is no longer consulted for column inclusion or
   cell values (it still threads through to the PDF cover meta block).

     ┌─────────────────────────────────────────┬──────────┬──────────┐
     │ input                                   │ has ICR  │ has CF   │
     ├─────────────────────────────────────────┼──────────┼──────────┤
     │ {}                                      │   no     │   no     │
     │ icrGperIE=12, no carbUnit               │   no     │   no     │
     │ carbUnit=BE (icr_at_log = null)         │   yes→ — │   no     │
     │ carbUnit=BE + icr_at_log=12             │  yes→1   │   no     │
     │ cf=null                                 │   no     │   no     │
     │ cf=0                                    │   no     │   no     │
     │ cf=-50                                  │   no     │   no     │
     │ cf=50                                   │   no     │   yes    │
     │ carbUnit=BE + icr_at_log=12 + cf=50     │  yes→1   │   yes    │
     └─────────────────────────────────────────┴──────────┴──────────┘
   ────────────────────────────────────────────────────────────────── */

test.describe("insulinToCSV — ICR/CF columns appear/disappear independently", () => {
  // Base fixture — no icr_g_per_ie_at_log (simulates a legacy row).
  const logs: InsulinLog[] = [
    makeInsulin({ id: "i1", units: 5 }),
  ];
  // Fixture with a snapshot — simulates a modern bolus row.
  const logsWithSnapshot: InsulinLog[] = [
    makeInsulin({ id: "i2", units: 5, icr_g_per_ie_at_log: 12 }),
  ];

  // ── ICR suppression — only when carbUnit is absent ───────────────
  for (const { name, opts } of [
    { name: "no opts at all",                          opts: {} },
    { name: "icrGperIE set but carbUnit undefined",    opts: { icrGperIE: 12 } },
  ]) {
    test(`hides the ICR column when ${name}`, () => {
      const csv = insulinToCSV(logs, opts);
      const headers = headerCells(csv);
      // No header should mention "icr_".
      expect(headers.some((h) => h.startsWith("icr_"))).toBe(false);
      // Row width matches the legacy 12-cell layout.
      expect(csv.split("\r\n")[1].split(",").length).toBe(12);
    });
  }

  // ── ICR column appears whenever carbUnit is set ──────────────────
  // `icrGperIE` being null/0/NaN/negative no longer suppresses it —
  // the cell value comes from the row's own snapshot, not from opts.
  for (const { name, opts } of [
    { name: "carbUnit=BE, icrGperIE=null",    opts: { carbUnit: "BE" as const, icrGperIE: null } },
    { name: "carbUnit=BE, icrGperIE=0",       opts: { carbUnit: "BE" as const, icrGperIE: 0 } },
    { name: "carbUnit=BE, icrGperIE=-12",     opts: { carbUnit: "BE" as const, icrGperIE: -12 } },
    { name: "carbUnit=BE, icrGperIE=NaN",     opts: { carbUnit: "BE" as const, icrGperIE: Number.NaN } },
    { name: "carbUnit=BE only (no icrGperIE)", opts: { carbUnit: "BE" as const } },
  ]) {
    test(`shows ICR column (with '—' for null snapshot) when ${name}`, () => {
      const csv = insulinToCSV(logs, opts);
      const headers = headerCells(csv);
      expect(headers.some((h) => h.startsWith("icr_"))).toBe(true);
      // The base fixture has no icr_g_per_ie_at_log → cell shows "—".
      const icrIdx = headers.findIndex((h) => h.startsWith("icr_"));
      expect(csv.split("\r\n")[1].split(",")[icrIdx]).toBe("—");
    });
  }

  // ── ICR emission + per-unit header key + per-row snapshot value ──
  for (const { unit, headerKey, expected } of [
    { unit: "g"  as const, headerKey: "icr_g_per_ie (g/IE)",   expected: String(icrToUnit(12, "g"))  },
    { unit: "BE" as const, headerKey: "icr_be_per_ie (BE/IE)", expected: String(icrToUnit(12, "BE")) },
    { unit: "KE" as const, headerKey: "icr_ke_per_ie (KE/IE)", expected: String(icrToUnit(12, "KE")) },
  ]) {
    test(`shows "${headerKey}" header and per-row converted value for unit=${unit}`, () => {
      // Use the fixture that HAS a snapshot (icr_g_per_ie_at_log=12).
      const csv = insulinToCSV(logsWithSnapshot, { carbUnit: unit });
      const headers = headerCells(csv);
      expect(headers).toContain(headerKey);
      const idx = headers.indexOf(headerKey);
      // Cell must be the row's own snapshot converted to the display unit,
      // not any value from opts (opts carries no icrGperIE here at all).
      expect(csv.split("\r\n")[1].split(",")[idx]).toBe(expected);
    });
  }

  // ── opts.icrGperIE does NOT influence the cell value ────────────
  test("opts.icrGperIE is ignored for CSV cell values — only icr_g_per_ie_at_log is used", () => {
    // Row snapshot = 12 g/IE; opts.icrGperIE = 999 (different current setting).
    const csv = insulinToCSV(logsWithSnapshot, { carbUnit: "BE", icrGperIE: 999 });
    const headers = headerCells(csv);
    const idx = headers.findIndex((h) => h.startsWith("icr_"));
    // Must reflect the row's snapshot (12 g/IE → 1 BE/IE), never opts.icrGperIE (999).
    expect(csv.split("\r\n")[1].split(",")[idx]).toBe(String(icrToUnit(12, "BE")));
  });

  // ── Legacy row with snapshot=null still shows "—" ───────────────
  test("legacy row (icr_g_per_ie_at_log = null) renders '—', not the current ICR", () => {
    const csv = insulinToCSV(
      [makeInsulin({ id: "i_legacy", units: 3, icr_g_per_ie_at_log: null })],
      { carbUnit: "BE", icrGperIE: 12 },
    );
    const headers = headerCells(csv);
    const idx = headers.findIndex((h) => h.startsWith("icr_"));
    expect(csv.split("\r\n")[1].split(",")[idx]).toBe("—");
  });

  // ── CF suppression ──────────────────────────────────────────────
  for (const { name, opts } of [
    { name: "no opts at all",        opts: {} },
    { name: "cfMgdlPerIE = null",    opts: { cfMgdlPerIE: null } },
    { name: "cfMgdlPerIE = 0",       opts: { cfMgdlPerIE: 0 } },
    { name: "cfMgdlPerIE = -50",     opts: { cfMgdlPerIE: -50 } },
    { name: "cfMgdlPerIE = NaN",     opts: { cfMgdlPerIE: Number.NaN } },
  ]) {
    test(`hides the CF column when ${name}`, () => {
      const csv = insulinToCSV(logs, opts);
      const headers = headerCells(csv);
      expect(headers).not.toContain("cf_mgdl_per_ie (mg/dL/IE)");
      expect(headers.some((h) => h.startsWith("cf_"))).toBe(false);
    });
  }

  test("shows the CF column independently of carbUnit / ICR", () => {
    // CF is glucose-per-insulin, not carb-per-insulin, so it must
    // emit even when the user has no carbUnit or no ICR set.
    const csv = insulinToCSV(logs, { cfMgdlPerIE: 50 });
    const headers = headerCells(csv);
    expect(headers).toContain("cf_mgdl_per_ie (mg/dL/IE)");
    // No ICR header leaked in.
    expect(headers.some((h) => h.startsWith("icr_"))).toBe(false);
    const idx = headers.indexOf("cf_mgdl_per_ie (mg/dL/IE)");
    expect(csv.split("\r\n")[1].split(",")[idx]).toBe("50");
  });

  test("emits both ICR (per-row) and CF when both carbUnit and CF are configured", () => {
    // Use a fixture with a snapshot so both columns have real values.
    const csv = insulinToCSV(logsWithSnapshot, {
      carbUnit: "BE",
      cfMgdlPerIE: 50,
    });
    const headers = headerCells(csv);
    expect(headers).toContain("icr_be_per_ie (BE/IE)");
    expect(headers).toContain("cf_mgdl_per_ie (mg/dL/IE)");
    // ICR sits before CF (per the export.ts spread order). Lock
    // that in too — clinicians visually scanning a column header
    // expect a stable left-to-right reading order.
    expect(headers.indexOf("icr_be_per_ie (BE/IE)"))
      .toBeLessThan(headers.indexOf("cf_mgdl_per_ie (mg/dL/IE)"));
    const row = csv.split("\r\n")[1].split(",");
    // ICR cell = row snapshot (12 g/IE → 1 BE/IE), CF cell = opts value.
    expect(row[headers.indexOf("icr_be_per_ie (BE/IE)")]).toBe("1");
    expect(row[headers.indexOf("cf_mgdl_per_ie (mg/dL/IE)")]).toBe("50");
  });
});

/* ──────────────────────────────────────────────────────────────────
   3. `<GlevReport>` cover meta block — ICR + Korrekturfaktor
   ──────────────────────────────────────────────────────────────────
   Same finite-positive guard rule as the CSV exporter, just rendered
   as JSX text leaves. We walk the React-PDF element tree (no actual
   PDF rendering) to assert the meta items appear / are suppressed.
   ────────────────────────────────────────────────────────────────── */

/**
 * Recursively collect every string / number leaf reachable through
 * `props.children`. Custom function components are NOT invoked — we
 * only inspect the JSX tree as authored. Sufficient because the meta
 * block is built from React-PDF primitives directly inside `GlevReport`.
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
 * True if any element in the tree contains the given label as one of
 * its text leaves. Used as a presence check for meta-item labels —
 * if "ICR (aktuell)" doesn't appear anywhere in the tree, the meta
 * item is definitely not rendered.
 */
function treeContainsLabel(node: ReactNode, label: string): boolean {
  return collectStrings(node).includes(label);
}

/**
 * True if some element in the tree is a "tight container" whose text
 * leaves are exactly `[label, value]` (in any order). Used to assert
 * the meta value sits next to its label inside the same `<View
 * style={styles.metaItem}>` (a 2-leaf container) — not somewhere
 * unrelated like a table header.
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

const baseProps = {
  email: "patient@example.com",
  meals: [] as Meal[],
  insulin: [] as InsulinLog[],
  exercise: [] as ExerciseLog[],
  fingersticks: [] as FingerstickReading[],
};

test.describe("GlevReport cover — ICR (aktuell) line", () => {
  for (const { name, icr } of [
    { name: "default props (icrGperIE undefined)", icr: undefined },
    { name: "icrGperIE = null",                    icr: null },
    { name: "icrGperIE = 0",                       icr: 0 },
    { name: "icrGperIE = -10 (negative)",          icr: -10 },
    { name: "icrGperIE = NaN",                     icr: Number.NaN },
  ]) {
    test(`is suppressed when ${name}`, () => {
      const tree = GlevReport({
        ...baseProps,
        carbUnit: "BE",
        icrGperIE: icr as number | null | undefined,
      }) as ReactElement;
      // Label string must not appear anywhere on the cover when
      // ICR is unconfigured — otherwise a clinician would see a
      // bare "ICR (aktuell): —" or, worse, a misleading "0 BE/IE".
      expect(treeContainsLabel(tree, "ICR (aktuell)")).toBe(false);
    });
  }

  for (const { unit, expected } of [
    { unit: "g"  as const, expected: "24 g KH/IE" },
    { unit: "BE" as const, expected: "2 BE/IE" },
    { unit: "KE" as const, expected: "2.4 KE/IE" },
  ]) {
    test(`renders "${expected}" when icrGperIE=24 and carbUnit=${unit}`, () => {
      const tree = GlevReport({
        ...baseProps,
        carbUnit: unit,
        icrGperIE: 24,
      }) as ReactElement;
      expect(
        hasTightLabelValuePair(tree, "ICR (aktuell)", expected),
      ).toBe(true);
    });
  }
});

test.describe("GlevReport cover — Korrekturfaktor line", () => {
  for (const { name, cf } of [
    { name: "default props (cfMgdlPerIE undefined)", cf: undefined },
    { name: "cfMgdlPerIE = null",                    cf: null },
    { name: "cfMgdlPerIE = 0",                       cf: 0 },
    { name: "cfMgdlPerIE = -50 (negative)",          cf: -50 },
    { name: "cfMgdlPerIE = NaN",                     cf: Number.NaN },
  ]) {
    test(`is suppressed when ${name}`, () => {
      const tree = GlevReport({
        ...baseProps,
        cfMgdlPerIE: cf as number | null | undefined,
      }) as ReactElement;
      expect(treeContainsLabel(tree, "Korrekturfaktor")).toBe(false);
    });
  }

  test("renders \"50 mg/dL/IE\" when cfMgdlPerIE=50", () => {
    const tree = GlevReport({
      ...baseProps,
      cfMgdlPerIE: 50,
    }) as ReactElement;
    expect(
      hasTightLabelValuePair(tree, "Korrekturfaktor", "50 mg/dL/IE"),
    ).toBe(true);
  });

  test("preserves a fractional CF value (47.5 → \"47.5 mg/dL/IE\")", () => {
    // The .toFixed(1) → Number(...) round-trip in pdfReport.tsx is
    // there so a half-step value reads "47.5", not "47.5000…". Lock
    // it in so a future formatter swap can't silently drop the .5.
    const tree = GlevReport({
      ...baseProps,
      cfMgdlPerIE: 47.5,
    }) as ReactElement;
    expect(
      hasTightLabelValuePair(tree, "Korrekturfaktor", "47.5 mg/dL/IE"),
    ).toBe(true);
  });
});

test.describe("GlevReport cover — ICR and Korrekturfaktor are independent", () => {
  test("ICR alone: ICR rendered, Korrekturfaktor suppressed", () => {
    const tree = GlevReport({
      ...baseProps,
      carbUnit: "BE",
      icrGperIE: 12,
      cfMgdlPerIE: null,
    }) as ReactElement;
    expect(treeContainsLabel(tree, "ICR (aktuell)")).toBe(true);
    expect(treeContainsLabel(tree, "Korrekturfaktor")).toBe(false);
  });

  test("CF alone: Korrekturfaktor rendered, ICR suppressed", () => {
    const tree = GlevReport({
      ...baseProps,
      carbUnit: "BE",
      icrGperIE: null,
      cfMgdlPerIE: 50,
    }) as ReactElement;
    expect(treeContainsLabel(tree, "ICR (aktuell)")).toBe(false);
    expect(treeContainsLabel(tree, "Korrekturfaktor")).toBe(true);
  });

  test("both: ICR and Korrekturfaktor both rendered with correct values", () => {
    const tree = GlevReport({
      ...baseProps,
      carbUnit: "BE",
      icrGperIE: 12,
      cfMgdlPerIE: 50,
    }) as ReactElement;
    expect(hasTightLabelValuePair(tree, "ICR (aktuell)", "1 BE/IE")).toBe(true);
    expect(hasTightLabelValuePair(tree, "Korrekturfaktor", "50 mg/dL/IE")).toBe(true);
  });

  test("neither configured: both lines absent (only the always-on meta items remain)", () => {
    const tree = GlevReport(baseProps) as ReactElement;
    expect(treeContainsLabel(tree, "ICR (aktuell)")).toBe(false);
    expect(treeContainsLabel(tree, "Korrekturfaktor")).toBe(false);
    // Sanity: the always-on meta labels still render so we know the
    // tree wasn't somehow stripped by an upstream change. (The carb-
    // unit confirmation moved out of the meta block into a chip
    // next to the Insights heading — see Task #165 — so we can no
    // longer use "Kohlenhydrat-Einheit" as the always-on canary;
    // "Erstellt am" is the next always-on meta item.)
    expect(treeContainsLabel(tree, "Patient")).toBe(true);
    expect(treeContainsLabel(tree, "Erstellt am")).toBe(true);
  });
});

// buildCSVZip — bulk "All as CSV" bundling. Verifies each input file
// becomes a separate zip entry under its given filename, with the
// UTF-8 BOM intact so an extracted CSV opens cleanly in Excel.

test.describe("buildCSVZip", () => {
  test("bundles every input file under its given filename, preserving content + BOM", async () => {
    const files: Array<[string, string]> = [
      ["a.csv", "header1,header2\r\n1,2"],
      ["b.csv", "x,y\r\nÄpfel,€"],
      ["empty.csv", ""],
    ];
    const bytes = await buildCSVZip(files);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const { default: JSZip } = await import("jszip");
    const reopened = await JSZip.loadAsync(bytes);
    const names = Object.keys(reopened.files).sort();
    expect(names).toEqual(["a.csv", "b.csv", "empty.csv"]);

    for (const [name, content] of files) {
      const entry = reopened.file(name);
      expect(entry, `missing zip entry ${name}`).not.toBeNull();
      const text = await entry!.async("string");
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.slice(1)).toBe(content);
    }
  });

  test("empty file list still produces a valid (empty) archive", async () => {
    const bytes = await buildCSVZip([]);
    const { default: JSZip } = await import("jszip");
    const reopened = await JSZip.loadAsync(bytes);
    expect(Object.keys(reopened.files)).toEqual([]);
  });
});
