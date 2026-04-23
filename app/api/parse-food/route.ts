import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a nutrition parser for a Type 1 Diabetes management app.
Given a free-form description of food, extract each item with its weight and macro nutrients.
Use typical serving sizes when vague (e.g. "a banana" = 120g, "handful of nuts" = 28g).
Cross-check values against standard USDA / food-label values per 100g for each ingredient.
Also classify the WHOLE meal into exactly one of these 4 categories:
  - FAST_CARBS    — simple sugars dominate (white rice, bread, juice, candy, pastries)
  - HIGH_FAT      — fat is the largest energy source (pizza, fried food, cheese-heavy, nuts)
  - HIGH_PROTEIN  — protein is the dominant macro by grams (steak, chicken, eggs, shakes)
  - BALANCED      — none of the above; reasonable mix of carbs/protein/fat
Classification rule of thumb:
  - if (sugars / total_carbs > 0.6 && fiber < 5g)            => FAST_CARBS
  - else if (fat_kcal / total_kcal > 0.45)                    => HIGH_FAT
  - else if (protein_grams > carb_grams && protein_grams > 25) => HIGH_PROTEIN
  - else                                                       => BALANCED

Return ONLY valid JSON — no markdown, no explanation, no code block.
Schema:
{
  "items":   [{"name": string, "grams": number, "carbs": number, "protein": number, "fat": number, "fiber": number}],
  "totals":  {"carbs": number, "protein": number, "fat": number, "fiber": number, "calories": number},
  "mealType": "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED",
  "summary": string  // 1-2 sentence plain-English breakdown for a chat bubble
}
Round all gram/calorie values to nearest whole number. Calories use 4/4/9 kcal per g (carb/protein/fat).`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: text },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

    let result: {
      items?: Array<{ name: string; grams: number; carbs?: number; protein?: number; fat?: number; fiber?: number }>;
      totals?: { carbs?: number; protein?: number; fat?: number; fiber?: number; calories?: number };
      mealType?: "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";
      summary?: string;
    } = {};
    try {
      const j = JSON.parse(cleaned);
      // Backwards-compat: accept legacy plain-array response too.
      if (Array.isArray(j)) result = { items: j };
      else result = j;
    } catch {
      return NextResponse.json({ error: "LLM returned unparseable JSON", raw }, { status: 422 });
    }

    const items = Array.isArray(result.items) ? result.items : [];
    // Preserve old `parsed` field so existing client code still works.
    return NextResponse.json({
      raw,
      parsed: items,
      items,
      totals: result.totals ?? null,
      mealType: result.mealType ?? null,
      summary: result.summary ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
