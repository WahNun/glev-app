// End-to-end coverage for the shared admin top-bar navigation
// (Task #177).
//
// Why this exists:
//   The AdminNav component (app/admin/_components/AdminNav.tsx) and the
//   layout that mounts it (app/admin/layout.tsx) were added in Task #171
//   but had no automated test coverage. A future refactor that renames a
//   route, breaks the cookie check, drops the active-link aria attribute,
//   or inadvertently hides the nav from authenticated operators would only
//   be caught by a human clicking around in production.
//
// What this asserts:
//   1. Unauthenticated: the login form is shown and the nav is absent.
//   2. Login with correct ADMIN_API_SECRET: nav appears with all expected
//      links and the logout button.
//   3. Active-link highlight: visiting each of the four core pages from
//      the original Task #171 brief (buyers, drip, drip-stats, emails)
//      marks that page's nav link with aria-current="page" and leaves
//      the others unmarked.
//   4. Logout: cookie is evicted — the login form reappears, the nav is
//      gone, and navigating directly to a sub-page no longer shows the nav.
//
// Implementation notes:
//   * Login is done via the real HTML form + server action (not by
//     injecting the cookie directly) so the login path itself is covered.
//   * After login the browser context retains the httpOnly cookie for the
//     entire describe block; each "active link" test re-logs-in via a
//     helper to keep tests independent and avoid ordering dependencies.
//   * The spec intentionally does NOT assert the content of any admin
//     sub-page (buyers list, drip stats table, etc.) — those are separate
//     concerns. It only checks that the nav shell renders correctly; the
//     layout auth gate is what matters here.
//   * ADMIN_API_SECRET must be set in the test environment. The spec
//     throws a descriptive error in beforeAll if it is absent rather than
//     silently skipping, so a missing secret surfaces as a build/CI failure
//     instead of a false-positive pass.

import { expect, test, type Page } from "@playwright/test";

// The four pages explicitly called out in the Task #177 brief.
// These are also the most important dashboards operators navigate between.
const CORE_NAV_PAGES: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin/buyers", label: "Käufer" },
  { href: "/admin/drip", label: "Drip-Pipeline" },
  { href: "/admin/drip-stats", label: "Drip-Statistik" },
  { href: "/admin/emails", label: "Mail-Preview" },
];

// Full list of nav items declared in AdminNav.tsx ITEMS array.
// If a new item is appended there without a corresponding entry here,
// the "all links visible after login" test will still pass — the intent
// is to catch *removals*, not require exhaustive future updates.
const ALL_NAV_LABELS = [
  "Nutzer",
  "Abos",
  "Käufer",
  "Fälle",
  "Drip-Pipeline",
  "Drip-Statistik",
  "Mail-Preview",
  "Praxen",
  "Einstellungen",
] as const;

/**
 * Log in via the real /admin form + server action. After this the
 * browser context holds the `glev_admin_token` httpOnly cookie scoped
 * to `/admin`, so subsequent `page.goto(...)` calls to any /admin/*
 * route will render the authenticated view including the nav.
 */
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin");
  await page.locator('input[name="token"]').fill(
    process.env.ADMIN_API_SECRET ?? "",
  );
  await page.locator('button[type="submit"]').click();
  // Wait for the nav to appear — the auth redirect lands back on /admin
  // and the layout renders AdminNav only for authed requests.
  await expect(
    page.locator('nav[aria-label="Admin-Navigation"]'),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Admin navigation", () => {
  test.beforeAll(() => {
    const secret = process.env.ADMIN_API_SECRET ?? "";
    if (secret.length < 16) {
      throw new Error(
        "admin-nav spec requires ADMIN_API_SECRET (≥16 chars) in the test environment. " +
          "Set it in .env.local (dev) or as a Replit Secret (CI).",
      );
    }
  });

  // ── 1. Unauthenticated ──────────────────────────────────────────────
  test("unauthenticated visit shows login form and hides the nav", async ({
    page,
  }) => {
    await page.goto("/admin");
    // Login form must be present
    await expect(page.locator('input[name="token"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Einloggen" }),
    ).toBeVisible();
    // Nav must NOT be present for unauthenticated visitors
    await expect(
      page.locator('nav[aria-label="Admin-Navigation"]'),
    ).not.toBeVisible();
  });

  // ── 2. Login shows the full nav ─────────────────────────────────────
  test("login with correct secret renders nav with all links", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const nav = page.locator('nav[aria-label="Admin-Navigation"]');

    // Brand anchor back to /admin
    await expect(nav.getByRole("link", { name: "Glev Admin" })).toBeVisible();

    // Every nav item from the ITEMS array
    for (const label of ALL_NAV_LABELS) {
      await expect(
        nav.getByRole("link", { name: label }),
      ).toBeVisible();
    }

    // Logout button is present
    await expect(
      page.getByRole("button", { name: "Logout" }),
    ).toBeVisible();
  });

  // ── 3. Active-link highlight ────────────────────────────────────────
  for (const { href, label } of CORE_NAV_PAGES) {
    test(`active link on ${href} is marked aria-current="page"`, async ({
      page,
    }) => {
      await loginAsAdmin(page);
      await page.goto(href);

      const nav = page.locator('nav[aria-label="Admin-Navigation"]');
      await expect(nav).toBeVisible();

      // Target link must carry aria-current="page"
      await expect(
        nav.getByRole("link", { name: label }),
      ).toHaveAttribute("aria-current", "page");

      // Every other core-page link must NOT be marked active
      for (const other of CORE_NAV_PAGES) {
        if (other.href === href) continue;
        await expect(
          nav.getByRole("link", { name: other.label }),
        ).not.toHaveAttribute("aria-current", "page");
      }
    });
  }

  // ── 4. Logout evicts the cookie ─────────────────────────────────────
  test("logout returns to login form and evicts the auth cookie", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Click logout (server action form submission)
    await page.getByRole("button", { name: "Logout" }).click();

    // Must land on /admin with the login form visible
    await expect(page.locator('input[name="token"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('nav[aria-label="Admin-Navigation"]'),
    ).not.toBeVisible();

    // Cookie is truly gone: navigating directly to a sub-page without
    // re-authenticating must NOT render the nav.
    await page.goto("/admin/buyers");
    await expect(
      page.locator('nav[aria-label="Admin-Navigation"]'),
    ).not.toBeVisible();
  });
});
