import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

const SYSTEM_PROMPT = `You are a friendly, concise nutrition assistant inside a Type 1 Diabetes
insulin-decision app. The user has just logged a meal and is now refining it
with you. Your job is to:

1. Briefly explain WHY the macros were calculated the way they were (cite typical
   USDA / food-label values per 100g, portion-size assumptions, and any approximations).
2. Accept corrections like "that banana was bigger" or "I had no fiber".
3. Accept brand-new meal descriptions in chat ("einhundert Gramm Hühnerfleisch")
   and treat them as the new authoritative meal — recompute macros from scratch.

You are refining an existing meal log. EVERY user message that describes food
in any way — adding ingredients, removing ingredients, correcting portion sizes,
re-stating the meal, or starting over — MUST produce a full, atomic "macros"
object containing the totals for the COMPLETE updated meal (not deltas) AND a
"description" field listing every current ingredient. Treat language like
"aktualisiere", "update", "ich hatte auch", "no actually", "scratch that",
"add", "remove", "more", "less", or any quantity restatement as a food
correction that requires a fresh macros payload.

Always be conversational and short — 2-4 sentences max per reply unless asked.
Do NOT lecture about insulin dosing — that is handled elsewhere in the app.

Return ONLY valid JSON (no markdown, no code block) of this shape:
{
  "reply":  string,
  "macros": { "carbs": number, "protein": number,
              "fat":   number, "fiber":   number,
              "calories": number },
  "description": string
}

CRITICAL rules:
- ALWAYS include the "macros" key whenever your reply discusses food, portions,
  or any nutritional content — even if the user just confirmed or rephrased the
  same meal. The UI uses this object to keep its fields in sync, and a missing
  "macros" key leaves stale numbers on screen.
- "carbs", "protein", "fat" are REQUIRED numeric grams (use 0, never null).
- "fiber" and "calories" are required numeric values; estimate them from the
  food described.
- "description" is REQUIRED whenever "macros" is present. It must be a clean
  comma-separated list of "<grams>g <ingredient>" entries reflecting the FULL
  updated meal — e.g. "100g broccoli, 23g nut mix, 130g banana". Use grams for
  solids and ml for liquids. Lowercase ingredient names. No leading/trailing
  punctuation. Never abbreviate to "same as before" — always re-emit the full
  list.
- Only OMIT the "macros" and "description" keys for pure meta questions
  ("why?", "explain") that don't change the underlying food. When in doubt,
  INCLUDE both.`;

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
    let parsed: {
      reply?: string;
      macros?: { carbs?: number; protein?: number; fat?: number; fiber?: number; calories?: number };
      description?: string;
    } = {};
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { reply: cleaned || "Sorry — I couldn't form a response." }; }

    // Macros and description are an ATOMIC contract: either we forward both
    // or neither. A response is "valid" only when carbs/protein/fat are finite
    // numbers AND a non-empty description list is supplied. Anything weaker
    // would let the UI apply partial updates and leave a stale meal label
    // sitting next to fresh totals.
    const m = parsed.macros;
    const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    const macrosOk = !!m && isNum(m.carbs) && isNum(m.protein) && isNum(m.fat);
    const descRaw  = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const atomic   = macrosOk && descRaw.length > 0;

    const validMacros = atomic && m
      ? {
          carbs:    Math.max(0, Math.round(m.carbs!)),
          protein:  Math.max(0, Math.round(m.protein!)),
          fat:      Math.max(0, Math.round(m.fat!)),
          fiber:    isNum(m.fiber)    ? Math.max(0, Math.round(m.fiber))    : 0,
          calories: isNum(m.calories) ? Math.max(0, Math.round(m.calories)) : 0,
        }
      : null;
    const description = atomic ? descRaw : null;

    return NextResponse.json({
      reply:  parsed.reply  ?? "",
      macros: validMacros,
      description,
      raw,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
