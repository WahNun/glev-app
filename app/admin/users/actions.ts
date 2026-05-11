"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { writeAuditLog, isSchemaMissingError } from "@/lib/admin/audit";

/**
 * Server actions for /admin/users (Stages 1-3).
 *
 * Auth: same shared `glev_admin_token` cookie + `ADMIN_API_SECRET`
 * pattern as /admin/buyers, /admin/drip, /admin/emails. The cookie is
 * scoped to /admin so a single login covers every admin tab.
 *
 * Every mutating action (Stage 2 + 3):
 *   1. asserts auth via `requireAdminToken()` — throws if not
 *   2. performs the action via the service-role Supabase client
 *   3. writes an audit log row with the SHA-256 prefix of the cookie token
 *   4. revalidates the affected /admin/users paths so the UI re-renders
 *
 * Hard-deletes are intentionally CASCADED via Supabase's auth.admin
 * deleteUser API — that takes care of meals/insulin/cycle/etc. via the
 * existing FK ON DELETE CASCADE wiring on user_id.
 */

const COOKIE = "glev_admin_token";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// ---------------------------------------------------------------------------
// Login / logout / auth probe (mirrors app/admin/buyers/actions.ts so the
// /admin/users entry point can show its own login form on first hit and
// redirect back to /admin/users — not /admin/buyers — after login).
// ---------------------------------------------------------------------------

export async function loginAction(formData: FormData): Promise<void> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    redirect("/admin/users?err=server");
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect("/admin/users?err=bad");
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin/users");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  redirect("/admin/users");
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
 * Returns the raw cookie token if the operator is authenticated, else
 * throws. The token is needed by every mutating action so we can hash
 * it into the audit log.
 */
async function requireAdminToken(): Promise<string> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    throw new Error("ADMIN_API_SECRET nicht konfiguriert");
  }
  const store = await cookies();
  const tok = store.get(COOKIE)?.value ?? "";
  if (!tok || !constantTimeEqual(tok, expected)) {
    throw new Error("nicht eingeloggt");
  }
  return tok;
}

function revalidateUserPaths(userId?: string | null): void {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

// ---------------------------------------------------------------------------
// Stage 2 — Plan / Status / Daten editieren
// ---------------------------------------------------------------------------

/**
 * Setzt einen manuellen Plan-Override für einen User. Diese Spalte hat
 * Vorrang vor `profiles.plan` (was die Stripe-Webhooks schreiben), so
 * können wir Friends-&-Family / Tester:innen Pro/Beta freischalten,
 * ohne dass Stripe involviert ist.
 *
 * `plan = 'free'` dient gleichzeitig als „Pro entziehen, ohne Stripe-
 * Status zu verändern" — z.B. wenn jemand sein Geld zurückerhalten hat
 * und wir den Zugang sofort sperren wollen.
 */
export async function setManualPlanAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!userId) throw new Error("userId fehlt");
  if (!["free", "beta", "pro"].includes(plan)) throw new Error("ungültiger plan");

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, manual_plan_override, manual_plan_note, plan, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({
      manual_plan_override: plan,
      manual_plan_note: note,
      manual_plan_set_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    if (isSchemaMissingError(error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    throw new Error("supabase: " + error.message);
  }

  await writeAuditLog({
    action: "set_manual_plan",
    targetUserId: userId,
    before,
    after: { manual_plan_override: plan, manual_plan_note: note },
    note: `${(before as { manual_plan_override?: string } | null)?.manual_plan_override ?? "—"} → ${plan}`,
    adminToken,
  });

  revalidateUserPaths(userId);
}

export async function clearManualPlanAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("userId fehlt");

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, manual_plan_override, manual_plan_note")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({
      manual_plan_override: null,
      manual_plan_note: null,
      manual_plan_set_at: null,
    })
    .eq("user_id", userId);

  if (error) {
    if (isSchemaMissingError(error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    throw new Error("supabase: " + error.message);
  }

  await writeAuditLog({
    action: "clear_manual_plan",
    targetUserId: userId,
    before,
    after: { manual_plan_override: null },
    adminToken,
  });

  revalidateUserPaths(userId);
}

/**
 * E-Mail manuell als bestätigt markieren. Nützlich, wenn jemand seinen
 * Bestätigungslink verloren hat und wir ihn ohne Mail-Roundtrip
 * freischalten wollen.
 */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("userId fehlt");

  const sb = getSupabaseAdmin();
  const { error } = await sb.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });
  if (error) throw new Error("auth: " + error.message);

  await writeAuditLog({
    action: "confirm_email",
    targetUserId: userId,
    adminToken,
  });

  revalidateUserPaths(userId);
}

/**
 * CGM-Verbindung trennen. Löscht die Zeile in `cgm_credentials`
 * (LibreLinkUp) und resettet die Nightscout-Felder + cgm_connected
 * Flag im Profil.
 */
