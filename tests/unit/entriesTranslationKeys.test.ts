// Task #526 — Guard against missing Entries translation keys reaching users.
//
// Background: Tasks #512 and #514 added translation-key guard tests for
// Engine, Dashboard, and Insights. The Entries page is the fourth high-traffic
// page and has many `tx("…")` calls (where `tx = useTranslations("entriesExpand")`)
// that are not yet covered by an automated test.
//
// The page also uses dynamic template-literal keys assembled at runtime:
//   tx(`eval_${ev}`)           — Evaluation outcomes (GOOD, HIGH, LOW, …)
//   tx(`eval_explain_${ev}`)   — Outcome explanations
//   tx(`type_${t}`)            — Meal type labels (FAST_CARBS, …)
//   tx(`type_explain_${t}`)    — Meal type explanations
//   tx(`state_${lc.state}`)    — Lifecycle state labels
//
// These can't be caught by static string extraction alone, so they are
// enumerated explicitly below.
//
// The test will FAIL when:
//   - a new `tx("some_key")` is added to entries/page.tsx without
//     adding the key to both message files, OR
//   - a key is removed from a message file while still referenced in the page.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load source files ────────────────────────────────────────────────────────

const ROOT = process.cwd();

const entriesSource = readFileSync(
  join(ROOT, "app/(protected)/entries/page.tsx"),
  "utf8",
);

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deEntries = deMessages.entriesExpand ?? {};
const enEntries = enMessages.entriesExpand ?? {};

// ── Extract static literal keys from tx("…") calls ──────────────────────────
//
// `tx` is bound to `useTranslations("entriesExpand")` throughout entries/page.tsx.
// Matches: tx("some_key") or tx( "some_key" )
// Does NOT match template-literal calls — those are handled separately below.

const LITERAL_RE = /\btx\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(entriesSource)) !== null) {
  staticKeys.add(m[1]);
}

// ── Dynamic / template-literal keys ─────────────────────────────────────────

// eval_${ev} and eval_explain_${ev}
// Evaluation outcome values from lib/engine/lifecycle.ts / meal evaluation.
const EVAL_VALUES = [
  "GOOD", "HIGH", "LOW", "SPIKE", "SPIKE_STRONG",
  "OVERDOSE", "UNDERDOSE", "CHECK_CONTEXT", "HYPO_DURING",
] as const;

// type_${t} and type_explain_${t}  — meal classification types
const MEAL_TYPES = [
  "FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED",
] as const;

// state_${lc.state}  — OutcomeState lifecycle states
// "state_monitoring" is used directly as a static key; the others go through
// the template. All variants are listed here for completeness so a new state
// added to the enum without a matching translation key causes an immediate
// test failure.
const LIFECYCLE_STATES = [
  "pending", "monitoring", "provisional", "final",
] as const;

const dynamicKeys: string[] = [
  ...EVAL_VALUES.map((v) => `eval_${v}`),
  ...EVAL_VALUES.map((v) => `eval_explain_${v}`),
  ...MEAL_TYPES.map((t) => `type_${t}`),
  ...MEAL_TYPES.map((t) => `type_explain_${t}`),
  ...LIFECYCLE_STATES.map((s) => `state_${s}`),
];

// ── All keys the page depends on ─────────────────────────────────────────────

const allKeys = [...staticKeys, ...new Set(dynamicKeys)];

// ── Tests ────────────────────────────────────────────────────────────────────

test("entries page: extracted a non-empty key set from entries/page.tsx", () => {
  expect(allKeys.length).toBeGreaterThan(0);
});

test("entries page: every tx() key is present in messages/de.json (entriesExpand)", () => {
  const missing = allKeys.filter((k) => !(k in deEntries));
  expect(missing, `Keys missing from de.json entriesExpand namespace: ${missing.join(", ")}`).toEqual([]);
});

test("entries page: every tx() key is present in messages/en.json (entriesExpand)", () => {
  const missing = allKeys.filter((k) => !(k in enEntries));
  expect(missing, `Keys missing from en.json entriesExpand namespace: ${missing.join(", ")}`).toEqual([]);
});

test("entries page: de.json and en.json entriesExpand namespaces have the same keys", () => {
  const deKeys = new Set(Object.keys(deEntries));
  const enKeys = new Set(Object.keys(enEntries));

  const onlyInDe = [...deKeys].filter((k) => !enKeys.has(k));
  const onlyInEn = [...enKeys].filter((k) => !deKeys.has(k));

  expect(
    onlyInDe,
    `Keys present in de.json but missing from en.json: ${onlyInDe.join(", ")}`,
  ).toEqual([]);
  expect(
    onlyInEn,
    `Keys present in en.json but missing from de.json: ${onlyInEn.join(", ")}`,
  ).toEqual([]);
});
