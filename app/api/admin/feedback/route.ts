export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const severity = searchParams.get("severity");
  const platform = searchParams.get("platform");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const pageSize = 50;

  let q = sb
    .from("user_feedback")
    .select(
      "id, created_at, user_id, source, what_noticed, where_noticed, what_broken, what_wished, category, severity, free_text, ai_summary, screen_context, platform, app_version, status, admin_notes, admin_assigned_to, triaged_at, resolved_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (status) q = q.eq("status", status);
  if (category) q = q.eq("category", category);
  if (severity) q = q.eq("severity", severity);
  if (platform) q = q.eq("platform", platform);
  if (dateFrom) q = q.gte("created_at", dateFrom);
  if (dateTo) q = q.lte("created_at", dateTo);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with user emails via auth.users (admin-only view)
  const userIds = [...new Set((data ?? []).map((r) => r.user_id))];
  const emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    for (const uid of userIds) {
      const { data: u } = await sb.auth.admin.getUserById(uid);
      if (u?.user?.email) emailMap[uid] = u.user.email;
    }
  }

  const rows = (data ?? []).map((r) => ({
    ...r,
    user_email: emailMap[r.user_id] ?? null,
  }));

  return NextResponse.json({ rows, total: count ?? 0, page, pageSize });
}

export async function PATCH(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const body = await req.json() as {
    id: string;
    status?: string;
    admin_notes?: string;
    admin_assigned_to?: string | null;
  };

  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const validStatuses = ["new", "triaged", "in_progress", "resolved", "wont_fix", "duplicate"];
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = body.status;
    if (body.status === "triaged") patch.triaged_at = new Date().toISOString();
    if (body.status === "resolved") patch.resolved_at = new Date().toISOString();
  }
  if (body.admin_notes !== undefined) patch.admin_notes = body.admin_notes;
  if (body.admin_assigned_to !== undefined) patch.admin_assigned_to = body.admin_assigned_to;

  const { error } = await sb
    .from("user_feedback")
    .update(patch)
    .eq("id", body.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
