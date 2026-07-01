/**
 * POST /api/revenuecat/identify
 *
 * Sets RevenueCat subscriber attributes ($email) so customer profiles
 * in the RevenueCat dashboard show the user's email.
 *
 * Called from RevenueCatProvider after SIGNED_IN / initial session resolve.
 * Uses REVENUECAT_SECRET_KEY (server-side only) to authenticate with the RC API.
 */
import { NextRequest, NextResponse } from "next/server";

const RC_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY ?? "";
const RC_API = "https://api.revenuecat.com/v1";

export async function POST(req: NextRequest) {
  let body: { userId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { userId, email } = body;

  if (!userId || !RC_SECRET_KEY) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

  const attributes: Record<string, { value: string }> = {};
  if (email) attributes["$email"] = { value: email };
  if (Object.keys(attributes).length === 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const res = await fetch(
    `${RC_API}/subscribers/${encodeURIComponent(userId)}/attributes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RC_SECRET_KEY}`,
        "Content-Type": "application/json",
        "X-Platform": "ios",
      },
      body: JSON.stringify({ attributes }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[revenuecat/identify] RC API error:", res.status, text);
    return NextResponse.json({ ok: false, error: "rc_api_error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
