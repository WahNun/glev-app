// tests/unit/passwordResetRedirectTo.test.ts
//
// Regression guard: the self-service password-reset route must always pass
// ${appUrl}/auth/confirm to generateLink — never a bare "#" or empty string.
//
// Background:
//   This project uses Supabase Implicit Flow (no PKCE toggle available).
//   Supabase appends the session as a hash fragment:
//     /auth/confirm#access_token=…&type=recovery
//   Hash fragments are browser-only — server routes like /auth/callback
//   never receive them and would silently drop the token. /auth/confirm
//   is a client component with an onAuthStateChange(PASSWORD_RECOVERY)
//   listener that handles implicit-flow tokens correctly.
//
//   The admin-panel route (app/glev-ops/users/actions.ts) uses
//   /auth/callback?next=/auth/confirm for a different reason (server-side
//   code exchange) — see DECISIONS.md § D-001 for the full architectural
//   distinction.
//
// Full architectural explanation:
//   app/api/auth/password-reset/route.ts — the detailed WHY comment above generateLink()
//   DECISIONS.md § D-001               — architectural decision record
//
// Why pure-logic test (not calling the route directly):
//   The route requires a live Supabase service-role key and cookies().
//   Testing the URL assembly in isolation is simpler and directly targets
//   the regression we are guarding against.
//
// ⚠  Keep in sync:
//   If the URL-building logic in handlePasswordResetPost changes, update
//   buildPasswordResetRedirectTo() below to match.

import { test, expect } from "@playwright/test";

/**
 * Local mirror of the redirectTo URL-assembly logic from
 * handlePasswordResetPost (app/api/auth/password-reset/route.ts).
 *
 *   const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
 *   const appUrl = (rawAppUrl || "https://glev.app").replace(/\/$/, "");
 *   redirectTo: `${appUrl}/auth/confirm`
 */
function buildPasswordResetRedirectTo(rawAppUrl: string | undefined): string {
  const appUrl = (rawAppUrl?.trim() || "https://glev.app").replace(/\/$/, "");
  return `${appUrl}/auth/confirm`;
}

// ── Core invariant ──────────────────────────────────────────────────────────

test("passwordReset redirectTo: never produces bare '#'", () => {
  const badInputs: Array<string | undefined> = [
    undefined,
    "",
    "#",
    "  ",
    "  #  ",
  ];
  for (const bad of badInputs) {
    const result = buildPasswordResetRedirectTo(bad);
    expect(result, `bad input: ${JSON.stringify(bad)}`).not.toBe("#");
    expect(result, `bad input: ${JSON.stringify(bad)}`).toContain(
      "/auth/confirm",
    );
  }
});

// ── Standard env-var scenarios ──────────────────────────────────────────────

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL set to production domain", () => {
  expect(buildPasswordResetRedirectTo("https://glev.app")).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL undefined → https://glev.app fallback", () => {
  expect(buildPasswordResetRedirectTo(undefined)).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL empty string → https://glev.app fallback", () => {
  expect(buildPasswordResetRedirectTo("")).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("passwordReset redirectTo: trailing slash stripped — no double-slash in path", () => {
  const result = buildPasswordResetRedirectTo("https://glev.app/");
  expect(result).toBe("https://glev.app/auth/confirm");
  expect(result).not.toContain("//auth");
});

test("passwordReset redirectTo: whitespace-only NEXT_PUBLIC_APP_URL → fallback", () => {
  expect(buildPasswordResetRedirectTo("   ")).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("passwordReset redirectTo: staging domain is forwarded verbatim", () => {
  expect(buildPasswordResetRedirectTo("https://staging.glev.app")).toBe(
    "https://staging.glev.app/auth/confirm",
  );
});

test("passwordReset redirectTo: always ends with /auth/confirm", () => {
  const examples = [
    "https://glev.app",
    "https://glev.app/",
    "https://staging.glev.app",
    undefined,
    "",
  ];
  for (const input of examples) {
    const result = buildPasswordResetRedirectTo(input);
    expect(result, `input: ${JSON.stringify(input)}`).toMatch(
      /\/auth\/confirm$/,
    );
  }
});
