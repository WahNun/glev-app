import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { SYSTEM_PROMPT } from "@/lib/ai/systemPrompt";

const TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const { text } = body as { text?: string };

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const tBody = Date.now();
  // eslint-disable-next-line no-console
  console.log("[PERF parse-food] body parse:", tBody - t0, "ms · input len:", text.length, "chars");

  let openai;
  try { openai = getOpenAIClient(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }

  const tInit = Date.now();
  // eslint-disable-next-line no-console
  console.log("[PERF parse-food] openai init:", tInit - tBody, "ms");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 350,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: text },
      ],
    }, { timeout: TIMEOUT_MS });

    const tGpt = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF parse-food] GPT-4o-mini call:", tGpt - tInit, "ms");

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

    let result: {
      items?: Array<{ name: string; grams: number; carbs?: number; protein?: number; fat?: number; fiber?: number }>;
      totals?: { carbs?: number; protein?: number; fat?: number; fiber?: number; calories?: number };
      mealType?: "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";
      summary?: string;
      description?: string;
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

    // Always provide a clean, comma-separated meal description. If GPT returned
    // one, trust it; otherwise synthesize from the items so the client never
    // has to fall back to ad-hoc string-building.
    const synthesized = items
      .map((it) => {
        const grams = Number(it.grams);
        const name  = (it.name ?? "").toString().trim();
        if (!name || !Number.isFinite(grams) || grams <= 0) return null;
        return `${Math.round(grams)}g ${name.toLowerCase()}`;
      })
      .filter((s): s is string => !!s)
      .join(", ");
    const description = (result.description && result.description.trim())
      ? result.description.trim()
      : synthesized;

    const tDone = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF parse-food] post-process:", tDone - tGpt, "ms · items:", items.length, "· total:", tDone - t0, "ms");

    // Preserve old `parsed` field so existing client code still works.
    return NextResponse.json({
      raw,
      parsed: items,
      items,
      totals: result.totals ?? null,
      mealType: result.mealType ?? null,
      summary: result.summary ?? null,
      description,
    });
  } catch (err: unknown) {
    const tErr = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF parse-food] FAILED after:", tErr - t0, "ms");
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
