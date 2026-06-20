import { getMistralChatClient } from "@/lib/ai/openaiClient";
import type { NutritionPer100, ParsedFoodItem } from "./types";

/**
 * Last-resort GPT estimator for ONE item. Used by the aggregator when
 * both Open Food Facts and USDA lookups return null.
 *
 * SAFETY CONTRACT (T1D): this function NEVER returns silent zeros. If
 * the estimator can't produce a reasonable answer it THROWS, and the
 * aggregator catches and tags the item as `source: 'unknown'`. The UI
 * then refuses to auto-populate insulin-dosing inputs from those
 * totals — the user must enter values manually.
 *
 * The model returns per-100g values so the aggregator can scale
 * uniformly. Keeping the gram-scaling in one place avoids drift.
 */

export class NutritionEstimateError extends Error {
  constructor(message: string, public readonly item: string) {
    super(message);
    this.name = "NutritionEstimateError";
  }
}

// Trimmed prompt — schema is now enforced by strict json_schema below,
// so the prompt only describes intent. The previous IMPOSSIBLE-string
// escape hatch is gone; the existing "all zeros = decline" guard at
// the bottom of this file still catches "I don't know" responses
// without breaking the strict JSON contract.
const ESTIMATE_PROMPT = `You are a USDA nutrition estimator. Given ONE food
item (name plus bilingual search terms), return typical per-100g values from
USDA / food-label data. Round to one decimal. If you cannot estimate
confidently, return all zeros — the caller will treat that as a decline.`;

const ESTIMATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["carbs_g", "protein_g", "fat_g", "fiber_g"],
  properties: {
    carbs_g:   { type: "number" },
    protein_g: { type: "number" },
    fat_g:     { type: "number" },
    fiber_g:   { type: "number" },
  },
} as const;

const ESTIMATE_TIMEOUT_MS = 4000;

export async function estimateItemNutrition(
  item: ParsedFoodItem,
): Promise<NutritionPer100> {
  let openai;
  try { openai = getMistralChatClient(); }
  catch (e) {
    // Configuration failure (missing API key etc) — must NOT default
    // to zeros for a T1D dosing app. Surface to the aggregator so
    // the item is marked 'unknown' and the UI requires manual entry.
    const msg = e instanceof Error ? e.message : "Mistral client unavailable";
    throw new NutritionEstimateError(`Estimator init failed: ${msg}`, item.name);
  }

  let raw = "";
  try {
    const completion = await openai.chat.completions.create(
      {
        model: "mistral-small-latest",
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 100,
        messages: [
          { role: "system", content: ESTIMATE_PROMPT },
          {
            role: "user",
            content: `Item: ${item.name}\nEN: ${item.search_term_en}\nDE: ${item.search_term_de}\nReturn the JSON.`,
          },
        ],
      },
      { timeout: ESTIMATE_TIMEOUT_MS },
    );
    raw = completion.choices[0]?.message?.content ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI request failed";
    throw new NutritionEstimateError(`Estimator API failed: ${msg}`, item.name);
  }

  let parsed: Partial<NutritionPer100>;
  try {
    parsed = JSON.parse(raw) as Partial<NutritionPer100>;
  } catch {
    throw new NutritionEstimateError(`Estimator returned malformed JSON for ${item.name}`, item.name);
  }

  const carbs   = Number(parsed.carbs_g);
  const protein = Number(parsed.protein_g);
  const fat     = Number(parsed.fat_g);
  const fiber   = Number(parsed.fiber_g);

  // Refuse to accept "all zeros" as a valid estimate — that's the
  // exact silent-failure pattern the safety contract forbids. A real
  // food has SOME macros per 100g; a 0/0/0 response is the model
  // equivalent of "I don't know".
  if (![carbs, protein, fat].some((v) => Number.isFinite(v) && v > 0)) {
    throw new NutritionEstimateError(`Estimator returned all-zero macros for ${item.name}`, item.name);
  }

  return {
    carbs_g:   Math.max(0, Number.isFinite(carbs)   ? carbs   : 0),
    protein_g: Math.max(0, Number.isFinite(protein) ? protein : 0),
    fat_g:     Math.max(0, Number.isFinite(fat)     ? fat     : 0),
    fiber_g:   Math.max(0, Number.isFinite(fiber)   ? fiber   : 0),
  };
}
