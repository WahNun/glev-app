// Regression coverage for Task #645 — Recovery-Link überspringt
// Passwort-Formular.
//
// What this guards against:
//   When an admin sends a password-reset link and the user opens it,
//   the /auth/confirm page must keep control of the flow until the
//   user has actually set a new password. Two earlier subtle bugs
//   bypassed the password form and dropped the user straight into the
//   dashboard:
//
//     1. supabase-js's default `detectSessionInUrl: true` consumed the
//        recovery code on page-init and fired SIGNED_IN before the
//        user clicked the "Passwort zurücksetzen" button — the
//        button-click verifyOtp() then errored ("otp_expired") and
//        the user was left without a password while the token was
//        already burnt server-side. lib/supabase.ts now opts the
//        confirm page out of URL auto-detection.
//
//     2. A subsequent navigation back through middleware with a
//        freshly-issued session could trip the authed→/dashboard
//        redirect. middleware.ts now early-returns for /auth/confirm
//        even when a session cookie is already present.
//
// This spec only covers the static landing behaviour (no real Supabase
// recovery token is minted — that would require admin API plumbing for
// every CI run). The button click + verifyOtp path is exercised
// manually before release. What we lock down here is the much cheaper
// invariant that the page renders the confirm button (state =
// "needs_confirm") instead of any auto-redirect to /dashboard, and
// that the same page renders without redirect even when an
// already-authenticated session cookie is present in the browser —
// which is the exact condition under which the original bug fired.

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

test.describe("Recovery confirm page", () => {
  test("with recovery params shows the confirm button, not the dashboard", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=dummy-token&type=recovery");

    // Must NOT have been redirected anywhere.
    await expect(page).toHaveURL(/\/auth\/confirm/);

    // The "needs_confirm" CTA for type=recovery is "Passwort zurücksetzen".
    await expect(
      page.getByRole("button", { name: "Passwort zurücksetzen" }),
    ).toBeVisible();
  });

  test("middleware does not redirect /auth/confirm when an authed session cookie exists", async ({ page, context }) => {
    // Read the provisioned test user, sign them in to populate the
    // sb-<ref>-auth-token cookie, then visit /auth/confirm with a
    // recovery token. The middleware must let the request through
    // instead of bouncing the authed user back to /dashboard.
    const creds = JSON.parse(fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8"));

    await page.goto("/login");
    await page.getByLabel(/email|e-mail/i).first().fill(creds.email);
    await page.getByLabel(/passwort|password/i).first().fill(creds.password);
    await page.getByRole("button", { name: /anmelden|sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard/);

    // Sanity: we have a session cookie now.
    const cookies = await context.cookies();
    const hasSession = cookies.some((c) => /^sb-.*-auth-token/.test(c.name));
    expect(hasSession).toBe(true);

    // Now hit /auth/confirm with recovery params. Middleware must let
    // this render, NOT bounce back to /dashboard.
    await page.goto("/auth/confirm?token_hash=dummy-token&type=recovery");
    await expect(page).toHaveURL(/\/auth\/confirm/);
    await expect(
      page.getByRole("button", { name: "Passwort zurücksetzen" }),
    ).toBeVisible();
  });
});
