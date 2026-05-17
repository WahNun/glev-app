import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * /api/food-history/[id]
 *
 * PATCH  — edit a learned food row (Settings UI). Accepts any subset
 *          of typical_grams, carbs_per_100g, protein_per_100g,
 *          fat_per_100g, fiber_per_100g, display_name. Writes are
 *          flagged source='user_confirmed' so a later passive
 *          saveMeal() write can't undo the edit (sticky semantics).
 *
 * DELETE — drop the row entirely. The next time the user logs the
 *          item it'll come back as source='history' starting from a
 *          fresh sample, OR from OFF/USDA if the new parse misses
 *          the personalised cache.
 *
 * RLS already constrains every operation to user_id = auth.uid().
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  const numFields = [
    "typical_grams",
    "carbs_per_100g",
    "protein_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
  ] as const;
  for (const f of numFields) {
    if (body[f] === undefined || body[f] === null) continue;
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${f} must be a non-negative number` }, { status: 400 });
    }
    // Per-100g caps mirror the table CHECK constraints — fail fast
    // with a friendly message instead of a Postgres error.
    if (f === "typical_grams" && n > 5000) {
      return NextResponse.json({ error: "typical_grams too large" }, { status: 400 });
    }
    if (f !== "typical_grams" && n > 100) {
      return NextResponse.json({ error: `${f} cannot exceed 100` }, { status: 400 });
    }
    if (f === "typical_grams" && n <= 0) {
      return NextResponse.json({ error: "typical_grams must be > 0" }, { status: 400 });
    }
    patch[f] = n;
  }
  if (typeof body.display_name === "string" && body.display_name.trim().length > 0) {
    patch.display_name = body.display_name.trim().slice(0, 120);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields supplied" }, { status: 400 });
  }
  // Sanity guard: refuse to land a row where all macros are zero —
  // the live recorder enforces this too. A zero-macro food in the
  // cache would short-circuit OFF/USDA with bad data on the next
  // parse, which is exactly the silent-failure pattern the T1D
  // safety contract forbids.
  if (
    Number(patch.carbs_per_100g   ?? 1) === 0 &&
    Number(patch.protein_per_100g ?? 1) === 0 &&
    Number(patch.fat_per_100g     ?? 1) === 0
  ) {
    // Mixed: caller might have patched only one macro. Fetch existing.
    const { data: cur } = await auth.sb
      .from("user_food_history")
      .select("carbs_per_100g, protein_per_100g, fat_per_100g")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const c = Number(patch.carbs_per_100g   ?? cur?.carbs_per_100g   ?? 0);
    const p = Number(patch.protein_per_100g ?? cur?.protein_per_100g ?? 0);
    const f = Number(patch.fat_per_100g     ?? cur?.fat_per_100g     ?? 0);
    if (c + p + f <= 0) {
      return NextResponse.json(
        { error: "carbs + protein + fat must be > 0" },
        { status: 400 },
      );
    }
  }
  patch.source = "user_confirmed";
  patch.updated_at = new Date().toISOString();

  const { data, error } = await auth.sb
    .from("user_food_history")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const { error } = await auth.sb
    .from("user_food_history")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
