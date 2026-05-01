// Signed Unsubscribe-Tokens für die Drip-Mail-Footer.
//
// Anforderungen:
//   - Empfänger:in klickt einen Link in der Mail → Server kann ohne
//     Login feststellen, *welche* Adresse sich abmelden will.
//   - Niemand sonst darf eine fremde Adresse über diesen Endpoint
//     abmelden, deshalb wird der Token serverseitig signiert.
//   - Token ist deterministisch pro Adresse, damit die Abmelde-URL
//     in allen drei Drip-Mails identisch ist und auch eine Mail aus
//     der Vergangenheit noch funktioniert (kein Ablaufdatum nötig —
//     ein einseitiger Opt-out ist auch nach Jahren noch valide).
//
// Format: HMAC-SHA256(lowercase(email), SECRET) → base64url
// Vergleich mit `crypto.timingSafeEqual` gegen Timing-Attacks.

import crypto from "crypto";

const MIN_SECRET_LENGTH = 16;

function getSecret(): string {
  // Bevorzugt ein eigenes Secret (rotierbar ohne Cron-Auswirkung),
  // fällt aber auf CRON_SECRET zurück, damit bestehende Deployments
  // ohne zusätzliche Konfiguration weiter funktionieren — beide sind
  // bereits server-only und ≥16 Zeichen.
  const s =
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.CRON_SECRET ||
    "";
  if (s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      "EMAIL_UNSUBSCRIBE_SECRET (oder CRON_SECRET als Fallback) muss gesetzt und ≥16 Zeichen lang sein",
    );
  }
  return s;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Erzeugt den signierten Token für eine Mail-Adresse. Wirft, wenn
 * kein Secret konfiguriert ist — das ist gewollt, damit eine Drip-Mail
 * ohne funktionierenden Abmelde-Link gar nicht erst rausgeht (statt
 * eine Mail mit kaputtem Link zu schicken).
 */
export function signUnsubscribeToken(email: string): string {
  const secret = getSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(normalize(email))
    .digest("base64url");
}

/**
 * Konstantzeit-Vergleich. Liefert false bei jedem fehlerhaften Input
 * (leerer Token, falsche Länge, fehlendes Secret) — der Endpoint
 * antwortet dann mit 400, ohne Details preiszugeben.
 */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token) return false;
  let expected: string;
  try {
    expected = signUnsubscribeToken(email);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Komplette Unsubscribe-URL für die Mail-Footer. `appUrl` sollte ohne
 * trailing Slash übergeben werden; doppelte Slashes werden hier nicht
 * normalisiert (Caller in drip-templates.ts macht das bereits).
 */
export function buildUnsubscribeUrl(appUrl: string, email: string): string {
  const token = signUnsubscribeToken(email);
  const params = new URLSearchParams({ email: normalize(email), token });
  return `${appUrl}/api/email/drip/unsubscribe?${params.toString()}`;
}
