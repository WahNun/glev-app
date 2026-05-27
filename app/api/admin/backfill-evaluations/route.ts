import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { lifecycleFor } from "@/lib/engine/lifecycle";
import {
  DEFAULT_INSULIN_SETTINGS,
  type InsulinSettings,
} from "@/lib/userSettings";
import type { Meal } from "@/lib/meals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 200;

/**
 * POST /api/admin/backfill-evaluations
 *
 * One-shot idempotent endpoint that walks every meal whose curve
 * aggregates have been populated (min_bg_180, max_bg_180, or
 * had_hypo_window is non-null), re-runs lifecycleFor(), and persists
 * the corrected `evaluation` for rows whose lifecycle state is "final".
 *
 * Auth: Bearer ADMIN_API_SECRET (same pattern as /api/admin/invite).
 *
 * Query params:
 *   dry_run=1   — compute diff but do not write any updates
 *   cursor=ISO  — resume from this created_at value (for pagination)
 *
 * Returns:
 *   { scanned, updated, skipped, errors, next_cursor }
 *
 * Example:
 *   curl -X POST https://glev.app/api/admin/backfill-evaluations \
 *     -H "Authorization: Bearer <ADMIN_API_SECRET>"
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const cursor = url.searchParams.get("cursor") ?? null;

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Supabase admin init failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const settingsCache = new Map<string, InsulinSettings>();

  async function loadSettings(userId: string): Promise<InsulinSettings> {
    const hit = settingsCache.get(userId);
    if (hit) return hit;
    const { data } = await admin
      .from("user_settings")
      .select("icr_g_per_unit, cf_mgdl_per_unit, target_bg_mgdl")
      .eq("user_id", userId)
      .maybeSingle();
    const s: InsulinSettings = { ...DEFAULT_INSULIN_SETTINGS };
    const isPos = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n > 0;
    if (data) {
      if (isPos(data.icr_g_per_unit))   s.icr      = data.icr_g_per_unit;
      if (isPos(data.cf_mgdl_per_unit)) s.cf       = data.cf_mgdl_per_unit;
      if (isPos(data.target_bg_mgdl))   s.targetBg = data.target_bg_mgdl;
    }
    settingsCache.set(userId, s);
    return s;
  }

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors  = 0;
  let nextCursor: string | null = null;
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;

    // Only process rows that have curve aggregates — these are the rows
    // that could have a stale `evaluation` from before the lifecycleFor
    // write-back was introduced (Task #253).
    let q = admin
      .from("meals")
      .select("*")
      .or("had_hypo_window.not.is.null,max_bg_180.not.is.null,min_bg_180.not.is.null")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (cursor) {
      q = q.gte("created_at", cursor);
    }

    const { data: rows, error: fetchErr } = await q;

    if (fetchErr) {
      return NextResponse.json(
        { error: fetchErr.message, scanned, updated, skipped, errors },
        { status: 500 },
      );
    }
    if (!rows || rows.length === 0) break;

    for (const raw of rows) {
      const m = raw as unknown as Meal;
      scanned++;
      let newEval: string | null;
      try {
        const settings = await loadSettings(m.user_id);
        const lc = lifecycleFor(m, new Date(), settings);
        newEval = lc.state === "final" ? (lc.outcome ?? null) : null;
      } catch (e) {
        errors++;
        continue;
      }

      const currentRaw = (m.evaluation ?? null) as string | null;
      if (currentRaw === newEval) {
        skipped++;
        continue;
      }

      if (!dryRun) {
        const { error: updErr } = await admin
          .from("meals")
          .update({ evaluation: newEval })
          .eq("id", m.id);
        if (updErr) {
          errors++;
          continue;
        }
      }
      updated++;
    }

    if (rows.length < PAGE_SIZE) {
      nextCursor = null;
      break;
    }

    // Persist the cursor for the caller to resume if they hit the 60s limit.
    const last = rows[rows.length - 1] as unknown as Meal;
    nextCursor = last.created_at;
    from += PAGE_SIZE;
  }

  return NextResponse.json({
    dry_run: dryRun,
    scanned,
    updated,
    skipped,
    errors,
    next_cursor: nextCursor,
  });
}
