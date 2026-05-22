// Task #514 — Guard against missing Insights translation keys reaching users.
//
// Background: The same class of bug that affected the Engine page (hardcoded
// strings instead of translation keys) can silently affect the Insights page
// too. This test ensures that every `tInsights("…")` literal call in
// `app/(protected)/insights/page.tsx` resolves to an existing key in the
// `insights` namespace of both `messages/de.json` and `messages/en.json`.
//
// Dynamic / template-literal keys are enumerated explicitly below because the
// static regex cannot see through template expressions.  The dynamic calls are:
//   tInsights(`exercise_type_${norm}`)          ExerciseType (normalised)
//   tInsights(`workout_outcome_${key}`)         ExerciseOutcome
//   tInsights(`workout_outcome_label_${oc}`)    ExerciseOutcome (lowercased)
//   tInsights(`workout_tod_${k}`)               TodKey
//   tInsights(`workout_dur_${k}`)               DurKey
//   tInsights(`pattern_${type}_label`)          EnginePatternType
//   tInsights(`pattern_${type}_explanation`)    EnginePatternType
//   tInsights(`cycle_phase_${k}`)               CyclePhase tokens
//   tInsights(`symptom_${s.key}`)               Symptom keys
//
// The test will FAIL when:
//   - a new `tInsights("some_key")` is added to insights/page.tsx without
//     adding the key to both message files, OR
//   - a key is removed from a message file while still referenced in the page.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load source files ────────────────────────────────────────────────────────

const ROOT = process.cwd();

const insightsSource = readFileSync(
  join(ROOT, "app/(protected)/insights/page.tsx"),
  "utf8",
);

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deInsights = deMessages.insights ?? {};
const enInsights = enMessages.insights ?? {};

// ── Extract static literal keys from tInsights("…") calls ───────────────────
//
// Matches: tInsights("some_key") or tInsights( "some_key" )
// Does NOT match template-literal calls — those are handled separately below.

const LITERAL_RE = /tInsights\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(insightsSource)) !== null) {
  staticKeys.add(m[1]);
}

// ── Dynamic / template-literal keys ─────────────────────────────────────────
//
// Each group mirrors the template used in insights/page.tsx and covers the
// full enum domain so the test fails if a new variant is added without a
// translation key.

// exercise_type_${norm}  — "hypertrophy" is normalised to "strength" in the page
const EXERCISE_TYPES = [
  "strength", "cardio", "hiit", "yoga",
  "run", "cycling", "swimming", "breathwork",
  "hot_shower", "cold_shower", "football", "tennis", "volleyball", "basketball",
] as const;

// workout_outcome_${key}  and  workout_outcome_label_${oc}
// ExerciseOutcome values: STABLE | DROPPED | SPIKED | HYPO_RISK
const EXERCISE_OUTCOMES = ["stable", "dropped", "spiked", "hypo_risk"] as const;

// workout_tod_${k}  — TodKey
const TOD_KEYS = ["morning", "afternoon", "evening", "night"] as const;

// workout_dur_${k}  — DurKey
const DUR_KEYS = ["short", "medium", "long"] as const;

// pattern_${type}_label  and  pattern_${type}_explanation
// EnginePatternType values used in insights/page.tsx
const PATTERN_TYPES = [
  "balanced", "overdosing", "underdosing", "spiking", "insufficient_data",
] as const;

// cycle_phase_${k}  — CyclePhase tokens used in phaseCounts
const CYCLE_PHASE_KEYS = [
  "follicular", "ovulation", "luteal", "menstruation", "pms", "other",
] as const;

// symptom_${s.key}  — all symptom keys tracked in the cycle log
const SYMPTOM_KEYS = [
  "headache", "fatigue", "cramps", "nausea", "cravings", "low_mood",
  "sleep_disturbance", "brain_fog", "bloating", "anxiety", "irritability",
  "back_pain", "breast_tenderness", "dizziness", "mouth_dryness",
  "polyuria", "water_retention",
] as const;

const dynamicKeys: string[] = [
  ...EXERCISE_TYPES.map((t) => `exercise_type_${t}`),
  ...EXERCISE_OUTCOMES.map((o) => `workout_outcome_${o}`),
  ...EXERCISE_OUTCOMES.map((o) => `workout_outcome_label_${o}`),
  ...TOD_KEYS.map((k) => `workout_tod_${k}`),
  ...DUR_KEYS.map((k) => `workout_dur_${k}`),
  ...PATTERN_TYPES.map((t) => `pattern_${t}_label`),
  ...PATTERN_TYPES.map((t) => `pattern_${t}_explanation`),
  ...CYCLE_PHASE_KEYS.map((k) => `cycle_phase_${k}`),
  ...SYMPTOM_KEYS.map((k) => `symptom_${k}`),
];

// ── All keys the page depends on ─────────────────────────────────────────────

const allKeys = [...staticKeys, ...new Set(dynamicKeys)];

// ── Tests ────────────────────────────────────────────────────────────────────

test("insights page: extracted a non-empty key set from insights/page.tsx", () => {
  expect(allKeys.length).toBeGreaterThan(0);
});

test("insights page: every tInsights() key is present in messages/de.json", () => {
  const missing = allKeys.filter((k) => !(k in deInsights));
  expect(missing, `Keys missing from de.json insights namespace: ${missing.join(", ")}`).toEqual([]);
});

test("insights page: every tInsights() key is present in messages/en.json", () => {
  const missing = allKeys.filter((k) => !(k in enInsights));
  expect(missing, `Keys missing from en.json insights namespace: ${missing.join(", ")}`).toEqual([]);
});

test("insights page: de.json and en.json insights namespaces have the same keys", () => {
  const deKeys = new Set(Object.keys(deInsights));
  const enKeys = new Set(Object.keys(enInsights));

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
