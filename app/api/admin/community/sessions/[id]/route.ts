import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };

  if (body.status !== "active" && body.status !== "closed" && body.status !== "draft") {
    return NextResponse.json(
      { error: "status must be active | closed | draft" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  const update: Record<string, unknown> = { status: body.status };
  if (body.status === "closed") update.closed_at = new Date().toISOString();

  const { error } = await admin
    .from("community_vote_sessions")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
