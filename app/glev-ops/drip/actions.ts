"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getDripResend,
  renderDripEmail,
  type DripEmailType,
} from "@/lib/emails/drip-templates";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie, isAdminAuthed } from "@/lib/adminAuth";

export { isAdminAuthed } from "@/lib/adminAuth";

/** Maximale Zeichenlänge für `last_error` — identisch zum Cron-Worker. */
const MAX_ERROR_LENGTH = 500;

/** Kürzt einen Fehlertext auf MAX_ERROR_LENGTH Zeichen. */
function truncateError(msg: string): string {
  return msg.length > MAX_ERROR_LENGTH ? msg.slice(0, MAX_ERROR_LENGTH - 1) + "…" : msg;
}

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");
  const ok = await verifyAdminCredentials(email, password, totp);
  if (!ok) redirect("/glev-ops/drip?err=bad");
  await setAdminCookie();
  redirect("/glev-ops/drip");
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect("/glev-ops/drip");
}

// ---- Manuelle Aktionen (send-now / cancel / reschedule) -------------------
//
// Jede Action checkt den Auth-Cookie selbst, weil Server Actions auch
// von außen mit gefälschten POSTs aufrufbar wären. `revalidatePath` am
// Ende stellt sicher, dass der nächste Render der Seite die neue
// Datenbank-Sicht zeigt (Counts + Tabelle).

const DRIP_TYPES: ReadonlyArray<DripEmailType> = [
  "day7_insights",
  "day14_feedback",
  "day30_trustpilot",
];

function isDripType(v: unknown): v is DripEmailType {
  return typeof v === "string" && (DRIP_TYPES as readonly string[]).includes(v);
}

async function requireAdmin(): Promise<void> {
  const ok = await isAdminAuthed();
  if (!ok) {
    redirect("/glev-ops/drip");
  }
}

/**
 * "Jetzt sofort senden" — ruft Resend für genau diese Row auf und setzt
 * `sent_at`. Verhalten 1:1 wie der Cron (selbe Render-Funktion, selbe
 * Idempotenz-Guard via `is("sent_at", null)`), nur außerhalb des
 * 09:00-UTC-Schedules.
 *
 * Bei Erfolg: `sent_at` setzen, `last_error` auf NULL zurücksetzen
 * (sodass die Row aus dem "Fehlgeschlagen"-Bucket verschwindet).
 * Bei Fehler: `last_error` + `last_attempt_at` + `attempt_count` persistieren,
 * damit das Dashboard den echten Grund anzeigt.
 */
