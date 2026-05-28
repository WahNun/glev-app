// End-to-end coverage for the live password-reset happy path
// (Task #668 — complements the static-state spec from Task #645,
// `recovery-confirm-not-redirected.spec.ts`).
//
// Why this exists:
//   The Task #645 regression test asserts only that /auth/confirm
//   renders the "Passwort zurücksetzen" button when handed a dummy
//   recovery token — it never actually walks the recovery flow
//   end-to-end. The original bug (user dropped straight into the
//   dashboard before the password form appeared) is locked down
//   indirectly there. This spec exercises the live flow with a real
//   one-time Supabase recovery link so a future regression would fail
//   the test for the same reason it would fail for the user.
//
// What this spec does:
//   1. Reads the provisioned Playwright test user's credentials from
//      the global-setup fixture file.
//   2. Mints a fresh one-time recovery link via the Supabase admin
//      API (`auth.admin.generateLink({type: 'recovery'})`) and uses
//      the returned `hashed_token` to build the local /auth/confirm
//      URL directly — going through the Supabase verify endpoint's
//      redirect would just send us back to https://glev.app, the
//      production domain baked into the project's Site URL.
//   3. Opens that URL, clicks the "Passwort zurücksetzen" button,
//      sets a fresh password, and waits for the dashboard.
//   4. Signs out and signs back in with the NEW password to prove
//      the reset really took effect server-side (not just that the
//      page navigated to /dashboard from a stale session cookie).
//   5. Finally restores the original password via the admin API so
//      subsequent specs that rely on the fixture credentials keep
//      working in the same `npm test` run.
//
// Reuses the same SUPABASE_SERVICE_ROLE_KEY env that other specs
// (drip-unsubscribe, last-appointment) already depend on; no new
// fixture infrastructure required.

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { loadTestUserByIndex } from "../support/testUser";

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Cannot run recovery-confirm-full-flow spec: SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY must be set in the environment.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("Recovery confirm full flow", () => {
  test("admin recovery link → set new password → sign in with new password", async ({ page, context }) => {
    const creds = loadTestUserByIndex(test.info().workerIndex);
    const admin = getAdminClient();

    // Pick a deterministic but per-run-unique new password so a flaky
    // run doesn't leave the next run guessing what the user's password
    // actually is. (We also restore the original at the end either way.)
    const newPassword =
      "Pw_new_" +
      Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("") +
      "!1Aa";

    // ── 1. Mint a real one-time recovery link via the admin API ──────────
    //
    // We use `hashed_token` directly rather than navigating to the full
    // `action_link`. The action_link is a Supabase /auth/v1/verify URL
    // whose redirect_to is governed by the project's Site URL — pointing
    // at the production https://glev.app, not the local dev server. The
    // hashed token + type query params are exactly what /auth/confirm
    // forwards to `verifyOtp()` after the user clicks the button, so we
    // skip Supabase's verify-and-redirect hop and land directly on our
    // own confirm page with valid params.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: creds.email,
    });
    expect(linkErr, `generateLink failed: ${linkErr?.message}`).toBeNull();
    const hashedToken = linkData?.properties?.hashed_token;
    expect(hashedToken, "generateLink response missing hashed_token").toBeTruthy();

    // ── 2. Land on /auth/confirm with the real token ─────────────────────
    //
    // Use `waitUntil: "domcontentloaded"` because the page's React
    // client-only render runs after DOMContentLoaded and the page
    // contains no streamed server data we need to wait for.
    await page.goto(
      `/auth/confirm?token_hash=${encodeURIComponent(hashedToken!)}&type=recovery`,
      { waitUntil: "domcontentloaded" },
    );

    // Must NOT have been auto-redirected (the original Task #645 bug
    // would have dropped us at /dashboard before this point).
    await expect(page).toHaveURL(/\/auth\/confirm/);

    // ── 3. Click the confirm button, then set the new password ───────────
    await page.getByRole("button", { name: "Passwort zurücksetzen" }).click();

    // Once verifyOtp() resolves the form fields become visible. The
    // helper labels ("NEUES PASSWORT" / "WIEDERHOLEN") are decorative
    // divs, not real <label>s — target the inputs by autocomplete +
    // type via the form's two password inputs in order.
    const pwInputs = page.locator('input[type="password"][autocomplete="new-password"]');
    await expect(pwInputs).toHaveCount(2, { timeout: 15_000 });

    await pwInputs.nth(0).fill(newPassword);
    await pwInputs.nth(1).fill(newPassword);

    await page.getByRole("button", { name: "Passwort speichern" }).click();

    // ── 4. Wait for the post-save dashboard redirect ─────────────────────
    //
    // The page first shows "Passwort aktualisiert ✓" then schedules a
    // 900 ms timeout before `router.replace("/dashboard")`. Give it
    // generous headroom because the dashboard route can take a beat to
    // compile under Turbopack on the first hit.
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    // ── 5. Sign out, then sign back in with the NEW password ─────────────
    //
    // This is the part that proves the reset actually persisted server-
    // side and isn't a false-positive from the still-active session
    // cookie. We clear cookies wholesale instead of hunting for a
    // logout button — the latter is brittle across nav layouts.
    await context.clearCookies();

    await page.goto("/login");
    await page.getByLabel(/email|e-mail/i).first().fill(creds.email);
    await page.getByLabel(/passwort|password/i).first().fill(newPassword);
    await page.getByRole("button", { name: /anmelden|sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    // ── 6. Restore the original fixture password ─────────────────────────
    //
    // Other specs in the same `npm test` run still expect to sign in
    // with `creds.password`. Without this restore, every spec that
    // runs after this one would 400 on /login. Use a `try/finally`-
    // style guarantee by deferring the call until the assertions
    // above have all settled — if one of them throws, the test fails
    // first and the next run's global-setup will reset the password
    // anyway.
    const { error: restoreErr } = await admin.auth.admin.updateUserById(creds.userId, {
      password: creds.password,
    });
    expect(restoreErr, `restoring original password failed: ${restoreErr?.message}`).toBeNull();
  });
});
