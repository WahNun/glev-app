// End-to-end coverage for the geo-cookie persistence in middleware.ts.
//
// Why this exists:
//   Task #230 added `persistGeoLocaleCookie()` to middleware.ts, which
//   detects the visitor's country from `x-vercel-ip-country` /
//   `cf-ipcountry` and writes a `NEXT_LOCALE` cookie on first visit so
//   returning visitors stay on the same language even when the geo header
//   drops on later requests (CDN cache, different edge node, etc.).
//
//   Without this test a regression — e.g. someone removes the cookie
//   write, renames the LOCALE_COOKIE constant, or accidentally clobbers
//   an existing cookie — would only be noticed when users report wrong
//   copy, not during CI.
//
// What this asserts (three scenarios):
//   1. First visit from Germany (x-vercel-ip-country: DE) → sets
//      NEXT_LOCALE=de cookie (covers DACH geo path).
//   2. First visit from the US (x-vercel-ip-country: US) → sets
//      NEXT_LOCALE=en cookie (covers non-DACH geo path).
//   3. Returning visitor who already has NEXT_LOCALE=en arrives with a
//      DE geo header → cookie must NOT be overwritten (the in-app
//      language picker / ?lang= override must stay authoritative).
//
// Test surface:
//   We use the public marketing homepage `/` with no session cookie so
//   no login is needed. Every middleware execution path eventually calls
//   `persistGeoLocaleCookie(req, res, country)` before returning — the
//   homepage for an unauthenticated visitor hits the final catch-all
//   `NextResponse.next()` branch at the bottom of middleware.ts where
//   the function is called unconditionally.
//
// Header injection:
//   `context.setExtraHTTPHeaders` injects the country header into every
//   request the context makes — the same technique used in
//   lang-override.spec.ts for Accept-Language. We clean up the override
//   at the end of each test so it doesn't leak into later specs.
//
// Cookie assertion:
//   We check `context.cookies()` after `page.goto()`. Playwright's
//   browser context automatically applies `Set-Cookie` response headers,
//   so if the middleware writes the cookie on the response the context
//   will hold it. A missing or wrongly-named cookie surfaces immediately
//   as a null / unexpected value here.

import { expect, test } from "@playwright/test";

// Must match the constant in middleware.ts and i18n/request.ts exactly.
// Keeping the value inline (rather than importing from lib/locale.ts)
// means a typo regression on either side of the boundary still trips
// the assertion.
const LOCALE_COOKIE = "NEXT_LOCALE";

async function getLocaleCookieValue(
  context: import("@playwright/test").BrowserContext,
): Promise<string | null> {
  const cookies = await context.cookies();
  const c = cookies.find((x) => x.name === LOCALE_COOKIE);
  return c ? decodeURIComponent(c.value) : null;
}

test.describe("Geo-cookie persistence (middleware.ts persistGeoLocaleCookie)", () => {
  // Clean up any header overrides after each test so subsequent specs are
  // not accidentally influenced by the injected geo header.
  test.afterEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({});
    await context.clearCookies();
  });

  test("sets NEXT_LOCALE=de on first visit from a DACH country (DE)", async ({
    context,
    page,
  }) => {
    // No prior NEXT_LOCALE cookie — simulates a brand-new visitor.
    await context.clearCookies();

    // Inject the Vercel geo header the middleware reads in production.
    await context.setExtraHTTPHeaders({ "x-vercel-ip-country": "DE" });

    // Navigate to the public homepage — no auth required. The middleware
    // runs for every matched route and reaches the `persistGeoLocaleCookie`
    // call unconditionally on this path.
    await page.goto("/");

    // The middleware must have written NEXT_LOCALE=de via Set-Cookie.
    const value = await getLocaleCookieValue(context);
    expect(value, "NEXT_LOCALE cookie after DE geo visit").toBe("de");
  });

  test("sets NEXT_LOCALE=en on first visit from a non-DACH country (US)", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await context.setExtraHTTPHeaders({ "x-vercel-ip-country": "US" });

    await page.goto("/");

    const value = await getLocaleCookieValue(context);
    expect(value, "NEXT_LOCALE cookie after US geo visit").toBe("en");
  });

  test("does NOT overwrite an existing NEXT_LOCALE cookie even when geo says a different locale", async ({
    context,
    baseURL,
    page,
  }) => {
    // Pre-seed the cookie with English — as if the user had previously
    // picked English in the in-app language picker.
    await context.clearCookies();
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: "en",
        url: baseURL!,
        sameSite: "Lax",
      },
    ]);

    // Now arrive from Germany — the middleware must honour the existing
    // cookie and leave it untouched.
    await context.setExtraHTTPHeaders({ "x-vercel-ip-country": "DE" });

    await page.goto("/");

    // Cookie must still be "en" — the geo path must NOT clobber it.
    const value = await getLocaleCookieValue(context);
    expect(
      value,
      "existing NEXT_LOCALE=en must not be overwritten by DE geo header",
    ).toBe("en");
  });
});
