// End-to-end tests for the geo-locale header chain on the public marketing page.
//
// Why this test exists:
// The fix that routes German visitors to the German marketing page (with EUR
// pricing) relies on:
//   x-vercel-ip-country → middleware (x-glev-country) → i18n/request.ts
//
// It is currently only verified by hand and by trusting Vercel's edge headers in
// production. These tests catch regressions the next time someone:
//   • refactors middleware and drops the `x-glev-country` forwarding
//   • changes the DACH country set in either middleware.ts or i18n/request.ts
//   • modifies the precedence logic in i18n/request.ts (cookie > geo > Accept-Language)
//   • adds a new marketing path that should honour ?lang= but doesn't
//
// What we assert:
//   1. DE / AT / CH / LU / LI requests → page renders in German
//   2. Non-DACH requests → page renders in English
//   3. NEXT_LOCALE cookie override wins over geo signal
//   4. ?lang= URL override wins over geo signal (and over cookie)
//
// How geo headers reach the server:
//   Playwright's `setExtraHTTPHeaders` injects headers into every request the
//   browser makes.  The Next.js dev server (and Vercel in production) runs the
//   middleware which reads `x-vercel-ip-country` from `req.headers` — so the
//   injected header is seen by the middleware exactly as the real Vercel edge
//   header would be.
//
// Locale anchors:
//   We pin on text that is only present in ONE locale so a flip is immediately
//   obvious.  The hero headline is the most stable single-string anchor:
//     DE: "Hör auf, Deinen Zucker zu raten"
//     EN: "Stop guessing your glucose"
//   The sign-in nav link is a second independent check:
//     DE: "Einloggen"   EN: "Log in"

import { test, expect } from "@playwright/test";

const DE_HERO = "Hör auf, Deinen Zucker zu raten";
const EN_HERO = "Stop guessing your glucose";
const DE_SIGNIN = "Einloggen";
const EN_SIGNIN = "Log in";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DACH countries → German marketing page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Geo: DACH countries → German page", () => {
  const DACH = ["DE", "AT", "CH", "LU", "LI"] as const;

  for (const country of DACH) {
    test(`country=${country} renders German hero and nav`, async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-vercel-ip-country": country });
      await page.goto("/", { waitUntil: "domcontentloaded" });

      await expect(page.getByRole("heading", { name: DE_HERO })).toBeVisible();
      await expect(page.getByRole("link", { name: DE_SIGNIN })).toBeVisible();
      await expect(page.getByRole("heading", { name: EN_HERO })).toHaveCount(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Non-DACH countries → English marketing page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Geo: non-DACH countries → English page", () => {
  for (const country of ["US", "GB", "FR", "AU", "CA"]) {
    test(`country=${country} renders English hero and nav`, async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-vercel-ip-country": country });
      await page.goto("/", { waitUntil: "domcontentloaded" });

      await expect(page.getByRole("heading", { name: EN_HERO })).toBeVisible();
      await expect(page.getByRole("link", { name: EN_SIGNIN })).toBeVisible();
      await expect(page.getByRole("heading", { name: DE_HERO })).toHaveCount(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NEXT_LOCALE cookie override wins over geo signal
//    A visitor who previously chose English in the in-app language picker
//    must see English even when browsing from Germany.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Cookie override precedence", () => {
  test("NEXT_LOCALE=en cookie + DE geo → English page", async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "DE" });
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "en",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: EN_HERO })).toBeVisible();
    await expect(page.getByRole("heading", { name: DE_HERO })).toHaveCount(0);
  });

  test("NEXT_LOCALE=de cookie + US geo → German page", async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "US" });
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "de",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: DE_HERO })).toBeVisible();
    await expect(page.getByRole("heading", { name: EN_HERO })).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ?lang= URL override — highest precedence (beats geo AND cookie)
//    Used by cross-origin canvas iframes and deep-linked share URLs.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("?lang= URL override precedence", () => {
  test("?lang=en + DE geo → English page", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "DE" });
    await page.goto("/?lang=en", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: EN_HERO })).toBeVisible();
    await expect(page.getByRole("heading", { name: DE_HERO })).toHaveCount(0);
  });

  test("?lang=de + US geo → German page", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "US" });
    await page.goto("/?lang=de", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: DE_HERO })).toBeVisible();
    await expect(page.getByRole("heading", { name: EN_HERO })).toHaveCount(0);
  });

  test("?lang=en beats NEXT_LOCALE=de cookie + DE geo", async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ "x-vercel-ip-country": "DE" });
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "de",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/?lang=en", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: EN_HERO })).toBeVisible();
    await expect(page.getByRole("heading", { name: DE_HERO })).toHaveCount(0);
  });
});
