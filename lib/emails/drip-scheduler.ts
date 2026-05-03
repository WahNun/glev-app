// scheduleDripEmails — wird direkt nach einem erfolgreichen
// enqueueEmail({ template: "beta-welcome" | "pro-welcome", ... })
// in den Stripe-Webhooks aufgerufen, um die drei Drip-Mails an Tag
// 7/14/30 in die email_drip_schedule-Tabelle einzuplanen.
//
// Der eigentliche Versand passiert NICHT hier, sondern täglich um
// 09:00 UTC durch den Cron-Endpoint app/api/cron/drip/route.ts.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { EmailLocale } from "@/lib/emails/beta-welcome";
import type { DripEmailType } from "@/lib/emails/drip-templates";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Offsets in Tagen für die drei Drip-Termine, gemessen ab Welcome-Mail.
 * Bewusst als Konstante — wenn der Spec sich ändert (z. B. Tag 7 statt
 * Tag 5), passiert das an genau einer Stelle.
 */
const DRIP_OFFSETS: ReadonlyArray<{ type: DripEmailType; days: number }> = [
  { type: "day7_insights", days: 7 },
  { type: "day14_feedback", days: 14 },
  { type: "day30_trustpilot", days: 30 },
];

/**
 * Extrahiert den Vornamen aus einem freien "Vor- und Nachname"-Feld.
 * Stripe's `full_name` Custom Field ist Freitext, daher konservativ:
 * trim, am ersten Whitespace splitten, ersten Token nehmen. Leere /
 * fehlende Eingaben → null, damit die Templates auf neutrale Anrede
 * fallback'en können.
 */
function firstNameFrom(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}

/**
 * Plant die drei Drip-Mails für eine:n Käufer:in ein.
 *
 * Verhalten:
 * - Schreibt drei Rows in `email_drip_schedule`, eine pro Drip-Typ,
 *   mit `scheduled_at = now() + 7/14/30 Tage`.
 * - Verwendet `upsert({ ignoreDuplicates: true, onConflict: "email,email_type" })`,
 *   damit ein zweiter Webhook-Trigger (z. B. Stripe-Retry) keine
 *   Duplikate einplant — der Unique-Index aus der Migration garantiert
 *   das ohnehin auf DB-Ebene, aber `ignoreDuplicates` macht die
 *   Insertion schweigend statt fehlerwerfend.
 * - Wirft NIEMALS. Fehler werden geloggt, damit ein DB-Hiccup beim
 *   Drip-Insert nicht den Stripe-Webhook scheitern lässt — die
 *   Welcome-Mail-Pipeline ist load-bearing, die Drip-Mails sind es
 *   nicht (verpasst der Drip-Insert mal einen Käufer, ist das ein
 *   gemissener Onboarding-Touch, kein verlorener Kunde).
 *
 * @param email Pflichtfeld — gleiche Adresse wie für die Welcome-Mail.
 *              Wird nicht normalisiert (lowercase / trim) — die Webhooks
 *              haben das bereits getan, und doppelte Normalisierung
 *              würde Diskrepanzen zwischen Welcome- und Drip-Mail
 *              schaffen.
 * @param name  Voller Name aus Stripe (kann null sein); für die
 *              Anrede in den Mails verwendet.
 * @param tier  "beta" | "pro" — wird mitgespeichert für spätere
 *              Auswertungen (z. B. "wie viele Pro-Käufer haben den
 *              Tag-30-Touch erhalten") und falls einzelne Templates
 *              irgendwann tier-spezifisch werden sollen.
 */
export async function scheduleDripEmails(
  email: string,
  name: string | null | undefined,
  tier: "beta" | "pro",
  locale: EmailLocale = "de",
): Promise<void> {
  if (!email) {
    // eslint-disable-next-line no-console
    console.warn("[drip-scheduler] skipped — empty email");
    return;
  }

  const firstName = firstNameFrom(name);
  const now = Date.now();

  const rows = DRIP_OFFSETS.map(({ type, days }) => ({
    email,
    first_name: firstName,
    tier,
    email_type: type,
    locale,
    scheduled_at: new Date(now + days * DAY_MS).toISOString(),
  }));

  try {
    const admin = getSupabaseAdmin();

    // Hat sich diese Adresse bereits aus der Drip-Serie abgemeldet?
    // Dann gar nichts einplanen — sonst stehen die Termine sieben Tage
    // lang in der Tabelle, der Cron findet sie täglich, filtert sie
    // aus und markiert sie als skipped. Das ist zwar korrekt, aber
    // unnötig laut in den Logs. Ein erneuter Kauf nach einer
    // Abmeldung soll nicht überraschend wieder Drip-Mails auslösen —
    // wenn jemand das wieder will, muss die Row in
    // email_drip_unsubscribes aktiv entfernt werden.
    const { data: existingUnsub, error: unsubLookupErr } = await admin
      .from("email_drip_unsubscribes")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (unsubLookupErr) {
      // eslint-disable-next-line no-console
      console.warn("[drip-scheduler] unsubscribes lookup failed, scheduling anyway:", {
        email,
        message: unsubLookupErr.message,
      });
    } else if (existingUnsub) {
      // eslint-disable-next-line no-console
      console.log("[drip-scheduler] skipped — recipient already unsubscribed:", {
        email,
        tier,
      });
      return;
    }

    const { error } = await admin
      .from("email_drip_schedule")
      .upsert(rows, {
        onConflict: "email,email_type",
        ignoreDuplicates: true,
      });

    if (error) {
      // Loggen, aber nicht werfen. Siehe Funktions-Doc: Welcome-Mail
      // darf an einem Drip-Insert-Fehler nicht scheitern.
      // eslint-disable-next-line no-console
      console.error("[drip-scheduler] upsert failed:", {
        email,
        tier,
        code: error.code,
        message: error.message,
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.log("[drip-scheduler] scheduled drips:", {
      email,
      tier,
      count: rows.length,
    });
  } catch (err) {
    // Catch-all, weil getSupabaseAdmin() bei fehlenden Env-Vars wirft.
    // eslint-disable-next-line no-console
    console.error("[drip-scheduler] unexpected error — drip not scheduled:", {
      email,
      tier,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
