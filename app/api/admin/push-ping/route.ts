export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// Minimal POST/GET echo — no auth, no body parsing, no Supabase, no crypto.
// Used to verify that POST requests to /api/admin/* reach Vercel at all
// (vs. being blocked by Cloudflare before hitting the origin).
export async function GET(_req: NextRequest) {
  return NextResponse.json({ pong: true, method: "GET" });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json({ pong: true, method: "POST" });
}
