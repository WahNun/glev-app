import { NextRequest, NextResponse } from "next/server";
import { parseFoodText } from "@/lib/nutrition/parseFood";
import { aggregateNutrition } from "@/lib/nutrition/aggregate";
import { classifyMeal } from "@/lib/meals";
import { lookupUserFoodHistory } from "@/lib/nutrition/userFoodHistory";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * Two-stage nutrition pipeline:
 *   1. GPT parser (lib/nutrition/parseFood) — turns free-form food
 *      text into structured items with bilingual search terms. Does
 *      NOT estimate macros.
 *   2. Smart-routing aggregator (lib/nutrition/aggregate) — looks up
 *      each item in Open Food Facts (branded) or USDA (generic),
 *      with cross-DB fallback and a final GPT-estimate safety net so
 *      we never silently emit zeros. Each item ends up tagged with
 *      its source.
 *
 * Response shape stays BACKWARD COMPATIBLE with the previous direct-
 * GPT route — the engine wizard's voice + text paths consume the same
 * `items / totals / mealType / summary / description` keys. Two
 * additive fields are new:
 *   - per-item `source` ('open_food_facts' | 'usda' | 'estimated')
 *   - top-level `nutritionSource` ('database' | 'mixed' | 'estimated')
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const { text, locale: rawLocale } = body as { text?: string; locale?: string };

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Whitelist the locale to the two languages we ship i18n for; anything
  // else falls back to German (the historical default for parseFoodText).
  const locale: "de" | "en" = rawLocale === "en" ? "en" : "de";

  // Stage 1: GPT parser
  let parsed;
  try {
    parsed = await parseFoodText(text, locale);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Parser failed";
    // 503 if it's the missing-key sentinel from getOpenAIClient(), else 500.
    const status = /Missing OpenAI/i.test(msg) ? 503 : 500;
    // eslint-disable-next-line no-console
    console.log("[PERF parse-food] STAGE 1 FAILED:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
  const tParse = Date.now();
  // eslint-disable-next-line no-console
  console.log("[PERF parse-food] stage 1 (GPT parser):", tParse - t0, "ms · items:", parsed.items.length);

  // Phase B: load this user's food history so the aggregator can
  // short-circuit OFF/USDA/GPT for items they've logged before.
  // Best-effort — if auth or the lookup fails (anon user, table not
  // migrated, RLS denial) we proceed with an empty map and fall back
  // to the pre-Phase-B behaviour.
  let userHistory: Awaited<ReturnType<typeof lookupUserFoodHistory>> | undefined;
  try {
    const auth = await authedClient(req);
    if (auth.user && auth.sb) {
      userHistory = await lookupUserFoodHistory(
        auth.sb,
        auth.user.id,
        parsed.items.map((it) => it.name),
      );
    }
  } catch {
    /* no-op — history is an optimisation, not a correctness gate */
  }

  // Stage 2: smart routing → user history → OFF / USDA / GPT-estimate fallback
  const aggregated = await aggregateNutrition(parsed.items, { userHistory });
  const tAgg = Date.now();
  // eslint-disable-next-line no-console
  console.log("[PERF parse-food] stage 2 (aggregator):", tAgg - tParse, "ms · source:", aggregated.nutritionSource);

  // Meal-type classification stays deterministic — same rules as the
  // original GPT prompt, mirroring lib/meals.classifyMeal so the AI
  // and local fallback always agree.
  const { totals } = aggregated;
  const mealType = classifyMeal(totals.carbs, totals.protein, totals.fat, totals.fiber);

  // eslint-disable-next-line no-console
  console.log("[PERF parse-food] total:", Date.now() - t0, "ms");

  return NextResponse.json({
    // Backward-compat aliases for existing client code:
    parsed: aggregated.items,
    items:  aggregated.items,
    totals: aggregated.totals,
    mealType,
    summary: parsed.description,
    description: parsed.description,
    // New fields surfaced by the two-stage pipeline:
    nutritionSource: aggregated.nutritionSource,
    raw: parsed.raw,
  });
}
