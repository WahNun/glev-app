import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { getHistory } from "@/lib/cgm/llu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const out = await getHistory(user.id);
    return NextResponse.json(out);
  } catch (e) {
    return errResponse(e);
  }
}
