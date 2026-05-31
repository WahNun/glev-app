// Shared utility: aus einem Meta-Lead einen Glev-Account anlegen.
// Wird vom Webhook (app/api/meta/leads/route.ts) aufgerufen.
//
// Email-Strategie: Supabase inviteUserByEmail schickt immer Englisch
// (globales Template, nicht pro-User steuerbar). Stattdessen:
//   1. generateLink({ type: 'invite' }) → erstellt User OHNE Email-Versand
//   2. Eigene gebrandete Email via Resend mit dem Magic Link

import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { scheduleTrialEmails } from "@/lib/emails/drip-scheduler";
import {
  metaLeadInviteHtml,
  metaLeadInviteSubject,
} from "@/lib/emails/meta-lead-invite";
import type { EmailLocale } from "@/lib/emails/beta-welcome";

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
  const trialStartAt = new Date();
  const trialEndAt = new Date(
    trialStartAt.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

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
    } else {
      return { ok: false, reason: linkErr.message };
    }
  } else {
    userId = linkData!.user!.id;
    inviteUrl = linkData?.properties?.action_link ?? null;
  }

  await sb.from("profiles").upsert(
    {
      user_id: userId,
      trial_end_at: trialEndAt,
      signup_source: "meta_lead",
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
  }

  scheduleTrialEmails(email, name, trialStartAt, effectiveLocale).catch((e) =>
    console.error("[meta-lead-provisioning] scheduleTrialEmails failed:", e),
  );

  return { ok: true, userId, created };
}
