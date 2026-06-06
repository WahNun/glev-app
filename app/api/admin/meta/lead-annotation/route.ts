// PATCH /api/admin/meta/lead-annotation
// Setzt lead_status und/oder lead_comment für einen Meta-Lead.
//
// Auth: glev_ops_token Cookie (Admin oder Marketer)
// Body: { email: string; lead_status?: string | null; lead_comment?: string | null }

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAnyAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: NextRequest) {
  const authed = await isAnyAuthed();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};

  if ("lead_status" in body) {
    const s = body.lead_status;
    updates.lead_status =
      s === null || s === undefined ? null : typeof s === "string" ? s : null;
  }
  if ("lead_comment" in body) {
    const c = body.lead_comment;
    updates.lead_comment =
      c === null || c === undefined ? null : typeof c === "string" ? c : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { error: dbError } = await sb
    .from("meta_leads")
    .update(updates)
    .eq("email", email);

  if (dbError) {
    console.error("[lead-annotation] DB update failed:", dbError.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
