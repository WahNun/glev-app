// Task #281 — Verify chip labels render in German on a DE locale.
//
// Task #279 introduced an i18n-aware `chipLabelsFrom(t)` helper that
// replaces the legacy English-only `getEvalLabel` / `getTypeLabel`
// helpers in UI surfaces (Entries, Dashboard, Insights). The German
// translations live in `messages/de.json` under the `chips` namespace.
//
// A future renamer touching `lib/mealTypes.ts` (e.g. swapping the key
// pattern from `eval_GOOD` to `evalGOOD`) would silently fall through
// to the English fallback in `chipLabelsFrom` without crashing — users
// would just see English chips on a DE app. This test pins the
// translator wiring + the German strings for every outcome and meal
// type so such regressions get caught at CI time.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chipLabelsFrom } from "@/lib/mealTypes";

// Load the production DE catalogue rather than re-typing the strings
// here — the whole point of the test is to assert the catalogue is
// wired up correctly, so any drift between catalogue and code shows up
// as a real failure instead of being masked by a duplicated literal.
const deMessages = JSON.parse(
  readFileSync(join(process.cwd(), "messages/de.json"), "utf8"),
) as Record<string, Record<string, string>>;

const chips = deMessages.chips;

// next-intl's translator throws on missing keys; mirror that contract
// so the safe-wrapper inside `chipLabelsFrom` is exercised the same
// way it is at runtime.
function tDe(key: string): string {
  const v = chips[key];
  if (v == null) throw new Error(`missing chips key: ${key}`);
  return v;
}

const labels = chipLabelsFrom(tDe);

/* ──────────────────────────────────────────────────────────────────
   Outcome (eval) chips — every label currently produced by the
   evaluator + every legacy alias still rendered on historical rows.
   ────────────────────────────────────────────────────────────────── */

const EVAL_CASES: Array<[string, string]> = [
  ["GOOD", "Gut"],
  ["OVERDOSE", "Überdosis"],
  ["UNDERDOSE", "Unterdosis"],
  ["SPIKE", "Spike"],
  ["SPIKE_STRONG", "Starker Spike"],
  ["HYPO_DURING", "Hypo im Verlauf"],
  ["CHECK_CONTEXT", "Prüfen"],
];

for (const [code, expected] of EVAL_CASES) {
  test(`chips DE: eval_${code} → "${expected}"`, () => {
    expect(labels.evalLabel(code)).toBe(expected);
  });
}

/* ──────────────────────────────────────────────────────────────────
   Meal-type chips — the four mutually-exclusive buckets returned by
   `classifyMeal` (FAST_CARBS / HIGH_PROTEIN / HIGH_FAT / BALANCED).
   ────────────────────────────────────────────────────────────────── */

const TYPE_CASES: Array<[string, string]> = [
  ["FAST_CARBS", "Schnelle Kohlenhydrate"],
  ["HIGH_PROTEIN", "Eiweißreich"],
  ["HIGH_FAT", "Fettreich"],
  ["BALANCED", "Ausgewogen"],
];

for (const [code, expected] of TYPE_CASES) {
  test(`chips DE: type_${code} → "${expected}"`, () => {
    expect(labels.typeLabel(code)).toBe(expected);
  });
}

/* ──────────────────────────────────────────────────────────────────
   Explain copy (used as `title` / tooltip on the chip) — confirms the
   `eval_explain_*` / `type_explain_*` keys are wired through too, not
   just the short labels.
   ────────────────────────────────────────────────────────────────── */

test("chips DE: outcome explain copy renders in German", () => {
  expect(labels.evalExplain("GOOD")).toBe(
    "Insulin-Dosis hat zur Kohlenhydratlast gepasst.",
  );
  expect(labels.evalExplain("SPIKE_STRONG")).toBe(
    "Sehr starker Glukose-Anstieg — Höhe oder Geschwindigkeit liegen deutlich über der Schwelle für diese Mahlzeit.",
  );
  expect(labels.evalExplain("HYPO_DURING")).toBe(
    "Glukose ist innerhalb des 3h-Fensters nach der Mahlzeit unter 70 mg/dL gefallen — auch wenn der 2h-Wert wieder im Zielbereich war.",
  );
});

test("chips DE: meal-type explain copy renders in German", () => {
  expect(labels.typeExplain("FAST_CARBS")).toBe(
    "Hohe glykämische Last, wenig Ballaststoffe → schnelle Aufnahme",
  );
  expect(labels.typeExplain("BALANCED")).toBe(
    "Ausgewogene Makro-Verteilung → stabile Glukose-Antwort",
  );
});

/* ──────────────────────────────────────────────────────────────────
   Empty / null inputs keep returning the neutral placeholder rather
   than throwing — same contract as the legacy English helpers.
   ────────────────────────────────────────────────────────────────── */

test("chips DE: empty inputs return placeholder, not a crash", () => {
  expect(labels.evalLabel(null)).toBe("—");
  expect(labels.evalLabel(undefined)).toBe("—");
  expect(labels.typeLabel(null)).toBe("—");
  expect(labels.typeLabel(undefined)).toBe("—");
  expect(labels.evalExplain(null)).toBe("");
  expect(labels.typeExplain(null)).toBe("");
});
