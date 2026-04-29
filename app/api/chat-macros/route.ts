import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { parseFoodText } from "@/lib/nutrition/parseFood";
import { aggregateNutrition } from "@/lib/nutrition/aggregate";

/**
 * Chat-macros refines an already-logged meal. The flow is:
 *   1. GPT acts as a friendly nutrition assistant — it produces the
 *      conversational `reply` and the updated `description` (full
 *      ingredient list with grams). It is INSTRUCTED NOT to estimate
 *      macros — those are computed by the same DB-backed pipeline as
 *      /api/parse-food.
 *   2. We re-parse the description with the structured GPT parser
 *      and re-aggregate via Open Food Facts + USDA (smart routing,
 *      with a GPT-estimate safety net). This guarantees that every
 *      chat-driven correction inherits the same provenance tagging
 *      and bookkeeping as the initial voice/text parse.
 *
 * Response shape is backward compatible — `reply / macros /
 * description / raw` keys unchanged. New additive fields:
 *   - `nutritionSource` (top-level UI badge)
 *   - `items` (per-item breakdown with `source` tag, optional consumer)
 */
const SYSTEM_PROMPT = `You are a friendly, concise nutrition assistant inside a Type 1 Diabetes
insulin-decision app. The user has just logged a meal and is now refining it
with you. Your job is to:

1. Briefly explain WHY the macros for the meal look the way they do — cite
   typical USDA / food-label values per 100g and portion-size assumptions.
2. Accept corrections like "that banana was bigger" or "I had no fiber".
3. Accept brand-new meal descriptions in chat ("einhundert Gramm Hühnerfleisch")
   and treat them as the new authoritative meal.

You are refining an existing meal log. EVERY user message that describes food
in any way — adding ingredients, removing ingredients, correcting portion
sizes, re-stating the meal, or starting over — MUST produce a fresh
"description" field listing every current ingredient with grams.

Always be conversational and short — 2-4 sentences max per reply unless asked.
Do NOT lecture about insulin dosing — that is handled elsewhere in the app.

Return ONLY valid JSON (no markdown, no code fence) of this shape:
{
  "reply":       string,
  "description": string
}

CRITICAL rules:
- "description" is REQUIRED whenever your reply discusses food, portions, or
  any nutritional content — even if the user just confirmed or rephrased the
  same meal. The downstream pipeline parses this field to recompute macros
  from real food databases (Open Food Facts + USDA), so it MUST be a clean
  comma-separated list of "<grams>g <ingredient>" entries reflecting the
  FULL updated meal — e.g. "100g broccoli, 23g nut mix, 130g banana". Use
  grams for solids and ml for liquids. Lowercase ingredient names. No
  leading/trailing punctuation. Never abbreviate to "same as before" —
  always re-emit the full list.
- Do NOT include macro numbers (carbs/protein/fat/fiber/calories) in the
  JSON. The app computes those itself from the description.
- Only OMIT the "description" key for pure meta questions ("why?",
  "explain") that don't change the underlying food. When in doubt,
  INCLUDE it.`;

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
    content: `Current entry context (the macros below are computed from real
food databases, not guesses):
  description: ${body.description || "(none)"}
  carbs:   ${body.macros?.carbs   ?? 0}g
  protein: ${body.macros?.protein ?? 0}g
  fat:     ${body.macros?.fat     ?? 0}g
  fiber:   ${body.macros?.fiber   ?? 0}g`,
  };

  let openai;
  try { openai = getOpenAIClient(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }

  let raw = "";
  let chatDescription: string | null = null;
  let chatReply = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ctx,
        ...history,
      ],
    });
    raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    let parsed: { reply?: string; description?: string } = {};
    try { parsed = JSON.parse(cleaned); }
    catch { parsed = { reply: cleaned || "Sorry — I couldn't form a response." }; }

    chatReply = typeof parsed.reply === "string" ? parsed.reply : "";
    const descRaw = typeof parsed.description === "string" ? parsed.description.trim() : "";
    chatDescription = descRaw.length > 0 ? descRaw : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // No description ⇒ this was a meta question ("why?", "explain"). Return
  // reply only; UI keeps current macros untouched.
  if (!chatDescription) {
    return NextResponse.json({
      reply: chatReply,
      macros: null,
      description: null,
      nutritionSource: null,
      items: null,
      raw,
    });
  }

  // DB-backed re-aggregation: parse the chat description with the same
  // structured GPT parser, then route through OFF + USDA. If parsing or
  // aggregation explodes for any reason, fall through with a null macros
  // payload so the UI keeps its previous values rather than overwriting
  // them with garbage.
  try {
    const parsedDesc = await parseFoodText(chatDescription);
    const aggregated = await aggregateNutrition(parsedDesc.items);

    return NextResponse.json({
      reply: chatReply,
      macros: {
        carbs:    aggregated.totals.carbs,
        protein:  aggregated.totals.protein,
        fat:      aggregated.totals.fat,
        fiber:    aggregated.totals.fiber,
        calories: aggregated.totals.calories,
      },
      description: chatDescription,
      nutritionSource: aggregated.nutritionSource,
      items: aggregated.items,
      raw,
    });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.log("[chat-macros] DB re-aggregation failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({
      reply: chatReply,
      macros: null,
      description: chatDescription,
      nutritionSource: null,
      items: null,
      raw,
    });
  }
}
