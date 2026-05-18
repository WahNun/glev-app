import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../_helpers";
import { findGlucoseAt } from "@/lib/cgm/historicalLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/insulin/[id]
 *
 * Editable fields:
 *   - related_entry_id (bolus only — link / unlink to a meal)
 *   - created_at        (wallclock of the dose — re-anchors CGM
 *                        snapshot for bolus rows)
 *   - units             (dose correction)
 *   - insulin_name      (free-text insulin brand)
 *   - notes
 *
 * When `created_at` changes on a BOLUS row, cgm_glucose_at_log is
 * re-fetched from the CGM history within ±15 min of the new wallclock.
 * If no sample is found in that window, the column is set to NULL
 * so the UI falls back to "manual" / "—". Basal rows track the same
 * anchor but do not store cgm_glucose_at_log usefully — refetch is
 * skipped there.
 */
const ALLOWED = new Set<string>([
  "related_entry_id", "created_at", "units", "insulin_name", "notes",
]);

function parseIsoNotFuture(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "value must be an ISO timestamp string" };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { error: "value must parse as a valid ISO timestamp" };
  if (ms > Date.now() + 5 * 60_000) return { error: "value must not be in the future" };
  if (ms < Date.now() - 90 * 86400_000) return { error: "value too old (max 90 days ago)" };
  return { value: new Date(ms).toISOString() };
}

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

  const unknown = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `unknown field(s): ${unknown.join(", ")} — allowed: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  // Look up the row up front — we need insulin_type for the
  // related_entry_id / CGM-refetch branches and ownership check.
  const { data: existing, error: readErr } = await auth.sb
    .from("insulin_logs")
    .select("id,user_id,insulin_type")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "related_entry_id")) {
    if (existing.insulin_type !== "bolus") {
      return NextResponse.json({ error: "only bolus logs can be linked to a meal" }, { status: 400 });
    }
    const raw = body.related_entry_id;
    if (raw === null) {
      patch.related_entry_id = null;
    } else if (typeof raw === "string" && raw.trim().length > 0) {
      patch.related_entry_id = raw.trim();
    } else {
      return NextResponse.json({ error: "related_entry_id must be a string id or null" }, { status: 400 });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "created_at")) {
    const r = parseIsoNotFuture(body.created_at);
    if ("error" in r) return NextResponse.json({ error: `created_at: ${r.error}` }, { status: 400 });
    patch.created_at = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "units")) {
    const n = Number(body.units);
    if (!Number.isFinite(n) || n < 0 || n > 200) {
      return NextResponse.json({ error: "units must be a number 0..200" }, { status: 400 });
    }
    patch.units = Math.round(n * 10) / 10;
  }

  if (Object.prototype.hasOwnProperty.call(body, "insulin_name")) {
    const v = body.insulin_name;
    if (v === null || (typeof v === "string" && v.trim() === "")) {
      patch.insulin_name = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 80) {
        return NextResponse.json({ error: "insulin_name max 80 chars" }, { status: 400 });
      }
      patch.insulin_name = trimmed;
    } else {
      return NextResponse.json({ error: "insulin_name must be a string or null" }, { status: 400 });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const v = body.notes;
    if (v === null) {
      patch.notes = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      patch.notes = trimmed.length > 0 ? trimmed : null;
    } else {
      return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "at least one editable field is required" }, { status: 400 });
  }

  // Re-anchor the CGM snapshot whenever created_at changed — bolus AND
  // basal rows both display "BG AT LOG" in the UI, so a corrected
  // timestamp must pull the matching historical glucose for either type.
  if (patch.created_at !== undefined) {
    const snap = await findGlucoseAt(auth.user.id, patch.created_at as string, 15);
    patch.cgm_glucose_at_log = snap ? snap.value : null;
  }

  const { data, error } = await auth.sb
    .from("insulin_logs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("*")
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
