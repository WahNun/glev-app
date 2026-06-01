// Shared utility: aus einem Meta-Lead einen Glev-Account anlegen.
// Wird vom Webhook (app/api/meta/leads/route.ts) aufgerufen.
//
// Email-Strategie: Supabase inviteUserByEmail schickt immer Englisch
// (globales Template, nicht pro-User steuerbar). Stattdessen:
//   1. generateLink({ type: 'invite' }) → erstellt User OHNE Email-Versand
//   2. Eigene gebrandete Email via Resend mit dem Magic Link
//
// Trial-Strategie: trial_start_at + trial_end_at bleiben beim Webhook NULL.
// Sie werden erst beim ersten Klick auf den Confirm-Button gesetzt
// (POST /api/auth/activate-trial). Damit tickt der Trial erst wenn
// der User wirklich aktiv ist — nicht schon beim Webhook-Eingang.

import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  metaLeadInviteHtml,
  metaLeadInviteSubject,
} from "@/lib/emails/meta-lead-invite";
import type { EmailLocale } from "@/lib/emails/beta-welcome";
import { shortenUrl } from "@/lib/shortLinks";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");
const FROM = "Glev <info@glev.app>";

export type ProvisionResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: string };

/** +49… → "de", alles andere → "de" (German-first product). */
export function localeFromPhone(phone: string | null | undefined): EmailLocale {
  if (phone && /^\+49/.test(phone.trim())) return "de";
  return "de";
}

/** Sendet eine SMS mit dem Invite-Link via Twilio REST API (fire-and-forget). */
async function sendTwilioSms(phone: string, inviteUrl: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    // eslint-disable-next-line no-console
    console.warn("[meta-lead-provisioning] Twilio not configured — SMS not sent");
    return;
  }

  // Kürze den langen Supabase-Magic-Link → glev.app/s/XXXXXX
  const shortUrl = await shortenUrl(inviteUrl);
  const body = `Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: ${shortUrl}\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner.`;
  const formData = new URLSearchParams({ From: from, To: phone, Body: body });

  fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // eslint-disable-next-line no-console
        console.error("[meta-lead-provisioning] Twilio SMS failed:", r.status, text);
      } else {
        // eslint-disable-next-line no-console
        console.log("[meta-lead-provisioning] SMS sent →", phone);
      }
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[meta-lead-provisioning] Twilio SMS error:", e);
    });
}

export async function provisionMetaLead(
  email: string,
  name: string | null | undefined,
  locale: EmailLocale = "de",
  phone?: string | null,
): Promise<ProvisionResult> {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  // Phone-based locale takes precedence if provided
  const effectiveLocale: EmailLocale = phone ? localeFromPhone(phone) : locale;

  const sb = getSupabaseAdmin();

  let userId: string;
  let created = true;
  let inviteUrl: string | null = null;

  // generateLink({ type: 'invite' }) erstellt den User OHNE Supabase-Email.
  // Bei bereits registrierten Usern schlägt es fehl → dann recovery-Link.
  const { data: linkData, error: linkErr } =
    await sb.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: name ? { full_name: name } : undefined,
        redirectTo: `${APP_URL}/auth/confirm`,
      },
    });

  if (linkErr) {
    const msg = linkErr.message?.toLowerCase() ?? "";
    if (
      msg.includes("already been registered") ||
      msg.includes("already exists") ||
      msg.includes("email address already exists")
    ) {
      // User existiert bereits → recovery-Link für Passwort-Reset
      const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const existing = users?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (!existing) {
        return { ok: false, reason: "user_not_found_after_conflict" };
      }
      userId = existing.id;
      created = false;

      // Recovery-Link für bestehenden User
      const { data: rec } = await sb.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${APP_URL}/auth/confirm` },
      });
      inviteUrl = rec?.properties?.action_link ?? null;
      if (!inviteUrl) {
        // eslint-disable-next-line no-console
        console.error(
          `[meta-lead-provisioning] recovery generateLink returned no action_link for ${email} — invite email will NOT be sent`,
        );
      }
    } else {
      return { ok: false, reason: linkErr.message };
    }
  } else {
    userId = linkData!.user!.id;
    inviteUrl = linkData?.properties?.action_link ?? null;
    if (!inviteUrl) {
      // eslint-disable-next-line no-console
      console.error(
        `[meta-lead-provisioning] invite generateLink returned no action_link for ${email} — invite email will NOT be sent`,
      );
    }
  }

  // Trial-Zeiten NICHT hier setzen — sie werden erst bei Aktivierung gesetzt
  // (POST /api/auth/activate-trial nach erfolgreichem verifyOtp).
  await sb.from("profiles").upsert(
    {
      user_id: userId,
      trial_start_at: null,
      trial_end_at: null,
      signup_source: "meta_lead",
      ...(name ? { display_name: name } : {}),
    },
    { onConflict: "user_id" },
  );

  // Gebrandete Email via Resend — nur wenn ein Link vorhanden ist
  if (inviteUrl) {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      const first = name?.trim().split(/\s+/)[0] ?? null;
      resend.emails
        .send({
          from: FROM,
          to: email,
          subject: metaLeadInviteSubject(first, effectiveLocale),
          html: metaLeadInviteHtml(first, inviteUrl, effectiveLocale, APP_URL),
        })
        .then(() => {
          // eslint-disable-next-line no-console
          console.log(`[meta-lead-provisioning] branded invite sent → ${email}`);
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[meta-lead-provisioning] Resend send failed:", e);
        });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[meta-lead-provisioning] RESEND_API_KEY missing — invite email not sent");
    }

    // SMS via Twilio (fire-and-forget, Fehler blockieren nicht den Webhook)
    if (phone) {
      void sendTwilioSms(phone, inviteUrl);
    }
  }

  // scheduleTrialEmails wird NICHT mehr hier aufgerufen — erst bei Aktivierung.

  return { ok: true, userId, created };
}
