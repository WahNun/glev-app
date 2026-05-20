import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "@/app/api/insulin/_helpers";
import { backfillFoodHistory } from "@/lib/nutrition/userFoodHistory";

/**
 * POST /api/food-history/backfill
 *
 * One-shot endpoint: scans the signed-in user's historical meals,
 * extracts per-food median portion sizes (with outlier filtering at
 * 3× median), and seeds `user_food_history` via recordItemsToHistory.
 *
 * Idempotent: `backfillFoodHistory` is a no-op when the table
 * already has rows for this user, so repeated calls are safe.
 *
 * Called once from the Settings → Food History page when the list
 * comes back empty on first load (gated by a `hasTriedBackfill` ref
 * so it fires at most once per page visit).
 *
 * Timeout: Vercel serverless functions have a 60 s wall-clock limit.
 * For users with very many historical meals the backfill batches to
 * stay well under that ceiling.
 */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: auth.error ?? "unauthorized" }, { status: 401 });
  }

  try {
    // Enforce a 55 s soft timeout so we return before Vercel's 60 s
    // function wall-clock limit. backfillFoodHistory batches internally
    // but very large meal histories could still run long.
    const seeded = await Promise.race([
      backfillFoodHistory(auth.sb, auth.user.id),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("backfill timeout after 55 s")), 55_000),
      ),
    ]);
    return NextResponse.json({ seeded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "backfill failed";
    if (isMissingTable({ message: msg })) {
      return NextResponse.json({ seeded: 0 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
