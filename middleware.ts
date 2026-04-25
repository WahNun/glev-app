import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights", "/import", "/engine"];
const MAX_CHUNKS = 16;

function readSessionRaw(req: NextRequest, cookieName: string): string | null {
  const single = req.cookies.get(cookieName)?.value;
  if (single) return single;
  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const piece = req.cookies.get(`${cookieName}.${i}`)?.value;
    if (!piece) break;
    parts.push(piece);
  }
  return parts.length ? parts.join("") : null;
}

function getSessionFromCookies(req: NextRequest): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
  if (!projectRef) return false;
  const cookieName = `sb-${projectRef}-auth-token`;

  const raw = readSessionRaw(req, cookieName);
  if (!raw) return false;

  try {
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

  // `/` is the public marketing homepage — let it render for everyone.
  if (PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/")) && !isAuthed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/login" && isAuthed) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/log/:path*", "/entries/:path*", "/insights/:path*", "/import/:path*", "/engine/:path*", "/login"],
};