export async function disconnectCgmAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("userId fehlt");

  const sb = getSupabaseAdmin();
  await sb.from("cgm_credentials").delete().eq("user_id", userId);
  await sb
    .from("profiles")
    .update({
      nightscout_url: null,
      nightscout_token_enc: null,
      junction_user_id: null,
      cgm_connected: false,
      cgm_source: null,
    })
    .eq("user_id", userId);

  await writeAuditLog({
    action: "disconnect_cgm",
    targetUserId: userId,
    adminToken,
  });

  revalidateUserPaths(userId);
}

/**
 * Soft-Delete. User bleibt in der DB (zur Wiederherstellung), wird
 * aber für 100 Jahre gebannt (kein Login mehr möglich) und mit
 * `deleted_at` markiert. Stripe-Subscriptions werden NICHT gekündigt
 * — das ist eine separate Entscheidung.
 */
export async function softDeleteAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const confirmEmail = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (!userId) throw new Error("userId fehlt");
  if (!confirmEmail) throw new Error("E-Mail-Bestätigung fehlt");

  const sb = getSupabaseAdmin();
  const { data: authData } = await sb.auth.admin.getUserById(userId);
  const realEmail = authData?.user?.email?.toLowerCase() ?? "";
  if (realEmail !== confirmEmail) {
    throw new Error("E-Mail-Bestätigung passt nicht zur User-E-Mail");
  }

  // Long ban duration as a soft "blocked" marker — Supabase has no
  // native disable-flag, so we use ban_duration. Reversible via
  // restoreUserAction below.
  const { error: banErr } = await sb.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (banErr) throw new Error("auth: " + banErr.message);

  const { error: softErr } = await sb
    .from("profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (softErr && isSchemaMissingError(softErr)) {
    // Spalte deleted_at fehlt — Ban (oben) ist trotzdem schon gesetzt.
    // Den Operator informieren statt 500 zu werfen.
    redirect(`/admin/users/${userId}?err=migration`);
  }

  await writeAuditLog({
    action: "soft_delete",
    targetUserId: userId,
    targetEmail: realEmail,
    adminToken,
  });

  revalidateUserPaths(userId);
}

export async function restoreUserAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("userId fehlt");

  const sb = getSupabaseAdmin();
  const { error: banErr } = await sb.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (banErr) throw new Error("auth: " + banErr.message);

  const { error: restoreErr } = await sb
    .from("profiles")
    .update({ deleted_at: null })
    .eq("user_id", userId);
  if (restoreErr && isSchemaMissingError(restoreErr)) {
    redirect(`/admin/users/${userId}?err=migration`);
  }

  await writeAuditLog({
    action: "restore_user",
    targetUserId: userId,
    adminToken,
  });

  revalidateUserPaths(userId);
}

// ---------------------------------------------------------------------------
// Stage 3 — Anlegen / Hard-Delete / Rolle
// ---------------------------------------------------------------------------

/**
 * Manuell User anlegen. Drei Modi für die Authentifizierung:
 *   - `password`     → wir setzen ein Passwort jetzt, User kann sich
 *                       direkt einloggen
 *   - `magiclink`    → Supabase generiert einen Magic-Link, der per
 *                       Mail rausgeht (User wählt selbst Passwort)
 *   - `invite`       → klassische Supabase-Invite (Mail mit Setup-Link)
 *
 * `plan` setzt direkt einen `manual_plan_override` (siehe oben), so
 * dass z.B. "Pro für Lebenszeit" sofort ohne Stripe gilt.
 */
