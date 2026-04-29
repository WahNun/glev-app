import type { NutritionPer100 } from "./types";

/**
 * USDA FoodData Central client. Best coverage for GENERIC ingredients
 * (smart-router primary source when GPT marks an item as NOT branded).
 *
 * Auth: requires USDA_API_KEY env. Falls back to "DEMO_KEY" so dev
 * environments work out of the box, but DEMO_KEY is rate-limited
 * (~30 req/h shared across all users) and must NOT be relied on in
 * production. Register a free key at https://fdc.nal.usda.gov/api-key-signup.
 *
 * https://fdc.nal.usda.gov/api-guide.html
 */

// 3s hard ceiling per task acceptance budget. USDA p95 is ~600ms when
// not rate-limited; DEMO_KEY 429s come back immediately so no need
// for a generous timeout.
const USDA_TIMEOUT_MS = 3000;
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1/foods/search";

interface UsdaSearchResponse {
  foods?: Array<{
    description?: string;
    dataType?: string;
    foodNutrients?: Array<{
      nutrientName?: string;
      nutrientNumber?: string;
      value?: number;
      unitName?: string;
    }>;
  }>;
}

export async function lookupUSDA(
  searchTerm: string,
): Promise<NutritionPer100 | null> {
  const term = searchTerm.trim();
  if (!term) return null;

  const apiKey = process.env.USDA_API_KEY || "DEMO_KEY";
  const url = new URL(USDA_BASE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", term);
  // 25 candidates leaves enough headroom for the relevance ranker to
  // skip over derivative entries ("Oil, oat", "Bread, oat bran",
  // "Bananas, dehydrated, …") and find the canonical raw ingredient
  // that the user actually meant.
  url.searchParams.set("pageSize", "25");
  // Prefer SR Legacy / Foundation data over Branded for generic queries
  // — these entries are the curated USDA reference values per 100g.
  // Note: "Survey (FNDDS)" is intentionally NOT included — its parentheses
  // make USDA's request validator reject the comma-separated dataType list
  // with HTTP 400 ("Bad request"). Foundation + SR Legacy already cover
  // the canonical per-100g macros for virtually every generic food.
  url.searchParams.set("dataType", "Foundation,SR Legacy");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), USDA_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as UsdaSearchResponse;
    const foods = Array.isArray(data.foods) ? data.foods : [];

    // Rank candidates by how well their description matches the user's
    // search term. USDA's default ordering is search-engine relevance,
    // which routinely surfaces processed derivatives first ("Oil, oat"
    // for "oats", "Bananas, dehydrated…" for "banana"). Picking the
    // highest-scoring entry — and only those whose description actually
    // contains the search term as a word — yields the canonical
    // per-100g raw ingredient values the user expects.
    const ranked = foods
      .map((f) => ({ food: f, score: scoreUsdaCandidate(f?.description ?? "", term) }))
      .filter((c) => c.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    for (const c of ranked) {
      const macros = extractUsdaMacros(c.food?.foodNutrients ?? []);
      if (macros) return macros;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score a USDA food description against the user's search term. Higher
 * is better; -Infinity means "reject outright" (search term is not
 * present at all as a whole word, so this entry is almost certainly a
 * different ingredient that just happens to share letters).
 *
 * Heuristics, in priority order:
 *   • Description must contain the search term as a word boundary match.
 *   • Heavy bonus when the description STARTS with the search term —
 *     "Bananas, raw" wins over "Babyfood, banana yogurt".
 *   • Bonus for "raw" / "uncooked" / "plain" — canonical reference values.
 *   • Penalty for processed derivatives ("powder", "dehydrated", "dried",
 *     "oil", "concentrate", "flour", "bread", "bagel", "baby", "infant",
 *     "syrup") — unless the user actually searched for one of those words.
 *   • Slight penalty per word in the description — concise wins ties.
 */
function scoreUsdaCandidate(description: string, term: string): number {
  const desc = description.trim().toLowerCase();
  const t    = term.trim().toLowerCase();
  if (!desc || !t) return -Infinity;

  // Word-boundary match required. Strip a trailing "s" from the search
  // term so plural/singular variants match symmetrically: "oats" should
  // match "Oats, rolled" AND "Oat bran"; "banana" should match "Bananas,
  // raw" AND "banana powder". Without this, "oats" → /\boats?\b/ fails
  // against "Oat bran" and rejects every USDA candidate.
  const stem = t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRe = new RegExp(`\\b${escaped}s?\\b`, "i");
  if (!wordRe.test(desc)) return -Infinity;

  let score = 0;
  // Strong preference for entries that LEAD with the search term —
  // "Bananas, raw" / "Oats, rolled" / "Apples, raw, with skin".
  if (desc.startsWith(t)) score += 10;

  // Boost canonical raw reference forms.
  if (/\b(raw|uncooked|plain)\b/.test(desc)) score += 4;

  // Penalize processed derivatives unless the user explicitly asked.
  const penaltyTokens = [
    "powder", "dehydrated", "dried", "oil", "concentrate",
    "flour", "bread", "bagel", "baby", "infant", "syrup", "candied",
    "canned", "fried", "roasted",
  ];
  for (const tok of penaltyTokens) {
    if (desc.includes(tok) && !t.includes(tok)) score -= 3;
  }

  // Concise descriptions beat verbose ones in tiebreaks.
  score -= Math.min(5, desc.split(/\s+/).length * 0.2);

  return score;
}

/**
 * USDA returns per-100g values in `foodNutrients`. Each entry has a
 * nutrientNumber (FDC-stable IDs):
 *   203 = Protein, 204 = Total fat, 205 = Carbohydrate, 291 = Fiber
 * We match on nutrientNumber primarily and fall back to nutrientName
 * for older response shapes.
 */
function extractUsdaMacros(
  nutrients: Array<{
    nutrientName?: string;
    nutrientNumber?: string;
    value?: number;
    unitName?: string;
  }>,
): NutritionPer100 | null {
  let carbs   = 0;
  let protein = 0;
  let fat     = 0;
  let fiber   = 0;
  let found   = false;

  for (const n of nutrients) {
    const num   = n?.nutrientNumber ?? "";
    const name  = (n?.nutrientName ?? "").toLowerCase();
    const value = typeof n?.value === "number" ? n.value : NaN;
    if (!Number.isFinite(value)) continue;

    if (num === "205" || /carbohydrate, by diff/i.test(name)) {
      carbs = Math.max(0, value); found = true;
    } else if (num === "203" || /^protein$/i.test(name)) {
      protein = Math.max(0, value); found = true;
    } else if (num === "204" || /total lipid \(fat\)/i.test(name)) {
      fat = Math.max(0, value); found = true;
    } else if (num === "291" || /fiber, total dietary/i.test(name)) {
      fiber = Math.max(0, value); found = true;
    }
  }

  if (!found) return null;
  if (carbs + protein + fat <= 0) return null;

  return { carbs_g: carbs, protein_g: protein, fat_g: fat, fiber_g: fiber };
}
