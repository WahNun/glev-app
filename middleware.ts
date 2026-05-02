import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights", "/import", "/engine", "/onboarding"];
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

// Marketing landing pages where `?lang=de` / `?lang=en` may force the
// rendered locale. Kept narrow on purpose — the override only makes sense
// on public, cookie-less surfaces (e.g. cross-origin canvas iframes that
// can't share NEXT_LOCALE). Inside the authenticated app we keep the
// existing cookie-driven language picker behaviour untouched.
const LANG_OVERRIDE_PATHS = ["/", "/pro", "/beta", "/setup"];
const LANG_OVERRIDE_HEADER = "x-glev-locale-override";
const SUPPORTED_LANG = new Set(["de", "en"]);

function localeOverridePath(pathname: string): boolean {
  return LANG_OVERRIDE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const isAuthed = getSessionFromCookies(req);

  // `/` is the public marketing homepage — let it render for everyone.
  if (PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/")) && !isAuthed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/login" && isAuthed) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // `?lang=` URL override on marketing pages — forwarded to the
  // next-intl request config via a request header so the current
  // response renders in the chosen language. We *also* persist the
  // choice to the `NEXT_LOCALE` cookie (same path/SameSite/max-age as
  // the in-app language picker in `lib/locale.ts`) so the language
  // carries through the funnel when the visitor clicks on to /login or
  // into the authenticated app. The in-app picker keeps full control
  // afterwards — it overwrites the same cookie on change.
  if (localeOverridePath(pathname)) {
    const lang = (searchParams.get("lang") ?? "").toLowerCase();
    if (SUPPORTED_LANG.has(lang)) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set(LANG_OVERRIDE_HEADER, lang);
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      res.cookies.set({
        name: "NEXT_LOCALE",
        value: lang,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
      });
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/log/:path*",
    "/entries/:path*",
    "/insights/:path*",
    "/import/:path*",
    "/engine/:path*",
    "/onboarding/:path*",
    "/login",
    "/pro/:path*",
    "/pro",
    "/beta/:path*",
    "/beta",
    "/setup/:path*",
    "/setup",
  ],
};
