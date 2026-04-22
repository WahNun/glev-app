import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a nutrition parser for a Type 1 Diabetes management app.
Given a free-form description of food, extract each item with its weight and macro nutrients.
Use typical serving sizes when vague (e.g. "a banana" = 120g, "handful of nuts" = 28g).
Return ONLY valid JSON — no markdown, no explanation, no code block.
The JSON must be an array of objects with these exact keys:
[{"name": string, "grams": number, "carbs": number, "protein": number, "fat": number, "fiber": number}]
- grams: total weight of that food item
- carbs/protein/fat/fiber: grams of that macro in this serving
Round all values to nearest whole number.`;

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

    let parsed: { name: string; grams: number }[] = [];
    try {
      const result = JSON.parse(raw);
      parsed = Array.isArray(result) ? result : [];
    } catch {
      return NextResponse.json({ error: "LLM returned unparseable JSON", raw }, { status: 422 });
    }

    return NextResponse.json({ raw, parsed });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
