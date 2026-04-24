import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { setCredentials, deleteCredentials } from "@/lib/cgm/llu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    let body: { email?: string; password?: string; region?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    console.log('[cgm/credentials POST] body keys:', Object.keys(body || {}));
    await setCredentials(user.id, body || {});
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { message?: string; stack?: string; name?: string };
    console.error('[cgm/credentials POST] error:', e);
    return NextResponse.json({
      error: 'internal',
      message: err?.message || String(e),
      stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
      name: err?.name,
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    await deleteCredentials(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
