import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { SYSTEM_PROMPT } from "@/lib/ai/systemPrompt";

const TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  let openai;
  try { openai = getOpenAIClient(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }

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
