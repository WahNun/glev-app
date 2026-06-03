/**
 * SMS Opt-Out per UWG/TKG.
 * Audit-Trail in sms_optout_events.
 * HMAC-basiert, kein State im Token.
 *
 * Token = base64url(HMAC-SHA256(SMS_UNSUB_SECRET, userId))
 * Stateless — the userId is passed separately in the URL (?u=…).
 */

import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.SMS_UNSUB_SECRET;
  if (!s) throw new Error("SMS_UNSUB_SECRET env var is not set");
  return s;
}

/** Returns base64url(HMAC-SHA256(secret, userId)). */
export function generateUnsubscribeToken(userId: string): string {
  const secret = getSecret();
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

/**
 * Timing-safe comparison — returns true if the token is valid for this userId.
 * Returns false (never throws) on any mismatch or bad input.
 */
export function verifyUnsubscribeToken(token: string, userId: string): boolean {
  try {
    const expected = generateUnsubscribeToken(userId);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
