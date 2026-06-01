"use server";

import { redirect } from "next/navigation";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie, isAdminAuthed } from "@/lib/adminAuth";
import { provisionMetaLead } from "@/lib/meta-lead-provisioning";

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");
  const ok = await verifyAdminCredentials(email, password, totp);
  if (!ok) redirect("/glev-ops/buyers?err=bad");
  await setAdminCookie();
  redirect("/glev-ops/buyers");
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect("/glev-ops/buyers");
}

/**
 * Admin: Meta-Lead-Account anlegen.
 *
 * Delegiert komplett an provisionMetaLead() — identisch zum echten
 * Meta-Webhook-Flow. Das stellt sicher dass Admin-Test-Leads und
 * echte Leads denselben Pfad durchlaufen:
 *   - Supabase User anlegen (generateLink statt inviteUserByEmail)
 *   - Profil: signup_source='meta_lead', trial_* = NULL
 *   - Branded Invite-Email via Resend
 *   - SMS via Twilio (wenn Telefonnummer angegeben)
 *   - Trial startet erst beim Link-Klick (activate-trial Route)
 */
export async function createMetaLeadAction(formData: FormData): Promise<void> {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers?err=bad");

  const email      = String(formData.get("email")      ?? "").trim().toLowerCase();
  const firstName  = String(formData.get("first_name") ?? "").trim();
  const lastName   = String(formData.get("last_name")  ?? "").trim();
  const name       = [firstName, lastName].filter(Boolean).join(" ") || null;
  const phone      = String(formData.get("phone")      ?? "").trim() || null;
  const localeRaw = String(formData.get("locale")  ?? "de");
  const locale: "de" | "en" = localeRaw === "en" ? "en" : "de";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/glev-ops/buyers?lead_err=invalid_email");
  }

  const result = await provisionMetaLead(email, name, locale, phone || undefined);

  if (!result.ok) {
    redirect(`/glev-ops/buyers?lead_err=${encodeURIComponent(result.reason)}`);
  }

  redirect("/glev-ops/buyers?created=1");
}
