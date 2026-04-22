import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = req.cookies.get("glev-authed")?.value === "1";

  if (PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/")) && !authed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/login" && authed) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/log/:path*", "/entries/:path*", "/insights/:path*", "/login"],
};
