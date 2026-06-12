/**
 * Pure helpers for grantBetaFreeYearAction (app/glev-ops/users/actions.ts).
 *
 * Kept in a separate non-server module so unit tests can import them directly
 * and break if the production redirect target is changed.
 */

/**
 * Builds the `redirectTo` URL for the gift-year invite magic-link.
 *
 * Supabase Implicit Flow appends the session as a hash fragment:
 *   /auth/confirm#access_token=…&type=magiclink
 * Hash fragments are browser-only, so the target MUST be the client page
 * /auth/confirm — never a server route like /welcome/beta or /dashboard.
 *
 * Mirrors the logic in grantBetaFreeYearAction:
 *   const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
 *     || "https://glev.app";
 *   redirectTo: `${appUrl}/auth/confirm`
 *
 * See DECISIONS.md § D-001 for the full architectural rationale.
 */
export function buildGiftYearInviteRedirectTo(rawAppUrl: string | undefined): string {
  const appUrl = (rawAppUrl ?? "").replace(/\/$/, "") || "https://glev.app";
  return `${appUrl}/auth/confirm`;
}
