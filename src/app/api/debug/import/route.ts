import { NextResponse } from "next/server";
import { getDebug } from "@/lib/debug";

export async function GET() {
  const lastImport = getDebug("IMPORT") ?? { parsed: 0, inserted: 0, failed: 0, error: null };
  return NextResponse.json({ lastImport });
}
