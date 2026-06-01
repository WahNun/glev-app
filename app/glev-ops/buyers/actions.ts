"use server";

import { redirect } from "next/navigation";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie, isAdminAuthed } from "@/lib/adminAuth";
import { provisionMetaLead } from "@/lib/meta-lead-provisioning";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
 * CRM: Vorname / Nachname / Telefon eines Trial-Users aktualisieren.
 *
 * Berührt NUR:
 *   - auth.users.user_metadata.full_name  (Supabase merged user_metadata → keine
 *     anderen Metadaten-Keys gehen verloren)
 *   - auth.users.user_metadata.phone      (ebenfalls merged)
 *   - profiles.display_name               (only diese eine Spalte)
 *
 * NICHT berührt: plan, manual_plan_override, trial_start_at, trial_end_at,
 * signup_source, beta_reservations, pro_subscriptions — nichts davon.
 */
export async function updateTrialUserAction(formData: FormData): Promise<void> {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers?err=bad");

  const userId    = String(formData.get("userId")     ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName  = String(formData.get("last_name")  ?? "").trim();
  const phone     = String(formData.get("phone")      ?? "").trim() || null;
  const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;

  if (!userId) redirect("/glev-ops/buyers");

  const sb = getSupabaseAdmin();

  // 1. auth.users: user_metadata merge (nie ein Replace — andere Keys bleiben erhalten)
  const metaPatch: Record<string, string | null> = {};
  if (fullName !== null) metaPatch.full_name = fullName;
  metaPatch.phone = phone; // null löscht das Feld

  await sb.auth.admin.updateUserById(userId, {
    user_metadata: metaPatch,
  });

  // 2. profiles: nur display_name — keine Plan-Felder
  if (fullName !== null) {
    await sb
      .from("profiles")
      .update({ display_name: fullName })
      .eq("user_id", userId);
  }

  redirect(`/glev-ops/buyers/${userId}?saved=1`);
}

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
