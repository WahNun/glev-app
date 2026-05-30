/**
 * Shared admin authentication helpers for /glev-ops/*.
 *
 * Three-factor login:
 *   1. E-Mail        (ADMIN_EMAIL env var)
 *   2. Passwort      (ADMIN_API_SECRET env var)
 *   3. TOTP-Code     (ADMIN_TOTP_SECRET env var — base32, used by Google Authenticator etc.)
 *
 * The session cookie stores an HMAC of the secret rather than the raw secret
 * so the plaintext never lives in the browser.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { authenticator } from "otplib";

export const ADMIN_COOKIE = "glev_ops_token";
const COOKIE_PATH       = "/glev-ops";
const SESSION_HMAC_KEY  = "glev-ops-session-v2";

function computeSessionToken(): string {
  const secret = process.env.ADMIN_API_SECRET ?? "";
  return createHmac("sha256", secret).update(SESSION_HMAC_KEY).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verify all three credentials.
 * Always takes ~400 ms (success or failure) to slow brute-force attempts.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string,
  totp: string,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 400));

  const expectedPassword = process.env.ADMIN_API_SECRET ?? "";
  const expectedEmail    = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
  const totpSecret       = process.env.ADMIN_TOTP_SECRET ?? "";

  if (!expectedPassword || expectedPassword.length < 16) return false;
  if (!expectedEmail)  return false;
  if (!totpSecret)     return false;

  const emailOk    = safeEqual(email.toLowerCase().trim(), expectedEmail);
  const passwordOk = safeEqual(password, expectedPassword);

  const totpOk = authenticator.verify({ token: totp.trim(), secret: totpSecret });

  return emailOk && passwordOk && totpOk;
}

/** Check whether the current request carries a valid admin session cookie. */
export async function isAdminAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) return false;
  const store = await cookies();
  const tok   = store.get(ADMIN_COOKIE)?.value ?? "";
  if (!tok) return false;
  return safeEqual(tok, computeSessionToken());
}

/** Write the session cookie (call after successful login). */
export async function setAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, computeSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure:   process.env.NODE_ENV === "production",
    path:     COOKIE_PATH,
    maxAge:   60 * 60 * 8,
  });
}

/** Evict the session cookie. */
export async function clearAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure:   process.env.NODE_ENV === "production",
    path:     COOKIE_PATH,
    maxAge:   0,
  });
}
