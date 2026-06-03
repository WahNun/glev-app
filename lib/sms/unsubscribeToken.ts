/**
 * SMS Opt-Out per UWG/TKG.
 * Audit-Trail in sms_optout_events.
 * HMAC-basiert, kein State im Token.
 *
 * Token = base64url(HMAC-SHA256(SMS_UNSUB_SECRET, userId))
 * Stateless — the userId is passed separately in the URL (?u=…).
 *
 * Secret rotation:
 *   1. Generate a new secret and set SMS_UNSUB_SECRET to it.
 *   2. Copy the old value into SMS_UNSUB_SECRET_PREV.
 *   3. Deploy. Links signed with the old secret continue to work until
 *      you unset SMS_UNSUB_SECRET_PREV (after all old links have expired
 *      or you are confident no old links are outstanding).
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
 * Checks the current secret first, then SMS_UNSUB_SECRET_PREV (if set) so that
 * links signed before a secret rotation remain valid during the overlap window.
 * Returns false (never throws) on any mismatch or bad input.
 */
export function verifyUnsubscribeToken(token: string, userId: string): boolean {
  try {
    if (_verifyWithSecret(token, userId, getSecret())) return true;

    const prev = process.env.SMS_UNSUB_SECRET_PREV;
    if (prev && _verifyWithSecret(token, userId, prev)) return true;

    return false;
  } catch {
    return false;
  }
}

function _verifyWithSecret(
  token: string,
  userId: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret)
    .update(userId)
    .digest("base64url");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
