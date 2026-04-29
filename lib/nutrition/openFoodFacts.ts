import type { NutritionPer100 } from "./types";

/**
 * Open Food Facts client. Public, no API key required, generous rate
 * limits. Best coverage for BRANDED products (smart-router primary
 * source when GPT marks an item as branded). German DB coverage is
 * notably solid — we always query with the DE search term first when
 * available and fall back to EN.
 *
 * https://world.openfoodfacts.org/data
 */

// 5s headroom for cold TLS handshakes; OFF often returns in <500ms when
// healthy, but its CDN occasionally goes through 503/maintenance windows
// where the client should fail FAST and let USDA take over rather than
// keep the user waiting.
const OFF_TIMEOUT_MS = 5000;
const OFF_BASE = "https://world.openfoodfacts.org/cgi/search.pl";

interface OffSearchResponse {
  products?: Array<{
    nutriments?: Record<string, number | string | undefined>;
    product_name?: string;
    completeness?: number;
  }>;
}

/**
 * Look up nutrition per 100g for a search term. Returns null on:
 *   - HTTP failure / timeout
 *   - No products returned
 *   - Top product missing energy + macros (insufficient data)
 *
 * Caller decides what to do on null (USDA fallback, then GPT estimate).
 */
export async function lookupOpenFoodFacts(
  searchTerm: string,
): Promise<NutritionPer100 | null> {
  const term = searchTerm.trim();
  if (!term) return null;

  const url = new URL(OFF_BASE);
  url.searchParams.set("search_terms", term);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "5");
  // Sort by completeness so the first product with full nutriments wins.
  url.searchParams.set("sort_by", "unique_scans_n");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        // OFF asks all integrations to identify themselves.
        "User-Agent": "Glev-T1D-App/1.0 (https://glev.app)",
      },
      // Cache identical queries for a day at the edge — nutrition
      // values for a given branded product change rarely if ever.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    // OFF occasionally returns an HTML error page with a 200 (CDN
    // maintenance, error pass-through). Detect non-JSON content type up
    // front so the JSON parse can't blow up inside the await.
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("json")) return null;
    const data = (await res.json()) as OffSearchResponse;
    const products = Array.isArray(data.products) ? data.products : [];
    // Filter to products whose `product_name` actually contains the
    // search term as a word. Without this filter, OFF returns the
    // most-popular product matching ANY token (e.g. "banane" → some
    // chocolate bar with "banane" in the ingredients), and the first
    // result yields nutriments completely unrelated to the ingredient
    // the user typed. With the filter we accept the first product whose
    // name actually mentions the searched ingredient.
    const stem = term.toLowerCase().endsWith("s") && term.length > 3
      ? term.toLowerCase().slice(0, -1)
      : term.toLowerCase();
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordRe = new RegExp(`\\b${escaped}s?\\b`, "i");
    const matching = products.filter((p) =>
      wordRe.test((p?.product_name ?? "").toLowerCase()),
    );
    for (const p of matching) {
      const macros = extractOffNutriments(p?.nutriments ?? {});
      if (macros) return macros;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractOffNutriments(n: Record<string, unknown>): NutritionPer100 | null {
  // OFF uses "carbohydrates_100g", "proteins_100g", "fat_100g", "fiber_100g".
  // All are per 100g/ml of the product. Some entries omit fiber → default 0.
  const carbs   = num(n["carbohydrates_100g"]);
  const protein = num(n["proteins_100g"]);
  const fat     = num(n["fat_100g"]);
  const fiber   = num(n["fiber_100g"]) ?? 0;

  // Require at least one macro present and non-zero — pure-additive entries
  // (vitamins-only, etc.) shouldn't pass.
  if (carbs == null && protein == null && fat == null) return null;
  // Sanity floor: any real food has > 5g of macros per 100g. OFF
  // routinely returns half-filled product rows where someone entered
  // protein=3 and forgot the rest. Treating that as "database" data
  // would be worse than honestly falling through to USDA + GPT.
  const totalMacros = (carbs ?? 0) + (protein ?? 0) + (fat ?? 0);
  if (totalMacros < 5) return null;

  return {
    carbs_g:   Math.max(0, carbs   ?? 0),
    protein_g: Math.max(0, protein ?? 0),
    fat_g:     Math.max(0, fat     ?? 0),
    fiber_g:   Math.max(0, fiber),
  };
}
