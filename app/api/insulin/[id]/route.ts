import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/insulin/[id]
 * Currently only supports updating `related_entry_id` so the user can
 * (re)link a bolus log to a meal — both at creation time (via the
 * one-tap suggestion in the bolus form) and retroactively from the
 * Insights/ICR card. Pass `related_entry_id: null` to unlink.
 *
 * The actual link is constrained at the DB layer (FK to meals.id +
 * RLS on insulin_logs), so we only validate shape here.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Object.prototype.hasOwnProperty.call(body, "related_entry_id")) {
    return NextResponse.json({ error: "related_entry_id required (use null to unlink)" }, { status: 400 });
  }
  const raw = body.related_entry_id;
  let relatedEntryId: string | null;
  if (raw === null) {
    relatedEntryId = null;
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    relatedEntryId = raw.trim();
  } else {
    return NextResponse.json({ error: "related_entry_id must be a string id or null" }, { status: 400 });
  }

  // Refuse to set the link on a basal log — the column has no meaning
  // there and the engine ICR pairing skips basals anyway.
  const { data: existing, error: readErr } = await auth.sb
    .from("insulin_logs")
    .select("id,user_id,insulin_type")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.insulin_type !== "bolus") {
    return NextResponse.json({ error: "only bolus logs can be linked to a meal" }, { status: 400 });
  }

  const { data, error } = await auth.sb
    .from("insulin_logs")
    .update({ related_entry_id: relatedEntryId })
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id,related_entry_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { error } = await auth.sb
    .from("insulin_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
