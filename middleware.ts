import { NextRequest, NextResponse } from "next/server";
import { PATHNAME_HEADER } from "@/lib/appRoutes";
import { geoLocale } from "@/lib/geoLocale";

const PROTECTED = ["/dashboard", "/log", "/entries", "/insights", "/import", "/engine", "/onboarding"];
const MAX_CHUNKS = 16;
const COUNTRY_HEADER = "x-glev-country";
const LOCALE_COOKIE = "NEXT_LOCALE";
// One year — same as the in-app language picker in lib/locale.ts.
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Cookie that persists across session expiry so returning users (e.g.
// iOS home-screen bookmarks or Capacitor web-views) are sent straight
// to /login instead of seeing the marketing landing page.
const HAD_SESSION_COOKIE = "glev_had_session";
const HAD_SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

// Persist the geo-resolved locale to a NEXT_LOCALE cookie so subsequent
// visits stay on the same language even when the geo header is missing
// (CDN cache, different edge node, etc.). We only set the cookie when:
//   * a geo signal is available this request, AND
//   * the visitor doesn't already have a NEXT_LOCALE cookie — never
//     overwrite an explicit choice from the in-app language picker or
//     the `?lang=` URL override.
// The in-app picker keeps full control afterwards since it writes the
// same cookie name with the same path.
function persistGeoLocaleCookie(
  req: NextRequest,
  res: NextResponse,
  country: string | null | undefined,
) {
  if (req.cookies.get(LOCALE_COOKIE)?.value) return;
  const lang = geoLocale(country);
  if (!lang) return;
  res.cookies.set({
    name: LOCALE_COOKIE,
    value: lang,
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
}

function setHadSessionCookie(req: NextRequest, res: NextResponse) {
  res.cookies.set({
    name: HAD_SESSION_COOKIE,
    value: "1",
    path: "/",
    maxAge: HAD_SESSION_MAX_AGE,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    httpOnly: true,
  });
}

function hadSession(req: NextRequest): boolean {
  return req.cookies.get(HAD_SESSION_COOKIE)?.value === "1";
}

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

  // Auth-link landing pages MUST render even when a session already
  // exists. /auth/confirm hosts the recovery / invite password-set form
  // — a fresh session is created mid-flow (after verifyOtp succeeds),
  // and any redirect from here would skip the password form entirely
  // and burn the recovery token without the user ever setting a new
  // password. /auth/callback is the server-side PKCE exchange endpoint
  // and must run to completion. Whitelist both early, before any
  // authed→dashboard redirects below can fire.
  if (pathname === "/auth/confirm" || pathname === "/auth/callback") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Redirect legacy /admin/* to /glev-ops/* so bookmarks don't 404.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const rest = pathname.slice("/admin".length) || "/";
    return NextResponse.redirect(new URL("/glev-ops" + rest, req.url));
  }

  // Protected routes: redirect unauthenticated users to /login.
  if (PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/")) && !isAuthed) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    persistGeoLocaleCookie(req, res, country);
    return res;
  }
  if (pathname === "/login" && isAuthed) {
    const res = NextResponse.redirect(new URL("/dashboard", req.url));
    persistGeoLocaleCookie(req, res, country);
    setHadSessionCookie(req, res);
    return res;
  }
  // Authed users hitting the marketing landing page get fast-forwarded
  // into the app. Unauthed users continue to see the landing page —
  // UNLESS they have the `glev_had_session` cookie, which means they
  // previously logged in (e.g. iOS home-screen bookmark or Capacitor
  // webview after session expiry). In that case skip the marketing page
  // and go straight to /login.
  // Skip all of this when `?lang=` is present so the language picker
  // can preview locales even when logged in.
  if (pathname === "/" && !searchParams.get("lang")) {
    if (isAuthed) {
      const res = NextResponse.redirect(new URL("/dashboard", req.url));
      persistGeoLocaleCookie(req, res, country);
      setHadSessionCookie(req, res);
      return res;
    }
    if (hadSession(req)) {
      const res = NextResponse.redirect(new URL("/login", req.url));
      persistGeoLocaleCookie(req, res, country);
      return res;
    }
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
        name: LOCALE_COOKIE,
        value: lang,
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
      });
      return res;
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  persistGeoLocaleCookie(req, res, country);
  return res;
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
