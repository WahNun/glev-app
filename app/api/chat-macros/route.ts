import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

const SYSTEM_PROMPT = `You are a friendly, concise nutrition assistant inside a Type 1 Diabetes
insulin-decision app. The user has just logged a meal. Your job is to:

1. Briefly explain WHY the macros were calculated the way they were (cite typical
   USDA / food-label values per 100g, portion-size assumptions, and any approximations).
2. Answer follow-up questions and accept corrections like "that banana was bigger"
   or "I had no fiber".
3. When the user gives a correction, propose updated macros.

Always be conversational and short — 2-4 sentences max per reply unless asked.
Do NOT lecture about insulin dosing — that is handled elsewhere in the app.

Return ONLY valid JSON (no markdown, no code block) of this shape:
{
  "reply":  string,                                     // your chat response
  "macros": { "carbs": number, "protein": number,       // OPTIONAL — only when
              "fat":   number, "fiber":   number }      // a correction was applied
}
If no macro change is warranted, OMIT the "macros" key entirely.`;

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
    let parsed: { reply?: string; macros?: { carbs?: number; protein?: number; fat?: number; fiber?: number } } = {};
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { reply: cleaned || "Sorry — I couldn't form a response." }; }

    return NextResponse.json({
      reply:  parsed.reply  ?? "",
      macros: parsed.macros ?? null,
      raw,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
