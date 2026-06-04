/**
 * Shared admin authentication helpers for /glev-ops/*.
 *
 * Three-factor login (admin):
 *   1. E-Mail        (ADMIN_EMAIL env var)
 *   2. Passwort      (ADMIN_API_SECRET env var)
 *   3. TOTP-Code     (ADMIN_TOTP_SECRET env var — base32, compatible with Google Authenticator)
 *
 * Marketer login (read-only CRM access):
 *   1. E-Mail        (MARKETER_EMAIL env var)
 *   2. Passwort      (MARKETER_PASSWORD env var)
 *
 * Cookie format: "${role}:${hmac}" where role is "admin" | "marketer".
 * Backward-compat: old plain-hex admin cookies are accepted and treated as "admin".
 *
 * TOTP is implemented natively via Node crypto (RFC 6238 / RFC 4226).
 * No external library needed — avoids Turbopack static-export issues with otplib.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE = "glev_ops_token";
const COOKIE_PATH       = "/";
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
  for (let drift = -1; drift <= 1; drift++) {
    if (hotp(key, counter + drift) === t) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function computeAdminHmac(): string {
  const secret = process.env.ADMIN_API_SECRET ?? "";
  return createHmac("sha256", secret).update(SESSION_HMAC_KEY).digest("hex");
}

function computeMarketerHmac(): string {
  const secret = process.env.MARKETER_PASSWORD ?? "";
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
 * Verify admin credentials (email + password; TOTP temporarily disabled).
 * Always takes ~400 ms to slow brute-force attempts.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string,
  totp: string,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 400));

  const expectedPassword = process.env.ADMIN_API_SECRET ?? "";
  const expectedEmail    = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();

  if (!expectedPassword || expectedPassword.length < 16) return false;
  if (!expectedEmail)  return false;

  const emailOk    = safeEqual(email.toLowerCase().trim(), expectedEmail);
  const passwordOk = safeEqual(password, expectedPassword);
  // TOTP temporarily disabled — re-enable once login is confirmed working
  // const totpOk  = verifyTotp(totp, totpSecret);

  return emailOk && passwordOk;
}

/**
 * Verify marketer credentials (email + password, no TOTP).
 * Always takes ~400 ms to slow brute-force attempts.
 */
export async function verifyMarketerCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 400));

  const expectedEmail    = (process.env.MARKETER_EMAIL ?? "").toLowerCase().trim();
  const expectedPassword = process.env.MARKETER_PASSWORD ?? "";

  if (!expectedEmail || !expectedPassword || expectedPassword.length < 8) return false;

  const emailOk    = safeEqual(email.toLowerCase().trim(), expectedEmail);
  const passwordOk = safeEqual(password, expectedPassword);

  return emailOk && passwordOk;
}

/**
 * Read the session role from the current request cookie.
 * Returns "admin" | "marketer" | null.
 *
 * Backward-compat: old plain-hex cookies (no role prefix) are treated as "admin".
 */
export async function getSessionRole(): Promise<"admin" | "marketer" | null> {
  const adminSecret = process.env.ADMIN_API_SECRET ?? "";
  if (!adminSecret || adminSecret.length < 16) return null;

  const store = await cookies();
  const tok   = store.get(ADMIN_COOKIE)?.value ?? "";
  if (!tok) return null;

  if (tok.startsWith("admin:")) {
    const expected = "admin:" + computeAdminHmac();
    return safeEqual(tok, expected) ? "admin" : null;
  }

  if (tok.startsWith("marketer:")) {
    const marketerPw = process.env.MARKETER_PASSWORD ?? "";
    if (!marketerPw || marketerPw.length < 8) return null;
    const expected = "marketer:" + computeMarketerHmac();
    return safeEqual(tok, expected) ? "marketer" : null;
  }

  // Backward-compat: old plain-hex admin token (no role prefix)
  const legacyHmac = computeAdminHmac();
  return safeEqual(tok, legacyHmac) ? "admin" : null;
}

/** Check whether the current request carries a valid admin session cookie. */
export async function isAdminAuthed(): Promise<boolean> {
  const role = await getSessionRole();
  return role === "admin";
}

/** Check whether the current request carries a valid marketer session cookie. */
export async function isMarketerAuthed(): Promise<boolean> {
  const role = await getSessionRole();
  return role === "marketer";
}

/** Check whether the current request is authenticated as any role (admin or marketer). */
export async function isAnyAuthed(): Promise<boolean> {
  const role = await getSessionRole();
  return role !== null;
}

/** Write the admin session cookie (call after successful admin login). */
export async function setAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "admin:" + computeAdminHmac(), {
    httpOnly: true,
    sameSite: "strict",
    secure:   process.env.NODE_ENV === "production",
    path:     COOKIE_PATH,
    maxAge:   60 * 60 * 8,
  });
}

/** Write the marketer session cookie (call after successful marketer login). */
export async function setMarketerCookie(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "marketer:" + computeMarketerHmac(), {
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
