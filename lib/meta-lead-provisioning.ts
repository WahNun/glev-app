// Shared utility: aus einem Meta-Lead einen Glev-Account anlegen.
// Wird vom Webhook (app/api/meta/leads/route.ts) aufgerufen.
// Identische Logik wie createMetaLeadAction, aber ohne Server-Action-Redirect.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { scheduleTrialEmails } from "@/lib/emails/drip-scheduler";
import type { EmailLocale } from "@/lib/emails/beta-welcome";

export type ProvisionResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: string };

export async function provisionMetaLead(
  email: string,
  name: string | null | undefined,
  locale: EmailLocale = "de",
): Promise<ProvisionResult> {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const sb = getSupabaseAdmin();
  const trialStartAt = new Date();
  const trialEndAt = new Date(
    trialStartAt.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  let userId: string;
  let created = true;

  const { data: invited, error: inviteErr } =
    await sb.auth.admin.inviteUserByEmail(email, {
      data: name ? { full_name: name } : undefined,
    });

  if (inviteErr) {
    const msg = inviteErr.message?.toLowerCase() ?? "";
    if (
      msg.includes("already been registered") ||
      msg.includes("already exists")
    ) {
      const {
        data: { users },
      } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const existing = users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (!existing) {
        return { ok: false, reason: "user_not_found_after_conflict" };
      }
      userId = existing.id;
      created = false;
    } else {
      return { ok: false, reason: inviteErr.message };
    }
  } else {
    userId = invited!.user!.id;
  }

  await sb.from("profiles").upsert(
    {
      user_id: userId,
      trial_end_at: trialEndAt,
      signup_source: "meta_lead",
    },
    { onConflict: "user_id" },
  );

  scheduleTrialEmails(email, name, trialStartAt, locale).catch((e) =>
    console.error("[meta-lead-provisioning] scheduleTrialEmails failed:", e),
  );

  return { ok: true, userId, created };
}
