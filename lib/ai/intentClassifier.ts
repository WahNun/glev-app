/**
 * Voice Intent Classifier
 *
 * Classifies a voice transcript into one of the Glev intent types.
 * Uses a two-stage approach:
 *   1. Fast-path regex heuristics for the most common utterances —
 *      no network round-trip required.
 *   2. Mistral classification via POST /api/ai/classify-intent for
 *      everything that doesn't match a known pattern.
 *
 * All write intents (log_bolus, log_meal, log_exercise, log_symptom,
 * edit_macro) still require an explicit user tap before any data is
 * written (compliance principle D-003).
 */

export type IntentType =
  | "log_bolus"
  | "log_meal"
  | "log_exercise"
  | "log_symptom"
  | "edit_macro"
  | "navigate"
  | "fallback_chat";

export interface BolusPayload {
  units: number;
  insulin_name?: string;
  notes?: string;
}

export interface MealPayload {
  input_text: string;
  carbs_grams?: number;
  protein_grams?: number;
  fat_grams?: number;
}

export interface ExercisePayload {
  duration_minutes?: number;
  exercise_type?: string;
  intensity?: "low" | "medium" | "high";
}

export interface SymptomPayload {
  symptom_types?: string[];
}

export interface EditMacroPayload {
  field: "carbs" | "protein" | "fat" | "calories";
  value: number;
}

export interface NavigatePayload {
  screen: string;
}

export type IntentEnvelope =
  | { type: "log_bolus"; payload: BolusPayload }
  | { type: "log_meal"; payload: MealPayload }
  | { type: "log_exercise"; payload: ExercisePayload }
  | { type: "log_symptom"; payload: SymptomPayload }
  | { type: "edit_macro"; payload: EditMacroPayload }
  | { type: "navigate"; payload: NavigatePayload }
  | { type: "fallback_chat"; payload: { transcript: string } };

// ── Fast-path regex heuristics ─────────────────────────────────────────────
//
// These patterns catch the most common utterances without a network call.
// They must be conservative: a false-positive bolus classification when
// the user is asking a question would be confusing and potentially dangerous.

// "4 Einheiten Novorapid" / "5 IE" / "3.5 Units Fiasp" / "2u"
const BOLUS_RE =
  /^(\d+(?:[.,]\d+)?)\s*(ie|einheit(?:en)?|units?|u\b)(?:\s+(.+))?$/i;

// Navigate: "Geh zu Insights" / "Öffne Dashboard" / "Zeig mir Einstellungen"
// Optional German prepositions (zu, nach) and English "to" are skipped so both
// "Geh Dashboard" and "Geh zu Dashboard" are handled by the same pattern.
const NAVIGATE_RE =
  /(?:geh?|öffne?|zeig(?:e)?(?:\s+mir)?|go\s+to|open|show)\s+(?:zu\s+|nach\s+)?(dashboard|entries|engine|insights|settings|einstellung(?:en)?)/i;

const NAVIGATE_SCREEN_MAP: Record<string, string> = {
  dashboard: "dashboard",
  entries: "entries",
  engine: "engine",
  insights: "insights",
  settings: "settings",
  einstellung: "settings",
  einstellungen: "settings",
};

/**
 * Try a cheap regex classification before making a network call.
 * Returns null if the utterance doesn't match any known fast-path pattern.
 */
function tryFastPath(transcript: string): IntentEnvelope | null {
  const t = transcript.trim();

  // Bolus: must start with a number followed by a unit keyword.
  const bolusMm = t.match(BOLUS_RE);
  if (bolusMm) {
    const raw = bolusMm[1] ?? "0";
    const units = parseFloat(raw.replace(",", "."));
    if (units > 0 && units <= 100) {
      const insulin_name = bolusMm[3]?.trim() || undefined;
      return { type: "log_bolus", payload: { units, insulin_name } };
    }
  }

  // Navigate: explicit navigation verbs.
  const navMm = t.match(NAVIGATE_RE);
  if (navMm) {
    const raw = (navMm[1] ?? "").toLowerCase();
    const screen = NAVIGATE_SCREEN_MAP[raw] ?? raw;
    return { type: "navigate", payload: { screen } };
  }

  return null;
}

/**
 * Classify a voice transcript into an IntentEnvelope.
 *
 * 1. Tries fast-path regex (no network call, < 1 ms).
 * 2. On no match, calls POST /api/ai/classify-intent (Mistral, ~500 ms).
 * 3. On any error, returns { type: "fallback_chat" } so the caller can
 *    fall through to the normal chat pipeline.
 */
export async function classifyIntent(
  transcript: string,
): Promise<IntentEnvelope> {
  const fast = tryFastPath(transcript);
  if (fast) return fast;

  try {
    const res = await fetch("/api/ai/classify-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) {
      return { type: "fallback_chat", payload: { transcript } };
    }
    const data = (await res.json()) as { intent?: IntentEnvelope };
    const intent = data.intent;
    if (intent && typeof intent.type === "string") return intent;
  } catch {
    // Network error or JSON parse failure — fall through to chat.
  }

  return { type: "fallback_chat", payload: { transcript } };
}
