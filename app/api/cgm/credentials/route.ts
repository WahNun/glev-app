import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/cgm/supabase";
import { setCredentials, deleteCredentials } from "@/lib/cgm/llu";
import { errResponse } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await verifyJwt(req.headers.get("authorization"));
    let body: { email?: string; password?: string; region?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    await setCredentials(userId, body || {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await verifyJwt(req.headers.get("authorization"));
    await deleteCredentials(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
