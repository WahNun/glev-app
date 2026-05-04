import { NextRequest, NextResponse } from "next/server";
import { PATHNAME_HEADER } from "@/lib/appRoutes";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights", "/import", "/engine", "/onboarding"];
const MAX_CHUNKS = 16;
const COUNTRY_HEADER = "x-glev-country";

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

  // Always forward the pathname so layout.tsx can branch on it. Cloned
  // headers travel with the rewritten request only — the response
  // headers are untouched, so this never leaks to the client.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);

  const country =
    req.headers.get("x-vercel-ip-country") ??
    req.headers.get("cf-ipcountry");
  if (country) {
    requestHeaders.set(COUNTRY_HEADER, country);
  }

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

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Match every page request so the PATHNAME_HEADER is always set for
  // SSR theme decisions. Excludes static assets, the Next.js internals,
  // API routes, and files with extensions (favicon, images, etc.) so
  // we don't pay the middleware cost for assets that don't render HTML.
  matcher: [
    "/((?!_next/static|_next/image|api/|favicon\\.ico|.*\\..*).*)",
  ],
};
