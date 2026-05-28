// Unit tests for the geo-locale header chain.
//
// Why this test exists:
// The fix that routes German visitors to the German marketing page relies on
// a header chain: `x-vercel-ip-country` → middleware forwards as
// `x-glev-country` → i18n/request.ts resolves locale. This test exercises the
// middleware half of that chain without a dev server so it catches regressions
// in the DACH country set, the header-forwarding logic, and the cookie-
// persistence precedence rules.
//
// Coverage:
//   1. DACH countries (DE / AT / CH / LU / LI) → middleware sets NEXT_LOCALE=de
//   2. Non-DACH countries → middleware sets NEXT_LOCALE=en
//   3. Existing NEXT_LOCALE cookie is never overwritten by geo signal
//   4. ?lang=de / ?lang=en URL override sets NEXT_LOCALE and wins over geo
//   5. ?lang= override is only honoured on the marketing paths (/, /pro, /beta, /setup)
//
// We call `middleware(req)` directly with a mocked NextRequest so no HTTP
// server is needed. All assertions are on the Set-Cookie headers of the
// returned NextResponse.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a NextRequest for the given URL, optionally with custom headers and
 *  cookies.  We always use http://localhost so the `secure` flag on the
 *  cookie is false — that keeps the assertion simple (no protocol variation). */
function makeReq(
  url: string,
  opts: { country?: string; cookieLocale?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.country) {
    headers["x-vercel-ip-country"] = opts.country;
  }

  const req = new NextRequest(new URL(url, "http://localhost"), { headers });

  // Inject NEXT_LOCALE cookie when requested.
  if (opts.cookieLocale) {
    req.cookies.set("NEXT_LOCALE", opts.cookieLocale);
  }

  return req;
}

/** Return the NEXT_LOCALE value set on the response, or null if the cookie was
 *  not set / explicitly cleared. */
function cookieLocale(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = c.match(/^NEXT_LOCALE=([^;]*)/);
    if (m) return decodeURIComponent(m[1]) || null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DACH countries → geo cookie = "de"
// ─────────────────────────────────────────────────────────────────────────────

const DACH = ["DE", "AT", "CH", "LU", "LI"] as const;

for (const country of DACH) {
  test(`geo: ${country} → NEXT_LOCALE=de cookie`, async () => {
    const res = middleware(makeReq("http://localhost/", { country }));
    expect(cookieLocale(res)).toBe("de");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Non-DACH countries → geo cookie = "en"
// ─────────────────────────────────────────────────────────────────────────────

for (const country of ["US", "GB", "FR", "AU", "CA"]) {
  test(`geo: ${country} → NEXT_LOCALE=en cookie`, async () => {
    const res = middleware(makeReq("http://localhost/", { country }));
    expect(cookieLocale(res)).toBe("en");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Existing NEXT_LOCALE cookie is NEVER overwritten
//    (in-app language picker owns the locale after first visit)
// ─────────────────────────────────────────────────────────────────────────────

test("geo: existing NEXT_LOCALE=en cookie survives DE geo signal", async () => {
  const res = middleware(
    makeReq("http://localhost/", { country: "DE", cookieLocale: "en" }),
  );
  // The middleware must not emit a new Set-Cookie for NEXT_LOCALE.
  expect(cookieLocale(res)).toBeNull();
});

test("geo: existing NEXT_LOCALE=de cookie survives US geo signal", async () => {
  const res = middleware(
    makeReq("http://localhost/", { country: "US", cookieLocale: "de" }),
  );
  expect(cookieLocale(res)).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ?lang= URL override — sets NEXT_LOCALE and wins over geo
// ─────────────────────────────────────────────────────────────────────────────

test("?lang=de on / → NEXT_LOCALE=de even without geo header", async () => {
  const res = middleware(makeReq("http://localhost/?lang=de"));
  expect(cookieLocale(res)).toBe("de");
});

test("?lang=en on / → NEXT_LOCALE=en even with DE geo header", async () => {
  const res = middleware(
    makeReq("http://localhost/?lang=en", { country: "DE" }),
  );
  expect(cookieLocale(res)).toBe("en");
});

test("?lang=de on / → NEXT_LOCALE=de even with US geo header", async () => {
  const res = middleware(
    makeReq("http://localhost/?lang=de", { country: "US" }),
  );
  expect(cookieLocale(res)).toBe("de");
});

// Other marketing-override paths also honour ?lang=
for (const path of ["/pro", "/beta", "/setup"]) {
  test(`?lang=en on ${path} → NEXT_LOCALE=en`, async () => {
    const res = middleware(
      makeReq(`http://localhost${path}?lang=en`, { country: "DE" }),
    );
    expect(cookieLocale(res)).toBe("en");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ?lang= is NOT honoured on non-marketing paths
//    (the lang override header must not be set; the geo cookie persists)
// ─────────────────────────────────────────────────────────────────────────────

test("?lang=en on /login (non-marketing) is ignored — geo cookie set normally", async () => {
  // /login + authed=false → middleware falls through to the geo cookie path.
  // The ?lang= override must NOT take effect on a non-marketing path.
  const res = middleware(
    makeReq("http://localhost/login?lang=en", { country: "DE" }),
  );
  // Geo cookie IS set (DE → de) because there is no existing NEXT_LOCALE cookie.
  expect(cookieLocale(res)).toBe("de");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Country lookup is case-insensitive
// ─────────────────────────────────────────────────────────────────────────────

for (const variant of ["de", "De", "dE"]) {
  test(`geo: lowercase/mixed-case country "${variant}" → de`, async () => {
    const res = middleware(makeReq("http://localhost/", { country: variant }));
    expect(cookieLocale(res)).toBe("de");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. No country header → no NEXT_LOCALE cookie (browser Accept-Language handles it)
// ─────────────────────────────────────────────────────────────────────────────

test("no geo header → no NEXT_LOCALE cookie set", async () => {
  const res = middleware(makeReq("http://localhost/"));
  expect(cookieLocale(res)).toBeNull();
});
