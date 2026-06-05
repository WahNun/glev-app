import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS = ["open", "reached_out", "resolved", "closed"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authed = await isAdminAuthed();
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { status } = body;
  if (!status || !VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUS.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("cgm_setup_requests")
    .update({ status })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
