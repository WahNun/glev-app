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
// Trimmed prompt (was ~600 input tokens, now ~210). The schema itself
// is enforced by OpenAI's strict json_schema response_format below, so
// the prompt no longer has to describe field types or "return JSON
// only" — it focuses on the BEHAVIORAL rules the schema can't express
// (what to put in each field, quantity defaults, branded heuristics).
//
// Fewer input tokens → lower TTFB → faster voice→form path. We were
// careful to keep every quantity default the previous prompt listed —
// the parser hallucinates portion sizes when those are removed.
const PARSER_PROMPT = `You parse free-form meal text (any language) for a T1D app.
Do NOT estimate macros, classify meals, or recommend insulin.

For each item:
- name: original-language label, lowercase.
- grams: weight (treat ml as g for liquids).
- is_branded: TRUE for named products (Coca Cola, Yfood, Activia, Bettery,
  McDonald's, etc.); FALSE for generic ingredients (apple, rice, chicken
  breast), restaurant-style descriptions (döner, kafta), home-made dishes.
- search_term_en / search_term_de: 1-4 words, no quantities, faithful
  translation (Hähnchenbrust ↔ chicken breast). Keep the brand in BOTH
  terms for branded items.
- quantity_specified: TRUE if the user gave an explicit quantity (a
  number with unit, "two slices", "a handful", "half a", "ein Glas",
  etc.). FALSE if you had to fall back on the defaults below because
  the user just named the item ("Banane", "apple", "bread").

Quantity defaults when vague:
banana 120g · apple 180g · slice of bread 30g · handful of nuts 28g ·
glass of juice 200ml · cup of rice 150g (cooked) · tbsp/EL 15g · tsp/TL 5g.

description: comma-separated "<grams>g <name>" for the FULL meal, ml for
liquids, lowercase names, no leading/trailing punctuation.`;

// Strict JSON schema for OpenAI structured outputs. With strict:true the
// model is GUARANTEED to return JSON matching this shape — no more
// /```json/ fences, no "LLM returned unparseable JSON" throws, no
// silent shape drift. additionalProperties:false and every property in
// `required` are mandatory for strict mode.
const PARSER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "description"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "is_branded", "search_term_en", "search_term_de", "quantity_specified"],
        properties: {
          name:               { type: "string" },
          grams:              { type: "number" },
          is_branded:         { type: "boolean" },
          search_term_en:     { type: "string" },
          search_term_de:     { type: "string" },
          quantity_specified: { type: "boolean" },
        },
      },
    },
    description: { type: "string" },
  },
} as const;

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

export async function parseFoodText(
  text: string,
  // Optional UI locale — when supplied we tell the model which language
  // the human-readable `description` should be emitted in. The structured
  // `items` array is unaffected (names stay original-language, search
  // terms stay bilingual). Defaults to German to preserve prior
  // behaviour for callers that don't pass a locale.
  locale: "de" | "en" = "de",
): Promise<ParseFoodResult> {
  const openai = getOpenAIClient();
  const langName = locale === "en" ? "English" : "German";
  const systemPrompt =
    PARSER_PROMPT +
    `\n\nLanguage: the "description" field MUST be written in ${langName}. ` +
    `Item "name" stays in the user's original language; "search_term_en" and ` +
    `"search_term_de" remain as specified above.`;
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      // Strict json_schema response_format (vs the previous json_object
      // mode) guarantees a schema-conformant payload from the model.
      // No more markdown fence cleanup, no more parse-failure throws,
      // and the model spends fewer tokens negotiating shape — directly
      // shaving latency vs the old free-form JSON prompt.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_food",
          strict: true,
          schema: PARSER_SCHEMA,
        },
      },
      temperature: 0.1,
      // 350 tokens fits a 4-5 item meal (~70 tokens per item including
      // bilingual search terms). Lowered from 600 — fewer output
      // tokens directly reduces TTFB and total time.
      max_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: text },
      ],
    },
    { timeout: PARSE_TIMEOUT_MS },
  );
  const raw = completion.choices[0]?.message?.content ?? "";

  let parsed: { items?: unknown[]; description?: string } = {};
  try { parsed = JSON.parse(raw); }
  catch {
    // Defensive: strict json_schema mode should make this unreachable,
    // but if the model refuses or produces a `refusal` message the raw
    // content can still be non-JSON. Preserve the prior error shape so
    // upstream handlers (/api/parse-food, voice flow) keep working.
    throw new Error("LLM returned unparseable JSON: " + raw.slice(0, 200));
  }

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
        // Default to FALSE for older response shapes that don't carry
        // the flag — safer to ASSUME a default portion was used (so
        // history can substitute a personal typical_grams) than to
        // assume the user typed an explicit weight.
        quantity_specified: typeof r.quantity_specified === "boolean"
          ? r.quantity_specified
          : false,
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
