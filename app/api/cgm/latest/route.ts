import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "@/lib/cgm/supabase";
import { getLatest } from "@/lib/cgm/llu";
import { errResponse } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await verifyJwt(req.headers.get("authorization"));
    const out = await getLatest(userId);
    return NextResponse.json(out);
  } catch (e) {
    return errResponse(e);
  }
}
