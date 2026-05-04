import { getOpenAIClient } from "@/lib/ai/openaiClient";
import type { ParsedFoodItem } from "./types";

/**
 * Stage 1 of the nutrition pipeline: parse free-form food text into
 * structured items. The model does NOT estimate macros here — that is
 * delegated to the DB lookup stage (Open Food Facts + USDA). Its sole
 * job is language understanding:
 *   - extract each item's name as the user said it
 *   - convert quantities to grams (handful of nuts ≈ 28g, banana ≈ 120g, ...)
 *   - flag branded vs generic (drives smart-routing in aggregate.ts)
 *   - emit bilingual search terms for OFF (DE-strong) and USDA (EN)
 */
const PARSER_PROMPT = `You are a multilingual food-text parser for a Type 1 Diabetes app.
Given a free-form meal description in any language, return ONLY valid JSON
matching this exact schema (no markdown, no code fence, no commentary):

{
  "items": [
    {
      "name": string,            // original-language label, lowercase
      "grams": number,            // weight in grams (ml treated as g for liquids)
      "is_branded": boolean,      // true for named products, false for generic foods
      "search_term_en": string,  // concise English search term for USDA lookup
      "search_term_de": string   // concise German search term for Open Food Facts lookup
    }
  ],
  "description": string          // clean comma-separated "<grams>g <name>" list
}

QUANTITY DEFAULTS when vague:
- "a banana" / "eine Banane" = 120g
- "an apple" / "ein Apfel" = 180g
- "a slice of bread" / "eine Scheibe Brot" = 30g
- "handful of nuts" / "Handvoll Nüsse" = 28g
- "a glass of juice" / "ein Glas Saft" = 200g
- "a cup of rice" / "eine Tasse Reis" = 150g (cooked)
- "a tbsp" / "ein EL" = 15g
- "a tsp" / "ein TL" = 5g

is_branded RULES:
- TRUE for: brand-prefixed products ("Bettery protein shake", "McRoyal burger",
  "Coca Cola", "Yfood", "Activia"), specific commercial cereals, named bars,
  ready-meals with brand or distinct product name.
- FALSE for: generic ingredients ("apple", "broccoli", "chicken breast",
  "rice", "olive oil", "yogurt"), restaurant-style descriptions ("kafta",
  "döner meat"), home-made dishes.

search_term_* RULES:
- Keep concise (1-4 words). Drop quantities and brand/store qualifiers
  unless they DEFINE the product.
- Translate to the target language faithfully ("Hähnchenbrust" ↔
  "chicken breast", "Vollkornbrot" ↔ "wholegrain bread").
- For branded products keep the brand in BOTH terms (search engines
  match on it): "Bettery vanilla protein powder".

description RULES:
- Required. Clean comma-separated list "<grams>g <name>" reflecting the
  FULL meal exactly as parsed. Use grams for solids and ml for liquids
  ("250ml ayran"). Lowercase ingredient names. No leading/trailing
  punctuation.

IMPORTANT: You only parse and structure. Do NOT estimate macros. Do NOT
classify the meal type. Do NOT recommend insulin. Strict JSON only.`;

export interface ParseFoodResult {
  items: ParsedFoodItem[];
  description: string;
  raw: string;
}

// 6s hard ceiling for the GPT parser (lowered from 8s 2026-05-04 as
// part of the voice-latency fix). A typical 1-3 item meal completes
// in ~1.5s; allowing 6s still covers gpt-4o-mini's tail without
// holding the whole pipeline hostage when OpenAI is degraded.
const PARSE_TIMEOUT_MS = 6000;

export async function parseFoodText(text: string): Promise<ParseFoodResult> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      // 350 tokens fits a 4-5 item meal (~70 tokens per item including
      // bilingual search terms). Lowered from 600 — fewer output
      // tokens directly reduces TTFB and total time.
      max_tokens: 350,
      messages: [
        { role: "system", content: PARSER_PROMPT },
        { role: "user",   content: text },
      ],
    },
    { timeout: PARSE_TIMEOUT_MS },
  );
  const raw = completion.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();

  let parsed: { items?: unknown[]; description?: string } = {};
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error("LLM returned unparseable JSON: " + cleaned.slice(0, 200)); }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: ParsedFoodItem[] = rawItems
    .map((it): ParsedFoodItem | null => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const name  = typeof r.name  === "string" ? r.name.trim().toLowerCase() : "";
      const grams = Number(r.grams);
      if (!name || !Number.isFinite(grams) || grams <= 0) return null;
      const sEn = typeof r.search_term_en === "string" && r.search_term_en.trim()
        ? r.search_term_en.trim() : name;
      const sDe = typeof r.search_term_de === "string" && r.search_term_de.trim()
        ? r.search_term_de.trim() : name;
      return {
        name,
        grams: Math.round(grams),
        is_branded: !!r.is_branded,
        search_term_en: sEn,
        search_term_de: sDe,
      };
    })
    .filter((x): x is ParsedFoodItem => x !== null);

  const synthDescription = items
    .map((it) => `${it.grams}g ${it.name}`)
    .join(", ");
  const description = (typeof parsed.description === "string" && parsed.description.trim())
    ? parsed.description.trim()
    : synthDescription;

  return { items, description, raw };
}
