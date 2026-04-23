import { getOpenAIClient } from "@/lib/ai/openaiClient";

export interface MacroEstimate {
  protein: number;
  fat: number;
  fiber: number;
  calories: number;
}

const SYSTEM_PROMPT = `You are a nutrition estimator for a Type 1 Diabetes app.
Given a meal description (free-form ingredient list with grams) and the known total carbohydrates in grams, estimate the remaining macros for the WHOLE meal.
Use standard USDA / food-label values for each ingredient at the stated weight.
Return ONLY valid JSON — no markdown, no explanation, no code fences.
Schema: {"protein": number, "fat": number, "fiber": number, "calories": number}
All values are grams (calories in kcal). Round to nearest whole number.
If the description is empty, vague, or impossible to estimate, return all zeros.`;

/**
 * Estimate protein/fat/fiber/calories for a meal given its description and known carbs.
 * Used to enrich imported rows that are missing macro data. Returns null on failure
 * so callers can fall back to whatever they already have.
 */
export async function enrichMealMacros(
  description: string,
  knownCarbsGrams: number,
): Promise<MacroEstimate | null> {
  if (!description?.trim()) return null;

  let openai;
  try { openai = getOpenAIClient(); } catch { return null; }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Meal: ${description.trim()}\nKnown total carbs: ${knownCarbsGrams}g\nReturn the JSON.`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<MacroEstimate>;
    return {
      protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
      fat:     Math.max(0, Math.round(Number(parsed.fat)     || 0)),
      fiber:   Math.max(0, Math.round(Number(parsed.fiber)   || 0)),
      calories:Math.max(0, Math.round(Number(parsed.calories)|| 0)),
    };
  } catch {
    return null;
  }
}

/**
 * Run enrichMealMacros over many meals with bounded concurrency so a 100-row
 * import doesn't fire 100 simultaneous OpenAI calls.
 */
export async function enrichMacrosBatch<T extends { inputText: string; carbs: number }>(
  items: T[],
  shouldEnrich: (item: T) => boolean,
  concurrency = 4,
): Promise<Map<number, MacroEstimate>> {
  const results = new Map<number, MacroEstimate>();
  const queue: number[] = [];
  items.forEach((item, idx) => { if (shouldEnrich(item)) queue.push(idx); });

  async function worker() {
    while (queue.length) {
      const idx = queue.shift();
      if (idx === undefined) break;
      const item = items[idx];
      const estimate = await enrichMealMacros(item.inputText, item.carbs);
      if (estimate) results.set(idx, estimate);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}
