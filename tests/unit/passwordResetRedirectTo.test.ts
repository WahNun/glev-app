// tests/unit/passwordResetRedirectTo.test.ts
//
// Regression guard: sendPasswordResetAction must always pass a
// /auth/callback?next=/auth/confirm URL to generateLink — never a bare "#"
// or empty string.
//
// Background:
//   A previous bug caused the password-reset link to land on "#" because
//   Supabase puts the session token in the URL hash when the redirectTo URL
//   is not routed through /auth/callback. The fix is to always go through
//   /auth/callback?next=/auth/confirm, which exchanges the code server-side
//   and then redirects to /auth/confirm?session=ready&type=recovery.
//   The /auth/callback route is already in the Supabase allowlist.
//
// Full architectural explanation:
//   app/glev-ops/users/actions.ts  — the detailed WHY comment above generateLink()
//   DECISIONS.md § D-001           — architectural decision record (do not revert)
//
// Relevant source:
//   app/glev-ops/users/actions.ts — sendPasswordResetAction (~lines 1305-1336):
//
//     const _rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
//     const appUrl = (_rawAppUrl || "https://glev.app").replace(/\/$/, "");
//     // …
//     const { data: linkData } = await sb.auth.admin.generateLink({
//       type: "recovery",
//       email,
//       options: { redirectTo: `${appUrl}/auth/callback?next=/auth/confirm` },
//     });
//
// Why pure-logic test (not calling the action directly):
//   sendPasswordResetAction is a Next.js "use server" function that
//   requires cookies(), auth headers, and a live Supabase service-role
//   key. Mocking all of that would obscure the real regression we are
//   guarding against. Testing the URL assembly in isolation is simpler,
//   faster, and directly targets the failure mode.
//
// ⚠  Keep in sync:
//   If the URL-building logic in sendPasswordResetAction changes, update
//   buildPasswordResetRedirectTo() below to match.

import { test, expect } from "@playwright/test";

/**
 * Local mirror of the redirectTo URL-assembly logic from
 * sendPasswordResetAction (app/glev-ops/users/actions.ts ~lines 1305-1336).
 *
 *   const _rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
 *   const appUrl = (_rawAppUrl || "https://glev.app").replace(/\/$/, "");
 *   redirectTo: `${appUrl}/auth/callback?next=/auth/confirm`
 *
 * Keeping this as a standalone pure function makes the invariants easy
 * to enumerate and the test easy to read.
 */
function buildPasswordResetRedirectTo(rawAppUrl: string | undefined): string {
  const appUrl = (rawAppUrl?.trim() || "https://glev.app").replace(/\/$/, "");
  return `${appUrl}/auth/callback?next=/auth/confirm`;
}

// ── Core invariant ──────────────────────────────────────────────────────────

test("passwordReset redirectTo: never produces bare '#'", () => {
  // The original bug: Supabase ignored an un-allowlisted redirectTo URL and
  // fell back to the site URL with the token in the hash ("#"). Every input
  // that could cause "#" must produce a valid /auth/callback URL instead.
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
      "/auth/callback",
    );
    expect(result, `bad input: ${JSON.stringify(bad)}`).toContain(
      "/auth/confirm",
    );
  }
});

// ── Standard env-var scenarios ──────────────────────────────────────────────

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL set to production domain", () => {
  expect(buildPasswordResetRedirectTo("https://glev.app")).toBe(
    "https://glev.app/auth/callback?next=/auth/confirm",
  );
});

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL undefined → https://glev.app fallback", () => {
  // Vercel omits the env var if it was never set. The hardcoded fallback
  // must fire and the result must be a fully-qualified /auth/callback URL.
  expect(buildPasswordResetRedirectTo(undefined)).toBe(
    "https://glev.app/auth/callback?next=/auth/confirm",
  );
});

test("passwordReset redirectTo: NEXT_PUBLIC_APP_URL empty string → https://glev.app fallback", () => {
  // An explicitly empty env var is falsy and must also hit the fallback
  // branch — not produce an empty string or a relative path.
  expect(buildPasswordResetRedirectTo("")).toBe(
    "https://glev.app/auth/callback?next=/auth/confirm",
  );
});

test("passwordReset redirectTo: trailing slash stripped — no double-slash in path", () => {
  // "https://glev.app/" + "/auth/callback" would produce
  // "https://glev.app//auth/callback" without the replace(). Verify the
  // strip works and the result is a clean canonical URL.
  const result = buildPasswordResetRedirectTo("https://glev.app/");
  expect(result).toBe("https://glev.app/auth/callback?next=/auth/confirm");
  expect(result).not.toContain("//auth");
});

test("passwordReset redirectTo: whitespace-only NEXT_PUBLIC_APP_URL → fallback", () => {
  // .trim() turns whitespace-only strings into "", which is falsy, so the
  // fallback fires. This prevents a redirectTo of "   /auth/callback?next=…".
  expect(buildPasswordResetRedirectTo("   ")).toBe(
    "https://glev.app/auth/callback?next=/auth/confirm",
  );
});

test("passwordReset redirectTo: staging domain is forwarded verbatim", () => {
  // Dev and staging overrides set via NEXT_PUBLIC_APP_URL must be preserved
  // so testers get a working reset link even outside of production.
  expect(buildPasswordResetRedirectTo("https://staging.glev.app")).toBe(
    "https://staging.glev.app/auth/callback?next=/auth/confirm",
  );
});

test("passwordReset redirectTo: always routes through /auth/callback", () => {
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
      /\/auth\/callback\?next=\/auth\/confirm$/,
    );
  }
});
