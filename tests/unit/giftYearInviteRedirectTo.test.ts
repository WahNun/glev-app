// tests/unit/giftYearInviteRedirectTo.test.ts
//
// Regression guard: the gift-year invite link (grantBetaFreeYearAction) must
// always pass ${appUrl}/auth/confirm as `redirectTo` to generateLink — never
// "/welcome/beta", "/dashboard", "#", or any other path.
//
// Background:
//   When an admin grants a free year to a brand-new user, the action calls
//   sb.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } }).
//   Supabase validates the token server-side and redirects to `redirectTo` with
//   the session as a URL hash fragment:
//     /auth/confirm#access_token=…&type=magiclink
//   Hash fragments are browser-only — server routes like /auth/callback and
//   /welcome/beta never receive them and would silently drop the session.
//   /auth/confirm is the client page that handles implicit-flow hash tokens.
//
//   This bug existed in the past (redirectTo was "/welcome/beta" at one point).
//   This test would have caught it immediately.
//
// Architecture reference:
//   lib/admin/grantYearHelpers.ts             — the imported helper under test
//   app/glev-ops/users/actions.ts ~L276       — production call site
//   DECISIONS.md § D-001                      — implicit-flow architectural decision
//   tests/unit/passwordResetRedirectTo.test.ts — sister test (same pattern)
//
// Why import the production helper (not a local mirror):
//   Importing the actual buildGiftYearInviteRedirectTo from lib/admin means
//   any change to the production redirect target will break this test. A local
//   mirror would only test itself and would stay green even if someone changes
//   the production code back to "/welcome/beta".

import { test, expect } from "@playwright/test";
import { buildGiftYearInviteRedirectTo } from "../../lib/admin/grantYearHelpers";

// ── Core invariant ───────────────────────────────────────────────────────────

test("giftYearInvite redirectTo: always ends with /auth/confirm", () => {
  const examples: Array<string | undefined> = [
    "https://glev.app",
    "https://glev.app/",
    "https://staging.glev.app",
    undefined,
    "",
  ];
  for (const input of examples) {
    const result = buildGiftYearInviteRedirectTo(input);
    expect(result, `input: ${JSON.stringify(input)}`).toMatch(
      /\/auth\/confirm$/,
    );
  }
});

test("giftYearInvite redirectTo: never points to the old /welcome/beta path", () => {
  const inputs: Array<string | undefined> = [
    "https://glev.app",
    "https://glev.app/",
    undefined,
    "",
  ];
  for (const input of inputs) {
    const result = buildGiftYearInviteRedirectTo(input);
    expect(result, `input: ${JSON.stringify(input)}`).not.toContain(
      "/welcome/beta",
    );
  }
});

test("giftYearInvite redirectTo: never points to /dashboard", () => {
  const inputs: Array<string | undefined> = [
    "https://glev.app",
    undefined,
    "",
  ];
  for (const input of inputs) {
    const result = buildGiftYearInviteRedirectTo(input);
    expect(result, `input: ${JSON.stringify(input)}`).not.toContain(
      "/dashboard",
    );
  }
});

test("giftYearInvite redirectTo: never produces bare '#'", () => {
  const badInputs: Array<string | undefined> = [
    undefined,
    "",
    "#",
    "  ",
    "  #  ",
  ];
  for (const bad of badInputs) {
    const result = buildGiftYearInviteRedirectTo(bad);
    expect(result, `bad input: ${JSON.stringify(bad)}`).not.toBe("#");
    expect(result, `bad input: ${JSON.stringify(bad)}`).toContain(
      "/auth/confirm",
    );
  }
});

// ── Standard env-var scenarios ───────────────────────────────────────────────

test("giftYearInvite redirectTo: NEXT_PUBLIC_APP_URL set to production domain", () => {
  expect(buildGiftYearInviteRedirectTo("https://glev.app")).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("giftYearInvite redirectTo: NEXT_PUBLIC_APP_URL undefined → https://glev.app fallback", () => {
  expect(buildGiftYearInviteRedirectTo(undefined)).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("giftYearInvite redirectTo: NEXT_PUBLIC_APP_URL empty string → https://glev.app fallback", () => {
  expect(buildGiftYearInviteRedirectTo("")).toBe(
    "https://glev.app/auth/confirm",
  );
});

test("giftYearInvite redirectTo: trailing slash stripped — no double-slash in path", () => {
  const result = buildGiftYearInviteRedirectTo("https://glev.app/");
  expect(result).toBe("https://glev.app/auth/confirm");
  expect(result).not.toContain("//auth");
});

test("giftYearInvite redirectTo: whitespace-only NEXT_PUBLIC_APP_URL still ends with /auth/confirm", () => {
  // The production helper does not .trim() before the || fallback, so a
  // whitespace-only string is truthy and passes through. The critical
  // invariant is that the path still ends with /auth/confirm regardless.
  const result = buildGiftYearInviteRedirectTo("   ");
  expect(result).toMatch(/\/auth\/confirm$/);
});

test("giftYearInvite redirectTo: staging domain is forwarded verbatim", () => {
  expect(buildGiftYearInviteRedirectTo("https://staging.glev.app")).toBe(
    "https://staging.glev.app/auth/confirm",
  );
});
