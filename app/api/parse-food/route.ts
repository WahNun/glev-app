import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `Nutrition parser for a Type 1 Diabetes app. Given a free-form food description, return ONLY JSON matching this schema:
{
  "items":   [{"name":string,"grams":number,"carbs":number,"protein":number,"fat":number,"fiber":number}],
  "totals":  {"carbs":number,"protein":number,"fat":number,"fiber":number,"calories":number},
  "mealType": "FAST_CARBS"|"HIGH_FAT"|"HIGH_PROTEIN"|"BALANCED",
  "summary": string
}
Use typical serving sizes when vague (banana=120g, handful of nuts=28g). Values per USDA per 100g.
Classify whole meal:
  FAST_CARBS    → simple sugars dominate (sugars/carbs>0.6 && fiber<5g): bread, rice, juice, candy
  HIGH_FAT      → fat_kcal/total_kcal>0.45: pizza, fried, cheese-heavy, nuts, butter, oil
  HIGH_PROTEIN  → protein>carbs && protein>25g: steak, chicken, eggs, shakes
  BALANCED      → otherwise
Round all numbers to whole integers. Calories = carbs*4+protein*4+fat*9. No markdown, no code fence.`;

const TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: text },
      ],
    }, { timeout: TIMEOUT_MS });

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
