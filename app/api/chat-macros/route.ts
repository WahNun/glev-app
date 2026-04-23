import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

const SYSTEM_PROMPT = `You are a friendly, concise nutrition assistant inside a Type 1 Diabetes
insulin-decision app. The user has just logged a meal. Your job is to:

1. Briefly explain WHY the macros were calculated the way they were (cite typical
   USDA / food-label values per 100g, portion-size assumptions, and any approximations).
2. Accept corrections like "that banana was bigger" or "I had no fiber".
3. Accept brand-new meal descriptions in chat ("einhundert Gramm Hühnerfleisch")
   and treat them as the new authoritative meal — recompute macros from scratch.

Always be conversational and short — 2-4 sentences max per reply unless asked.
Do NOT lecture about insulin dosing — that is handled elsewhere in the app.

Return ONLY valid JSON (no markdown, no code block) of this shape:
{
  "reply":  string,
  "macros": { "carbs": number, "protein": number,
              "fat":   number, "fiber":   number,
              "calories": number }
}

CRITICAL macro rules:
- ALWAYS include the "macros" key whenever your reply discusses food, portions,
  or any nutritional content — even if the user just confirmed or rephrased the
  same meal. The UI uses this object to keep its fields in sync, and a missing
  "macros" key leaves stale numbers on screen.
- "carbs", "protein", "fat" are REQUIRED numeric grams (use 0, never null).
- "fiber" and "calories" are required numeric values; estimate them from the
  food described.
- Only OMIT the "macros" key for pure meta questions ("why?", "explain") that
  don't change the underlying food. When in doubt, INCLUDE the macros.`;

interface ChatMessage { role: "user" | "assistant" | "system"; content: string }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    messages?: ChatMessage[];
    macros?:   { carbs?: number; protein?: number; fat?: number; fiber?: number };
    description?: string;
  };

  const history = Array.isArray(body.messages) ? body.messages.filter(m => m && typeof m.content === "string") : [];
  if (history.length === 0) return NextResponse.json({ error: "messages required" }, { status: 400 });

  const ctx: ChatMessage = {
    role: "system",
    content: `Current entry context:
  description: ${body.description || "(none)"}
  carbs:   ${body.macros?.carbs   ?? 0}g
  protein: ${body.macros?.protein ?? 0}g
  fat:     ${body.macros?.fat     ?? 0}g
  fiber:   ${body.macros?.fiber   ?? 0}g`,
  };

  let openai;
  try { openai = getOpenAIClient(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ctx,
        ...history,
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    let parsed: { reply?: string; macros?: { carbs?: number; protein?: number; fat?: number; fiber?: number; calories?: number } } = {};
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { reply: cleaned || "Sorry — I couldn't form a response." }; }

    // A response is "valid" only when carbs, protein and fat are all finite
    // numbers. We forward null for any malformed payload so the client can
    // safely ignore stale/garbage updates.
    const m = parsed.macros;
    const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    const validMacros = m && isNum(m.carbs) && isNum(m.protein) && isNum(m.fat)
      ? {
          carbs:    Math.max(0, Math.round(m.carbs)),
          protein:  Math.max(0, Math.round(m.protein)),
          fat:      Math.max(0, Math.round(m.fat)),
          fiber:    isNum(m.fiber)    ? Math.max(0, Math.round(m.fiber))    : 0,
          calories: isNum(m.calories) ? Math.max(0, Math.round(m.calories)) : 0,
        }
      : null;

    return NextResponse.json({
      reply:  parsed.reply  ?? "",
      macros: validMacros,
      raw,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
