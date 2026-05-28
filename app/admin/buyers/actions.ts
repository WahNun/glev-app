"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "crypto";

const COOKIE = "glev_admin_token";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function loginAction(formData: FormData): Promise<void> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    redirect("/admin/buyers?err=server");
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect("/admin/buyers?err=bad");
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin/buyers");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  redirect("/admin/buyers");
}

export async function isAdminAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) return false;
  const store = await cookies();
  const tok = store.get(COOKIE)?.value ?? "";
  if (!tok) return false;
  return constantTimeEqual(tok, expected);
}

/**
 * Admin: Meta-Lead-Account anlegen.
 *
 * Erstellt einen neuen Supabase-User per inviteUserByEmail (Supabase schickt
 * den Setup-Link automatisch), setzt trial_end_at = jetzt + 7 Tage und
 * signup_source = 'meta_lead' im Profile, und scheduliert die Drip-Mails
 * (Tag 6 Reminder + Tag 7 Expired).
 *
 * Wenn die E-Mail-Adresse schon existiert, wird nur das Profil aktualisiert
 * (kein zweites Invite).
 */
export async function createMetaLeadAction(formData: FormData): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
  const { scheduleTrialEmails } = await import("@/lib/emails/drip-scheduler");

  const authed = await isAdminAuthed();
  if (!authed) redirect("/admin/buyers?err=bad");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const localeRaw = String(formData.get("locale") ?? "de");
  const locale: "de" | "en" = localeRaw === "en" ? "en" : "de";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/admin/buyers?lead_err=invalid_email");
  }

  const sb = getSupabaseAdmin();
  const trialStartAt = new Date();
  const trialEndAt = new Date(
    trialStartAt.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  let userId: string;

  const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
    data: name ? { full_name: name } : undefined,
  });

  if (inviteErr) {
    if (inviteErr.message?.toLowerCase().includes("already been registered") ||
        inviteErr.message?.toLowerCase().includes("already exists")) {
      const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const existing = users.find((u) => u.email?.toLowerCase() === email);
      if (!existing) {
        redirect(`/admin/buyers?lead_err=create_failed`);
      }
      userId = existing.id;
    } else {
      redirect(`/admin/buyers?lead_err=create_failed`);
    }
  } else {
    userId = invited!.user!.id;
  }

  await sb.from("profiles").upsert(
    { user_id: userId, trial_end_at: trialEndAt, signup_source: "meta_lead" },
    { onConflict: "user_id" },
  );

  scheduleTrialEmails(email, name, trialStartAt, locale).catch((e) =>
    console.warn("[admin/buyers/createMetaLead] scheduleTrialEmails failed:", e),
  );

  redirect("/admin/buyers?created=1");
}
