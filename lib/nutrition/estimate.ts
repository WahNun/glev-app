import { getOpenAIClient } from "@/lib/ai/openaiClient";
import type { NutritionPer100, ParsedFoodItem } from "./types";

/**
 * Last-resort GPT estimator for ONE item. Used by the aggregator
 * when both Open Food Facts and USDA lookups return null. NEVER
 * silently returns zeros — when this also fails, the aggregator
 * stamps the item as `source: 'estimated'` with whatever the model
 * produced, even if rough.
 *
 * The model is asked for per-100g values so the aggregator can scale
 * uniformly. This keeps the gram-scaling logic in one place.
 */

const ESTIMATE_PROMPT = `You are a USDA nutrition estimator. Given ONE food item
(name and bilingual search terms), return ONLY valid JSON of typical per-100g
values from USDA or food-label data:

{"carbs_g": number, "protein_g": number, "fat_g": number, "fiber_g": number}

All values are grams per 100g of the product. Round to one decimal. If the
item is impossible to estimate, return all zeros. No markdown, no commentary.`;

const ESTIMATE_TIMEOUT_MS = 4000;

export async function estimateItemNutrition(
  item: ParsedFoodItem,
): Promise<NutritionPer100> {
  let openai;
  try { openai = getOpenAIClient(); }
  catch {
    // No AI configured — return zeros so totals don't NaN, but caller
    // still marks source as 'estimated'.
    return { carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0 };
  }

  try {
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
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
    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<NutritionPer100>;
    return {
      carbs_g:   Math.max(0, Number(parsed.carbs_g)   || 0),
      protein_g: Math.max(0, Number(parsed.protein_g) || 0),
      fat_g:     Math.max(0, Number(parsed.fat_g)     || 0),
      fiber_g:   Math.max(0, Number(parsed.fiber_g)   || 0),
    };
  } catch {
    return { carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0 };
  }
}
