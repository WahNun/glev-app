import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "@/app/api/insulin/_helpers";
import {
  parseFoodName,
  lookupUserFoodHistory,
} from "@/lib/nutrition/userFoodHistory";

/**
 * GET /api/food-history/suggest?names=<comma-separated raw item names>
 *
 * Batch-fetches per-user food-history hits for a list of raw parsed
 * food names. The engine wizard step 2 calls this after /api/parse-food
 * resolves to show "Zuletzt: 150 g — Übernehmen" chips next to each
 * item the user has logged before.
 *
 * Each name is run through parseFoodName (extracts size modifier + qty)
 * before the lookup so "große Banane" correctly queries the 'groß' row.
 *
 * Disambiguation: items that share the same normalized base but differ
 * in size modifier (e.g. "kleine Banane" vs "große Banane") are looked
 * up in separate batches — one per unique modifier — so neither
 * overwrites the other in the sizeModifiers Map.
 *
 * Response shape:
 *   { suggestions: { [rawName]: { suggestedGrams, displayName } } }
 *
 * Names with no history hit are simply absent from the suggestions map.
 * Auth required — history is per-user.
 */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: 401 });
  }

  const namesParam = req.nextUrl.searchParams.get("names") ?? "";
  const rawNames = namesParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (rawNames.length === 0) {
    return NextResponse.json({ suggestions: {} });
  }

  try {
    const parsed = rawNames.map((raw) => ({ raw, ...parseFoodName(raw) }));

    // Group by sizeModifier so that two items sharing the same normalized
    // base but differing in size (kleine Banane / große Banane) are each
    // looked up with the correct modifier.  A flat Map<name,modifier>
    // could only hold one modifier per normalized name — grouping here
    // ensures each lookupUserFoodHistory call sees at most one modifier
    // per food name, avoiding silent disambiguation loss.
    const byModifier = new Map<string | null, typeof parsed>();
    for (const p of parsed) {
      const mod = p.sizeModifier;
      if (!byModifier.has(mod)) byModifier.set(mod, []);
      byModifier.get(mod)!.push(p);
    }

    const suggestions: Record<string, { suggestedGrams: number; displayName: string }> = {};

    for (const [, group] of byModifier) {
      const nameList = group.map((p) => p.foodName);
      const sizeModifiers = new Map<string, string | null>(
        group.map((p) => [p.foodName, p.sizeModifier]),
      );
      const hits = await lookupUserFoodHistory(auth.sb, auth.user.id, nameList, sizeModifiers);

      for (const p of group) {
        const hit = hits.get(p.foodName);
        if (!hit) continue;
        suggestions[p.raw] = {
          suggestedGrams: hit.typicalGrams,
          displayName: hit.displayName,
        };
      }
    }

    return NextResponse.json({ suggestions });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "suggest failed";
    if (isMissingTable({ message: msg })) {
      return NextResponse.json({ suggestions: {} });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