export async function sendNowAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = getSupabaseAdmin();
  const { data: row, error: fetchErr } = await admin
    .from("email_drip_schedule")
    .select("id, email, first_name, email_type, sent_at, locale, attempt_count")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) {
    // eslint-disable-next-line no-console
    console.error("[admin/drip] sendNow fetch failed:", fetchErr?.message ?? "row not found");
    revalidatePath("/glev-ops/drip");
    return;
  }
  if (row.sent_at) {
    // Bereits versendet — kein No-Op-Send. Cron-Idempotenz gilt auch
    // für manuelle Aktionen, sonst riskieren wir Duplikate.
    revalidatePath("/glev-ops/drip");
    return;
  }
  if (!isDripType(row.email_type)) {
    // eslint-disable-next-line no-console
    console.error("[admin/drip] sendNow unknown email_type:", row.email_type);
    revalidatePath("/glev-ops/drip");
    return;
  }

  const attemptAt = new Date().toISOString();

  try {
    // ── Playwright-Test-Seam ──────────────────────────────────────────────
    // When PLAYWRIGHT_DRIP_SKIP_RESEND=1 is set (only in the Playwright
    // dev environment — never in production or staging), skip the actual
    // Resend HTTP call and write `sent_at` directly. This lets the E2E
    // suite verify the full action flow (auth guard, idempotency, DB write,
    // revalidation) without sending real emails or requiring a live Resend
    // API key in the test environment.
    if (process.env.PLAYWRIGHT_DRIP_SKIP_RESEND === "1") {
      const sentAt = new Date().toISOString();
      const { error: updErr } = await admin
        .from("email_drip_schedule")
        .update({ sent_at: sentAt })
        .eq("id", row.id)
        .is("sent_at", null);
      if (updErr) {
        // eslint-disable-next-line no-console
        console.error("[admin/drip] sendNow (test skip) mark-sent failed:", {
          id: row.id,
          err: updErr.message,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log("[admin/drip] sendNow (test skip) ok:", { id: row.id });
      }
      revalidatePath("/glev-ops/drip");
      return;
    }
    // ── Normal (production) path ─────────────────────────────────────────
    // Locale defaults to 'de' for legacy rows scheduled before the column
    // existed (NULL in DB). Same fallback as the cron worker — see
    // app/api/cron/drip/route.ts.
    const locale = row.locale === "en" ? "en" : "de";
    const rendered = renderDripEmail(
      row.email_type,
      row.first_name,
      row.email,
      locale,
    );
    const resend = getDripResend();
    const { data, error } = await resend.emails.send({
      from: rendered.from,
      to: row.email,
      subject: rendered.subject,
      html: rendered.html,
    });
    if (error) {
      const errText = truncateError(
        `${error.name ?? "ResendError"}: ${error.message ?? "unknown"}`,
      );
      // eslint-disable-next-line no-console
      console.error("[admin/drip] sendNow resend error:", {
        id: row.id,
        to: row.email,
        type: row.email_type,
        err: errText,
      });
      // Fehler persistieren — Dashboard zeigt ihn sofort nach Revalidierung.
      await admin
        .from("email_drip_schedule")
        .update({
          last_attempt_at: attemptAt,
          last_error: errText,
          attempt_count: (row.attempt_count ?? 0) + 1,
        })
        .eq("id", row.id)
        .is("sent_at", null);
      revalidatePath("/glev-ops/drip");
      return;
    }

    const sentAt = new Date().toISOString();
    // Erfolg: sent_at setzen und last_error aufräumen, damit die Row
    // nicht mehr im "Fehlgeschlagen"-Bucket erscheint.
    const { data: updRows, error: updErr } = await admin
      .from("email_drip_schedule")
      .update({ sent_at: sentAt, last_error: null, last_attempt_at: attemptAt })
      .eq("id", row.id)
      .is("sent_at", null)
      .select("id");
    if (updErr) {
      // eslint-disable-next-line no-console
      console.error("[admin/drip] sendNow mark-sent FAILED — Resend accepted but DB write failed:", {
        id: row.id,
        to: row.email,
        messageId: data?.id ?? null,
        err: updErr.message,
      });
    } else {
      // eslint-disable-next-line no-console
      console.log("[admin/drip] sendNow ok:", {
        id: row.id,
        to: row.email,
        type: row.email_type,
        messageId: data?.id ?? null,
        raceLoss: !updRows || updRows.length === 0,
      });
    }
  } catch (err) {
    const errText = truncateError(
      `Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    );
    // eslint-disable-next-line no-console
    console.error("[admin/drip] sendNow unexpected:", {
      id: row.id,
      to: row.email,
      err: errText,
    });
    await admin
      .from("email_drip_schedule")
      .update({
        last_attempt_at: attemptAt,
        last_error: errText,
        attempt_count: (row.attempt_count ?? 0) + 1,
      })
      .eq("id", row.id)
      .is("sent_at", null);
  }
  revalidatePath("/glev-ops/drip");
}

/**
 * "Abbrechen" — löscht die Row. Hard-Delete (statt Soft-Marker), weil
 * der Unique-Index (email, email_type) sonst verhindert, dass derselbe
 * Termin nach einer Korrektur (z. B. neue Kaufabwicklung mit korrekter
 * Adresse) erneut eingeplant werden kann. Schon versendete Rows lassen
 * sich nicht abbrechen — die Mail ist ohnehin schon raus.
 */
export async function cancelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("email_drip_schedule")
    .delete()
    .eq("id", id)
    .is("sent_at", null);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[admin/drip] cancel failed:", { id, err: error.message });
  } else {
    // eslint-disable-next-line no-console
    console.log("[admin/drip] cancelled:", { id });
  }
  revalidatePath("/glev-ops/drip");
}

/**
 * "Neu einplanen" — verschiebt `scheduled_at` auf einen neuen Zeitpunkt.
 * Erwartet `scheduled_at_iso` als ISO-8601-String aus dem Form. Lehnt
 * versendete Rows ab (sent_at IS NOT NULL) — die haben das Cron-Fenster
 * bereits verlassen und ein "Reschedule" wäre semantisch verwirrend.
 *
 * Datums-Parsing absichtlich permissiv (`new Date(string)`): das
 * datetime-local Input liefert "YYYY-MM-DDTHH:mm" ohne Zone, das
 * interpretiert die Browser-Engine als Lokalzeit. Wir konvertieren in
 * UTC-ISO bevor wir es schreiben, damit der Cron (der in UTC vergleicht)
 * den richtigen Termin sieht.
 *
 * Beim Neu-Einplanen wird `last_error` nicht zurückgesetzt — das
 * ist Absicht: "Neu einplanen" ändert nur den Zeitpunkt, heilt aber
 * nicht automatisch den Resend-Fehler. Erst ein erfolgreicher Versuch
 * (Cron oder "Sofort senden") räumt `last_error` auf.
 */
export async function rescheduleAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const raw = String(formData.get("scheduled_at_iso") ?? "").trim();
  if (!id || !raw) return;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // eslint-disable-next-line no-console
    console.error("[admin/drip] reschedule invalid date:", { id, raw });
    revalidatePath("/glev-ops/drip");
    return;
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("email_drip_schedule")
    .update({ scheduled_at: parsed.toISOString() })
    .eq("id", id)
    .is("sent_at", null);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[admin/drip] reschedule failed:", { id, err: error.message });
  } else {
    // eslint-disable-next-line no-console
    console.log("[admin/drip] rescheduled:", { id, to: parsed.toISOString() });
  }
  revalidatePath("/glev-ops/drip");
}
