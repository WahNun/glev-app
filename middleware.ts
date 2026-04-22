import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights"];

function getSessionFromCookies(req: NextRequest): boolean {
  const cookies = req.cookies.getAll();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
  const sessionCookieName = projectRef ? `sb-${projectRef}-auth-token` : null;
  const sessionCookie = sessionCookieName
    ? cookies.find(c => c.name === encodeURIComponent(sessionCookieName))
    : cookies.find(c => c.name.includes("auth-token") && c.name.startsWith("sb-"));

  if (!sessionCookie?.value) return false;

  try {
    const raw = decodeURIComponent(sessionCookie.value);
    const parsed = JSON.parse(raw);
    const session = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!session?.access_token) return false;
    const expiresAt: number = session.expires_at ?? 0;
    return expiresAt > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthed = getSessionFromCookies(req);

  if (pathname === "/") {
    return NextResponse.redirect(new URL(isAuthed ? "/dashboard" : "/login", req.url));
  }
  if (PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/")) && !isAuthed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/login" && isAuthed) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/log/:path*", "/entries/:path*", "/insights/:path*", "/login"],
};
