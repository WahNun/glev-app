import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * /api/food-history
 *
 * GET — list the signed-in user's learned foods (Phase B per-user
 *       cache, populated by saveMeal + chat-macros corrections).
 *       Sorted by last_seen_at DESC so the most-recently-used items
 *       show first in the Settings UI.
 *
 * Auth via the shared authedClient helper (cookie session OR bearer
 * token). RLS on user_food_history already constrains every query
 * to user_id = auth.uid().
 */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: 401 });
  }
  const { data, error } = await auth.sb
    .from("user_food_history")
    .select(
      "id, normalized_name, display_name, typical_grams, carbs_per_100g, protein_per_100g, fat_per_100g, fiber_per_100g, source, occurrences, last_seen_at, updated_at",
    )
    .eq("user_id", auth.user.id)
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error) {
    // Missing table (migration not applied yet) → respond with an
    // empty list so the UI can show a friendly empty state instead
    // of a 500. Other errors bubble up.
    if (/does not exist/i.test(error.message) || error.code === "42P01") {
      return NextResponse.json({ items: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
