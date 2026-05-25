import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * POST /api/timeline-check/bg-result
 *
 * Records the actual blood glucose (BZ) value measured at the moment a
 * post-bolus reminder fires. The user taps the notification, enters
 * their current BZ, and this endpoint writes it back into the
 * `meal_timeline_checks` row.
 *
 * Body (one of two forms):
 *   { check_id: string; bg_mg_dl: number }               — direct row ID
 *   { meal_id: string; check_type: string; bg_mg_dl: number } — look up by (meal_id, check_type)
 *
 * The check_id form is preferred (faster, unambiguous). The meal_id form
 * is a fallback for the web-notification path where only the notification
 * extra payload is available (which contains mealId + checkType).
 *
 * Rules:
 *   - bg_mg_dl must be 20–600 mg/dL.
 *   - The row must belong to the authenticated user (RLS enforced).
 *   - If bg_at_check is already set the endpoint returns 409 so the UI
 *     can surface "already recorded" without double-writing.
 *   - confirmed_at is updated to NOW() together with bg_at_check.
 *
 * Status codes:
 *   400 — missing / invalid body fields.
 *   401 — unauthenticated.
 *   404 — row not found (or RLS denied).
 *   409 — BZ already recorded for this check.
 *   500 — DB write failed.
 */

type CheckRow = {
  id: string;
  bg_at_check: number | null;
};

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { user, sb } = auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;

  const bgRaw = Number(body.bg_mg_dl);
  if (!Number.isFinite(bgRaw) || bgRaw < 20 || bgRaw > 600) {
    return NextResponse.json(
      { error: "bg_mg_dl must be between 20 and 600 mg/dL" },
      { status: 400 },
    );
  }
  const bgMgDl = Math.round(bgRaw);

  let checkId: string | null = null;

  if (typeof body.check_id === "string" && body.check_id.trim()) {
    checkId = body.check_id.trim();
  } else if (
    typeof body.meal_id === "string" &&
    body.meal_id.trim() &&
    typeof body.check_type === "string" &&
    body.check_type.trim()
  ) {
    const mealId = body.meal_id.trim();
    const checkType = body.check_type.trim();

    const { data: rows, error: selErr } = await sb
      .from("meal_timeline_checks")
      .select("id, bg_at_check")
      .eq("user_id", user.id)
      .eq("meal_id", mealId)
      .eq("check_type", checkType)
      .order("created_at", { ascending: false })
      .limit(1);

    if (selErr || !rows || rows.length === 0) {
      return NextResponse.json({ error: "check not found" }, { status: 404 });
    }
    const found = rows[0] as CheckRow;
    if (found.bg_at_check !== null) {
      return NextResponse.json(
        { error: "BZ already recorded for this check", ok: false },
        { status: 409 },
      );
    }
    checkId = found.id;
  } else {
    return NextResponse.json(
      {
        error:
          "provide either check_id or both meal_id + check_type, plus bg_mg_dl",
      },
      { status: 400 },
    );
  }

  if (!checkId) {
    return NextResponse.json({ error: "check not found" }, { status: 404 });
  }

  const { data: existing, error: fetchErr } = await sb
    .from("meal_timeline_checks")
    .select("id, bg_at_check")
    .eq("id", checkId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "check not found" }, { status: 404 });
  }
  const row = existing as CheckRow;
  if (row.bg_at_check !== null) {
    return NextResponse.json(
      { error: "BZ already recorded for this check", ok: false },
      { status: 409 },
    );
  }

  const { data: updated, error: updateErr } = await sb
    .from("meal_timeline_checks")
    .update({
      bg_at_check: bgMgDl,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", checkId)
    .eq("user_id", user.id)
    .is("bg_at_check", null)
    .select("id, bg_at_check")
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // No row returned means another writer filled bg_at_check between our
  // pre-read and the update (race condition). Treat it as 409.
  if (!updated) {
    return NextResponse.json(
      { error: "BZ already recorded for this check", ok: false },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, check_id: checkId, bg_mg_dl: bgMgDl });
}
