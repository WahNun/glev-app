// Cron worker — real-time hypo detection for open meal windows.
//
// Problem this solves:
//   meal_curve_180 jobs only run ONCE at T+180 min. A hypo at T+40 min
//   stays invisible in the UI for up to 140 minutes. With continuous CGM
//   data (cgm_samples for LLU/Nightscout, apple_health_readings for Apple
//   Health) we can detect a sub-70 reading within 2 minutes of it happening.
//
// What it does:
//   1. Find all meals logged in the last 3 h where had_hypo_window IS NULL.
//   2. For each user, call getCgmSamples() — reads BOTH cgm_samples AND
//      apple_health_readings so every CGM source is covered.
//   3. For each open meal, check readings in the 0–180 min post-meal window.
//   4. If any reading < 70 mg/dL: update the meal row immediately:
//        had_hypo_window = true
//        min_bg_180      = min(existing min_bg_180, detected low)
//   5. lifecycleFor() treats had_hypo_window != null as hasCurve = true and
//      immediately returns state = "final", outcome = HYPO_DURING.
//      No UI changes needed — the lifecycle/entries UI handles it already.
//
// Schedule: */2 * * * * (same cadence as cgm-poll).
// Auth: Bearer CRON_SECRET — same pattern as flush-outbox and cgm-poll.

import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/cgm/supabase";
import { getCgmSamples } from "@/lib/cgm/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HYPO_THRESHOLD_MGDL = 70;
const WINDOW_MS = 180 * 60_000;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error("[cron/meal-hypo-check] CRON_SECRET not configured or too short");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return unauthorized();

  const admin = adminClient();
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - WINDOW_MS).toISOString();

  // 1. Find open meals: logged in the last 3 h, hypo not yet evaluated.
  //    Only meals with a valid meal_time — fallback to created_at is
  //    handled after fetch so the SQL filter stays on the indexed column.
  const { data: openMeals, error: mealsErr } = await admin
    .from("meals")
    .select("id, user_id, meal_time, created_at, min_bg_180")
    .is("had_hypo_window", null)
    .gte("meal_time", windowStart);

  if (mealsErr) {
    console.error("[cron/meal-hypo-check] meals query failed:", mealsErr.message);
    return NextResponse.json({ error: mealsErr.message }, { status: 500 });
  }

  if (!openMeals?.length) {
    return NextResponse.json({ ok: true, checkedMeals: 0, flagged: 0, ms: Date.now() - start });
  }

  // 2. Group by user_id — one getCgmSamples() call per user covers all
  //    their open meals in a single query instead of N queries.
  const byUser = new Map<string, typeof openMeals>();
  for (const m of openMeals) {
    const arr = byUser.get(m.user_id) ?? [];
    arr.push(m);
    byUser.set(m.user_id, arr);
  }

  let flagged = 0;
  for (const [userId, meals] of byUser) {
    // Fetch the full time range covering all open meals for this user.
    const earliest = Math.min(
      ...meals.map(m => new Date(m.meal_time ?? m.created_at).getTime()),
    );
    const samples = await getCgmSamples(userId, earliest, nowMs);
    if (!samples.length) continue;

    for (const meal of meals) {
      const mealMs = new Date(meal.meal_time ?? meal.created_at).getTime();
      const windowEndMs = mealMs + WINDOW_MS;

      // Readings strictly within 0–180 min post-meal.
      const inWindow = samples.filter(s => s.t >= mealMs && s.t <= windowEndMs);
      if (!inWindow.length) continue;

      const minVal = Math.min(...inWindow.map(s => s.v));
      if (minVal >= HYPO_THRESHOLD_MGDL) continue;

      // Hypo detected — update the meal row immediately so lifecycleFor()
      // can return final/HYPO_DURING on the next page load/poll.
      const newMin =
        meal.min_bg_180 != null ? Math.min(meal.min_bg_180, minVal) : minVal;

      const { error: updateErr } = await admin
        .from("meals")
        .update({ had_hypo_window: true, min_bg_180: newMin })
        .eq("id", meal.id);

      if (updateErr) {
        console.error(
          `[cron/meal-hypo-check] update failed for meal ${meal.id}:`,
          updateErr.message,
        );
      } else {
        flagged++;
      }
    }
  }

  console.log(
    `[cron/meal-hypo-check] done in ${Date.now() - start}ms — ` +
    `${openMeals.length} meals checked, ${flagged} flagged as HYPO`,
  );
  return NextResponse.json({
    ok: true,
    checkedMeals: openMeals.length,
    flagged,
    ms: Date.now() - start,
  });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
