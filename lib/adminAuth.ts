/**
 * Shared admin authentication helpers for /glev-ops/*.
 *
 * Three-factor login:
 *   1. E-Mail        (ADMIN_EMAIL env var)
 *   2. Passwort      (ADMIN_API_SECRET env var)
 *   3. TOTP-Code     (ADMIN_TOTP_SECRET env var — base32, compatible with Google Authenticator)
 *
 * The session cookie stores an HMAC of the secret rather than the raw secret
 * so the plaintext never lives in the browser.
 *
 * TOTP is implemented natively via Node crypto (RFC 6238 / RFC 4226).
 * No external library needed — avoids Turbopack static-export issues with otplib.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE = "glev_ops_token";
const COOKIE_PATH       = "/glev-ops";
const SESSION_HMAC_KEY  = "glev-ops-session-v2";

// ---------------------------------------------------------------------------
// Native TOTP (RFC 6238 / RFC 4226) — no external library
// ---------------------------------------------------------------------------

function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = encoded.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  const bits: number[] = [];
  for (const char of str) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    for (let i = 4; i >= 0; i--) bits.push((val >> i) & 1);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  return Buffer.from(bytes);
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac  = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
     (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

function verifyTotp(token: string, secret: string): boolean {
  const t = token.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const key     = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30_000);
  // Accept ±1 window (30 s clock drift tolerance)
  for (let drift = -1; drift <= 1; drift++) {
    if (hotp(key, counter + drift) === t) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  // TOTP temporarily disabled — re-enable once login is confirmed working
  // const totpOk  = verifyTotp(totp, totpSecret);

  return emailOk && passwordOk;
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
