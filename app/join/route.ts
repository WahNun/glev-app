import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * GET /join?ref=CODE
 *
 * Referral landing — stores the referrer's code in a 30-day cookie and
 * immediately redirects to /signup. No UI, instant redirect.
 *
 * Cookie: glev_ref (SameSite=Lax, path=/, 30 days)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("ref") ?? "";

  const origin = `${url.protocol}//${url.host}`;
  const res = NextResponse.redirect(`${origin}/signup`);

  if (code && /^[A-Z0-9]{5,10}$/.test(code)) {
    res.cookies.set("glev_ref", code, {
      maxAge: 30 * 24 * 60 * 60,
      sameSite: "lax",
      path: "/",
      httpOnly: false,
    });
  }

  return res;
}