export async function createUserAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim() || null;
  const language = String(formData.get("language") ?? "de");
  const plan = String(formData.get("plan") ?? "free");
  const planNote = String(formData.get("planNote") ?? "").trim() || null;
  const authMode = String(formData.get("authMode") ?? "invite");
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "user");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Ungültige E-Mail");
  }
  if (!["free", "beta", "pro"].includes(plan)) {
    throw new Error("Ungültiger Plan");
  }
  if (!["de", "en"].includes(language)) {
    throw new Error("Ungültige Sprache");
  }
  if (!["password", "magiclink", "invite"].includes(authMode)) {
    throw new Error("Ungültiger Auth-Modus");
  }
  if (!["user", "admin"].includes(role)) {
    throw new Error("Ungültige Rolle");
  }

  const sb = getSupabaseAdmin();

  let userId: string;
  if (authMode === "password") {
    if (password.length < 8) {
      throw new Error("Passwort muss mindestens 8 Zeichen haben");
    }
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (error || !data?.user?.id) {
      throw new Error("auth.createUser: " + (error?.message ?? "unbekannt"));
    }
    userId = data.user.id;
  } else if (authMode === "invite") {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: appUrl ? `${appUrl}/auth/confirm` : undefined,
      data: fullName ? { full_name: fullName } : undefined,
    });
    if (error || !data?.user?.id) {
      throw new Error("auth.inviteUserByEmail: " + (error?.message ?? "unbekannt"));
    }
    userId = data.user.id;
  } else {
    // magiclink: create the user (no password) and then send a magic link
    const { data: createData, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createErr || !createData?.user?.id) {
      throw new Error("auth.createUser: " + (createErr?.message ?? "unbekannt"));
    }
    userId = createData.user.id;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const { error: linkErr } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: appUrl ? { redirectTo: `${appUrl}/dashboard` } : undefined,
    });
    if (linkErr) {
      // Best-effort — user exists, magic-link just failed to send.
      // Operator can re-send from the detail page.
      // eslint-disable-next-line no-console
      console.warn("[admin/users/createUser] magic link send failed:", linkErr.message);
    }
  }

  // Profile-Zeile sollte vom auth-trigger automatisch entstanden sein —
  // wir patchen sie jetzt mit Sprache, Display-Name, manuellem Plan
  // und created_by_admin Flag.
  // Falls die Zeile aus irgendeinem Grund nicht existiert (race), upserten.
  const profilePatch: Record<string, unknown> = {
    user_id: userId,
    language,
    display_name: fullName,
    role,
    created_by_admin: true,
  };
  if (plan !== "free") {
    profilePatch.manual_plan_override = plan;
    profilePatch.manual_plan_note = planNote;
    profilePatch.manual_plan_set_at = new Date().toISOString();
  }

  const { error: profErr } = await sb
    .from("profiles")
    .upsert(profilePatch, { onConflict: "user_id" });
  if (profErr) {
    if (isSchemaMissingError(profErr)) {
      // User wurde in auth.users angelegt, aber Profile-Patch (mit
      // created_by_admin / manual_plan_*) ist gescheitert weil Migration
      // fehlt. User ist nutzbar, nur ohne diese Marker.
      redirect(`/admin/users/${userId}?err=migration_partial`);
    }
    // eslint-disable-next-line no-console
    console.warn("[admin/users/createUser] profile upsert warning:", profErr.message);
  }

  await writeAuditLog({
    action: "create_user",
    targetUserId: userId,
    targetEmail: email,
    after: { plan, role, authMode, language, fullName, created_by_admin: true },
    note: planNote ?? undefined,
    adminToken,
  });

  redirect(`/admin/users/${userId}`);
}

/**
 * Hard-Delete. Cascade-Löschung über Supabase's auth.admin.deleteUser:
 * der User in auth.users wird gelöscht, und alle FK-Referenzen mit
 * `ON DELETE CASCADE` (meals, insulin_logs, exercise_logs,
 * fingerstick_readings, user_settings, cgm_credentials, profiles, ...)
 * gehen mit. Nicht reversibel.
 */
export async function hardDeleteAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const confirmEmail = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (!userId) throw new Error("userId fehlt");
  if (!confirmEmail) throw new Error("E-Mail-Bestätigung fehlt");

  const sb = getSupabaseAdmin();
  const { data: authData } = await sb.auth.admin.getUserById(userId);
  const realEmail = authData?.user?.email?.toLowerCase() ?? "";
  if (realEmail !== confirmEmail) {
    throw new Error("E-Mail-Bestätigung passt nicht zur User-E-Mail");
  }

  await writeAuditLog({
    action: "hard_delete",
    targetUserId: userId,
    targetEmail: realEmail,
    note: "irreversibel",
    adminToken,
  });

  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) throw new Error("auth.deleteUser: " + error.message);

  revalidatePath("/admin/users");
  redirect("/admin/users?deleted=" + encodeURIComponent(realEmail));
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "user");
  if (!userId) throw new Error("userId fehlt");
  if (!["user", "admin"].includes(role)) throw new Error("Ungültige Rolle");

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({ role })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);

  await writeAuditLog({
    action: "set_role",
    targetUserId: userId,
    before,
    after: { role },
    note: `${(before as { role?: string } | null)?.role ?? "—"} → ${role}`,
    adminToken,
  });

  revalidateUserPaths(userId);
}

/**
 * Re-send a magic-link to an existing user. Used from the detail page
 * when an invited user lost their original mail or the operator wants
 * to give them a fresh login link without resetting their password.
 */
export async function sendMagicLinkAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!userId || !email) throw new Error("userId und email erforderlich");

  const sb = getSupabaseAdmin();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const { error } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: appUrl ? { redirectTo: `${appUrl}/dashboard` } : undefined,
  });
  if (error) throw new Error("auth: " + error.message);

  await writeAuditLog({
    action: "send_magic_link",
    targetUserId: userId,
    targetEmail: email,
    adminToken,
  });

  revalidateUserPaths(userId);
}
