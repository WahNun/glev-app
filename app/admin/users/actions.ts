"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";
import { writeAuditLog, isSchemaMissingError } from "@/lib/admin/audit";
import { enqueueEmail } from "@/lib/emails/outbox";
import { scheduleDripEmails } from "@/lib/emails/drip-scheduler";
import type { EmailLocale } from "@/lib/emails/beta-welcome";

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
// Quick-Grant: per E-Mail einen manuellen Plan vergeben (Beta-Freischaltung
// für Friends-&-Family ohne Stripe). Auf /admin/users im Kopf eingebaut,
// damit man ohne Klick durch die Liste & Detailseite jemanden freischalten
// kann.
// ---------------------------------------------------------------------------

export async function grantPlanByEmailAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const plan = String(formData.get("plan") ?? "beta");
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/admin/users?grant_err=email");
  }
  if (!["free", "beta", "pro"].includes(plan)) {
    redirect("/admin/users?grant_err=plan");
  }

  const sb = getSupabaseAdmin();

  // auth.users hat keinen direkten getByEmail-Endpoint im Admin-SDK — wir
  // paginieren bis zu 1000 User durch (ausreichend für unsere Größe) und
  // matchen case-insensitive auf die E-Mail.
  let found: { id: string; email?: string } | null = null;
  try {
    const { data, error } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw error;
    found =
      (data?.users ?? []).find(
        (u) => (u.email ?? "").toLowerCase() === email,
      ) ?? null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[admin/users/grantByEmail] listUsers failed:", e);
    redirect("/admin/users?grant_err=lookup");
  }

  if (!found) {
    redirect(`/admin/users?grant_err=notfound&email=${encodeURIComponent(email)}`);
  }
  const userId = found.id;

  const { data: before } = await sb
    .from("profiles")
    .select("user_id, manual_plan_override, manual_plan_note, plan")
    .eq("user_id", userId)
    .maybeSingle();

  const { error: updErr } = await sb
    .from("profiles")
    .update({
      manual_plan_override: plan,
      manual_plan_note: note ?? `Freigeschaltet via Quick-Grant (${plan})`,
      manual_plan_set_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updErr) {
    if (isSchemaMissingError(updErr)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    redirect(`/admin/users?grant_err=db&email=${encodeURIComponent(email)}`);
  }

  await writeAuditLog({
    action: "grant_plan_by_email",
    targetUserId: userId,
    targetEmail: email,
    before,
    after: { manual_plan_override: plan, manual_plan_note: note },
    note: `Quick-Grant: ${(before as { manual_plan_override?: string } | null)?.manual_plan_override ?? "—"} → ${plan}`,
    adminToken,
  });

  revalidateUserPaths(userId);
  redirect(
    `/admin/users?granted=${encodeURIComponent(email)}&plan=${plan}`,
  );
}

// ---------------------------------------------------------------------------
// Beta-Free-Year-Programm: 1 Jahr kostenloser Beta-Zugang als Friends-&-
// Family-Geschenk. Wie Quick-Grant, plus:
//   - manual_plan_expires_at = jetzt + 1 Jahr (Override läuft automatisch
//     ab — siehe computeEffectivePlan)
//   - Welcome-Mail mit explizitem End-Datum geht in die Outbox
//   - User wird in den Standard-Drip eingeplant (Tag 7/14/30) — gleicher
//     Onboarding-Touch wie Beta-Käufer:innen
// ---------------------------------------------------------------------------

const BETA_FREE_YEAR_DAYS = 365;

export async function grantBetaFreeYearAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Plan-Auswahl: "beta" (default, Friends & Family wie gehabt) oder
  // "pro" (Diabetolog:innen / Multiplikator:innen — selber Mechanismus,
  // setzt manual_plan_override="pro" statt "beta", Welcome-Mail spricht
  // dann von „Pro" statt „Beta"; Drip-Sequenz wird für Pro übersprungen
  // weil sie Beta-Onboarding-spezifisch ist).
  const planRaw = String(formData.get("plan") ?? "beta").trim().toLowerCase();
  const plan: "beta" | "pro" = planRaw === "pro" ? "pro" : "beta";
  const planTitle = plan === "pro" ? "Pro" : "Beta";
  const note =
    String(formData.get("note") ?? "").trim() ||
    `${planTitle}-Free-Year-Programm`;
  // Optionaler Name aus dem Admin-Block — wird (a) als profiles.display_name
  // gesetzt UND (b) als user_metadata.full_name in den Supabase-Invite
  // mitgegeben, sodass die Begrüßung in der Welcome-Mail den richtigen
  // Vornamen nutzt. Wenn leer, fragt die /welcome/beta-Maske den Namen
  // beim Signup ab (Pflichtfeld), weil das Onboarding ihn aktuell nicht
  // erfasst — siehe Q&A im Admin-UI-Hilfetext.
  const fullNameFromForm = String(formData.get("fullName") ?? "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/admin/users?bfy_err=email");
  }

  const sb = getSupabaseAdmin();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
    || "https://glev.app";

  // User in auth.users finden — gleiche Pagination-Strategie wie
  // grantPlanByEmailAction (Supabase-Admin-SDK hat keinen getByEmail).
  let found: { id: string; email?: string } | null = null;
  try {
    const { data, error } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw error;
    found =
      (data?.users ?? []).find(
        (u) => (u.email ?? "").toLowerCase() === email,
      ) ?? null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[admin/users/betaFreeYear] listUsers failed:", e);
    redirect("/admin/users?bfy_err=lookup");
  }

  // Wenn kein User existiert → Friends-&-Family-Invite-Pfad: wir legen
  // den Account stumm an (createUser, email_confirm=true, kein Passwort)
  // und erzeugen einen magic-Login-Link via generateLink. Den Link
  // kleben wir in unsere eigene Welcome-Mail (statt Supabase die generic
  // "You've been invited" Mail rauspusten zu lassen). Der Empfänger
  // klickt → /welcome/beta etabliert Session → Maske fragt Name + Passwort.
  let userId: string;
  let signupUrl: string | null = null;
  let isNewUser = false;
  if (!found) {
    isNewUser = true;
    try {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: fullNameFromForm ? { full_name: fullNameFromForm } : {},
      });
      if (createErr || !created?.user?.id) {
        // eslint-disable-next-line no-console
        console.warn(
          "[admin/users/betaFreeYear] createUser failed:",
          createErr?.message,
        );
        redirect(`/admin/users?bfy_err=invite&email=${encodeURIComponent(email)}`);
      }
      userId = created.user.id;

      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${appUrl}/welcome/beta` },
      });
      if (linkErr || !linkData?.properties?.action_link) {
        // eslint-disable-next-line no-console
        console.warn(
          "[admin/users/betaFreeYear] generateLink failed:",
          linkErr?.message,
        );
        // User ist angelegt — wir lassen sie ohne Signup-URL durchlaufen
        // (Welcome-Mail kommt mit /dashboard-CTA, dort kann der User per
        // "Passwort vergessen" aufs Konto kommen). Best-effort.
      } else {
        signupUrl = linkData.properties.action_link;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[admin/users/betaFreeYear] new-user setup failed:", e);
      redirect(`/admin/users?bfy_err=invite&email=${encodeURIComponent(email)}`);
    }
  } else {
    userId = found.id;
    // Bestehender User bekommt ebenfalls einen Magic-Link, damit er
    // ohne manuelles Login direkt auf /dashboard landet. Best-effort:
    // wenn generateLink scheitert, läuft die Mail mit /dashboard-CTA
    // weiter — der User kann sich dort normal einloggen.
    try {
      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${appUrl}/dashboard` },
      });
      if (!linkErr && linkData?.properties?.action_link) {
        signupUrl = linkData.properties.action_link;
      }
    } catch {
      // stiller Fail — Mail geht trotzdem raus
    }
  }

  // Profil holen (Sprache + Anzeige-Name für Mail), inklusive Vorzustand
  // für den Audit-Log. Bei brand-neuen Usern existiert die Zeile evtl.
  // schon (auth-Trigger) — sonst greift unten der Upsert.
  const { data: before } = await sb
    .from("profiles")
    .select(
      "user_id, manual_plan_override, manual_plan_expires_at, manual_plan_note, plan, language, display_name",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const beforeRow = before as
    | {
        manual_plan_override?: string | null;
        manual_plan_expires_at?: string | null;
        manual_plan_note?: string | null;
        plan?: string | null;
        language?: string | null;
        display_name?: string | null;
      }
    | null;

  const expiresAt = new Date(
    Date.now() + BETA_FREE_YEAR_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Effektiver Name: Form-Eingabe hat Vorrang vor existierendem Profil-
  // Eintrag (Operator hat ihn gerade explizit eingegeben), sonst was
  // schon im Profil steht.
  const effectiveDisplayName = fullNameFromForm ?? beforeRow?.display_name ?? null;

  // Bei brand-neuen Usern müssen wir UPSERTEN (Profile-Zeile existiert
  // evtl. noch nicht), bei existierenden reicht UPDATE.
  const planPatch: Record<string, unknown> = {
    manual_plan_override: plan,
    manual_plan_expires_at: expiresAt,
    manual_plan_note: note,
    manual_plan_set_at: new Date().toISOString(),
  };
  if (fullNameFromForm) {
    planPatch.display_name = fullNameFromForm;
  }
  const updRes = isNewUser
    ? await sb.from("profiles").upsert(
        { user_id: userId, language: "de", created_by_admin: true, ...planPatch },
        { onConflict: "user_id" },
      )
    : await sb.from("profiles").update(planPatch).eq("user_id", userId);

  if (updRes.error) {
    if (isSchemaMissingError(updRes.error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    redirect(`/admin/users?bfy_err=db&email=${encodeURIComponent(email)}`);
  }

  // Sprache fürs Mailing — Profil ist die Quelle der Wahrheit, default
  // ist Deutsch (matches app-weiter Default).
  const locale: EmailLocale = beforeRow?.language === "en" ? "en" : "de";
  const displayName = effectiveDisplayName;

  // Welcome-Mail in die Outbox. Dedupe-Key bindet an User-ID + „bfy" —
  // wenn der Operator versehentlich zweimal klickt, bekommt der User
  // trotzdem nur eine Mail (zweiter Insert findet die existierende Row
  // via partial unique index auf (template, dedupe_key) und gibt deren
  // ID zurück — siehe enqueueEmail-Doku).
  try {
    await enqueueEmail({
      recipient: email,
      template: "beta-free-year-welcome",
      payload: {
        name: displayName,
        appUrl,
        expiresAt,
        locale,
        signupUrl,
        plan,
      },
      // Dedupe-Key bindet Plan mit ein, damit ein versehentliches
      // Pro-Upgrade nach einer früheren Beta-Mail keinen Welcome
      // verschluckt (alte Beta-Mail wäre sonst dedupliziert).
      dedupeKey: `bfy:${userId}:${plan}`,
    });
  } catch (e) {
    // Profile ist bereits aktualisiert — Mail-Fehler nicht eskalieren,
    // sonst sieht es im UI so aus als wäre nichts passiert. Der Operator
    // kann die Mail später aus /admin/emails manuell triggern.
    // eslint-disable-next-line no-console
    console.warn("[admin/users/betaFreeYear] enqueueEmail failed:", e);
  }

  // Drip-Sequenz (Tag 7/14/30) einplanen — nur für Beta. Pro-Käufer
  // (oder hier Pro-Geschenkte) durchlaufen kein Beta-Onboarding-Drip,
  // sonst kriegen Diabetolog:innen Beta-Tipps die für sie irrelevant sind.
  if (plan === "beta") {
    try {
      await scheduleDripEmails(email, displayName, "beta", locale);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[admin/users/betaFreeYear] scheduleDripEmails failed:", e);
    }
  }

  await writeAuditLog({
    action: plan === "pro" ? "grant_pro_free_year" : "grant_beta_free_year",
    targetUserId: userId,
    targetEmail: email,
    before: beforeRow,
    after: {
      manual_plan_override: plan,
      manual_plan_expires_at: expiresAt,
      manual_plan_note: note,
    },
    note: `${planTitle} Free Year — läuft bis ${expiresAt.slice(0, 10)}`,
    adminToken,
  });

  revalidateUserPaths(userId);
  redirect(
    `/admin/users?bfy_granted=${encodeURIComponent(email)}&until=${encodeURIComponent(expiresAt.slice(0, 10))}&plan=${plan}${isNewUser ? "&new=1" : ""}`,
  );
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

  const durationDays = parseInt(String(formData.get("durationDays") ?? "0"), 10);

  if (!userId) throw new Error("userId fehlt");
  if (!["free", "beta", "pro", "plus"].includes(plan)) throw new Error("ungültiger plan");

  const now = new Date();
  const expiresAt =
    durationDays > 0
      ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

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
      manual_plan_set_at: now.toISOString(),
      manual_plan_expires_at: expiresAt,
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

/**
 * Sprache (UI-Locale) eines Users manuell setzen — `de` oder `en`.
 * Schreibt `profiles.language`, das ist die Quelle für `next-intl`'s
 * Locale-Resolution (vor Cookie + Accept-Language-Header). Ändert
 * NICHTS an Stripe/Currency — die zwei sind absichtlich entkoppelt,
 * z.B. ein Schweizer User kann CHF zahlen aber UI auf Englisch wollen.
 */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const language = String(formData.get("language") ?? "");
  if (!userId) throw new Error("userId fehlt");
  if (!["de", "en"].includes(language)) {
    throw new Error("language muss 'de' oder 'en' sein");
  }

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, language")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({ language })
    .eq("user_id", userId);

  if (error) {
    if (isSchemaMissingError(error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    throw new Error("supabase: " + error.message);
  }

  await writeAuditLog({
    action: "set_language",
    targetUserId: userId,
    before,
    after: { language },
    note: `${(before as { language?: string | null } | null)?.language ?? "—"} → ${language}`,
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
 * Setzt ein informatives Gift-Label auf einem User-Profil.
 * Das Label ist rein deskriptiv — das eigentliche Plan-Grant muss
 * separat via setManualPlanAction gesetzt werden.
 */
export async function setGiftLabelAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!userId) throw new Error("userId fehlt");
  if (!label) throw new Error("label darf nicht leer sein");

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, gift_label")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({ gift_label: label })
    .eq("user_id", userId);

  if (error) {
    if (isSchemaMissingError(error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    throw new Error("supabase: " + error.message);
  }

  await writeAuditLog({
    action: "set_gift_label",
    targetUserId: userId,
    before,
    after: { gift_label: label },
    note: `${(before as { gift_label?: string | null } | null)?.gift_label ?? "—"} → ${label}`,
    adminToken,
  });

  redirect(`/admin/users/${userId}?gift_ok=${encodeURIComponent(label)}`);
}

/**
 * Entfernt das Gift-Label von einem User-Profil.
 */
export async function clearGiftLabelAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("userId fehlt");

  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("profiles")
    .select("user_id, gift_label")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await sb
    .from("profiles")
    .update({ gift_label: null })
    .eq("user_id", userId);

  if (error) {
    if (isSchemaMissingError(error)) {
      redirect(`/admin/users/${userId}?err=migration`);
    }
    throw new Error("supabase: " + error.message);
  }

  await writeAuditLog({
    action: "clear_gift_label",
    targetUserId: userId,
    before,
    after: { gift_label: null },
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

/**
 * „Sperren & Abo kündigen" — eine kombinierte Aktion für den Fall
 * dass ein Operator eine:n User:in komplett ausserdienstlich machen
 * will (z.B. Missbrauch, Erstattung + Hinauswurf):
 *
 *   1) Stripe-Subscription SOFORT kündigen (`subscriptions.cancel`,
 *      kein period_end-Grace), falls eine aktive Pro-Sub existiert.
 *      Best-effort: wenn Stripe ablehnt (z.B. schon cancelled), läuft
 *      der Ban trotzdem durch — die User:in soll auf jeden Fall raus.
 *   2) Supabase-User für 100 Jahre bannen (`ban_duration`), was den
 *      Login-Refresh blockiert. Aktive Access-Tokens (JWT) bleiben
 *      bis zu ~1h gültig — danach kann der Refresh nicht mehr
 *      erneuern und der User fliegt automatisch raus. Wir können
 *      JWTs server-seitig nicht früher invalidieren (Supabase hat
 *      keinen Admin-`deleteSessions`-Endpoint).
 *   3) `profiles.deleted_at` setzen — gleicher Marker wie Soft-Delete,
 *      damit existing Code (z.B. /admin/users-Liste) den User als
 *      „gelöscht" sieht und Restore über denselben Button geht.
 *
 * Reversibel via `restoreUserAction` (unbannt + `deleted_at` clear).
 * Die Stripe-Sub wird beim Restore NICHT reaktiviert — der User
 * müsste sich neu via Checkout abonnieren.
 */
export async function cancelAndBanAction(formData: FormData): Promise<void> {
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

  // 1) Stripe-Sub kündigen (best-effort). Wir suchen die letzte
  //    nicht-bereits-gekündigte Pro-Sub für diese E-Mail. Wenn keine
  //    existiert (z.B. Free-User), überspringen wir diesen Schritt
  //    komplett — der Ban läuft trotzdem.
  let stripeResult: { subId: string; status: string } | null = null;
  let stripeError: string | null = null;
  try {
    const { data: subRow } = await sb
      .from("pro_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("email", realEmail)
      .neq("status", "cancelled")
      .maybeSingle();

    const subId = (subRow as { stripe_subscription_id?: string | null } | null)
      ?.stripe_subscription_id;
    if (subId) {
      const stripe = getStripe();
      const cancelled = await stripe.subscriptions.cancel(subId);
      stripeResult = { subId, status: cancelled.status };

      // Lokal spiegeln, damit /admin sofort „cancelled" zeigt ohne auf
      // den customer.subscription.deleted-Webhook warten zu müssen.
      await sb
        .from("pro_subscriptions")
        .update({ status: "cancelled" })
        .eq("stripe_subscription_id", subId);
    }
  } catch (e) {
    // Stripe-Fehler darf den Ban NICHT verhindern. Wir loggen ihn in
    // den Audit-Log und gehen weiter — der Operator sieht den Fehler
    // im Audit-Log-Block der Detail-Seite.
    stripeError = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn("[admin/users/cancelAndBan] stripe cancel failed:", stripeError);
  }

  // 2) Supabase-Ban (gleicher Mechanismus wie softDeleteAction).
  const { error: banErr } = await sb.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (banErr) throw new Error("auth: " + banErr.message);

  // 3) `deleted_at` setzen, damit Listen/UI den User als gesperrt
  //    rendern und der Restore-Button erscheint.
  const { error: softErr } = await sb
    .from("profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (softErr && isSchemaMissingError(softErr)) {
    redirect(`/admin/users/${userId}?err=migration`);
  }

  // Auch die `profiles.plan` direkt auf free zurücksetzen, falls der
  // Stripe-Cancel-Webhook noch nicht durchgelaufen ist — sonst sieht
  // der gesperrte User beim nächsten Token-Refresh kurz vor Ban-Wirkung
  // noch „pro" und das ist verwirrend in den Audit-Logs.
  await sb
    .from("profiles")
    .update({ plan: "free", subscription_status: "cancelled" })
    .eq("user_id", userId);

  await writeAuditLog({
    action: "cancel_and_ban",
    targetUserId: userId,
    targetEmail: realEmail,
    after: stripeResult
      ? { stripe_sub: stripeResult.subId, stripe_status: stripeResult.status }
      : { stripe_sub: null, reason: "no active sub" },
    note: stripeError
      ? `Stripe-Cancel fehlgeschlagen: ${stripeError} — Ban trotzdem gesetzt`
      : stripeResult
        ? "Sub gekündigt + User gebannt (Login ≤1h JWT-Restlaufzeit)"
        : "Keine aktive Sub gefunden — nur User gebannt",
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
 * Backfill `currency` und `country` auf `pro_subscriptions` und
 * `beta_reservations` aus der Stripe-API. Lädt für jede Zeile, der noch
 * Werte fehlen, die zugehörige Stripe Checkout Session und übernimmt
 * `session.currency` (3-letter ISO, lowercase) und
 * `session.customer_details.address.country` (2-letter ISO, uppercase).
 *
 * Ausgelegt für eine einmalige Operator-Ausführung — wenn die Tabelle
 * mal sehr groß wird, kann man den `limit(500)`-Schritt durch eine
 * Schleife mit `range()` erweitern. Für jetzt ist 500 mehr als genug.
 *
 * Idempotent: bereits gefüllte Felder werden NICHT überschrieben (nur
 * NULL → Wert), und Zeilen ohne `stripe_session_id` werden übersprungen
 * (die kann man nur via Customer rückwärts auflösen, das wäre ein
 * separater zweiter Pass).
 */
export async function backfillCurrencyCountryAction(): Promise<void> {
  const adminToken = await requireAdminToken();
  const sb = getSupabaseAdmin();
  const stripe = getStripe();

  let proUpdated = 0;
  let proSkipped = 0;
  let betaUpdated = 0;
  let betaSkipped = 0;
  let errors = 0;

  // ---- pro_subscriptions ------------------------------------------------
  const { data: proRows, error: proErr } = await sb
    .from("pro_subscriptions")
    .select("id, stripe_session_id, currency, country")
    .or("currency.is.null,country.is.null")
    .limit(500);

  if (proErr) {
    // eslint-disable-next-line no-console
    console.error("[backfill] pro_subscriptions select failed:", proErr.code, proErr.message);
    errors++;
  } else {
    for (const row of (proRows ?? []) as Array<{
      id: string;
      stripe_session_id: string | null;
      currency: string | null;
      country: string | null;
    }>) {
      if (!row.stripe_session_id) {
        proSkipped++;
        continue;
      }
      try {
        const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id, {
          expand: ["customer_details"],
        });
        const update: Record<string, unknown> = {};
        if (!row.currency && typeof session.currency === "string") {
          update.currency = session.currency.toLowerCase();
        }
        if (!row.country && typeof session.customer_details?.address?.country === "string") {
          update.country = session.customer_details.address.country.toUpperCase();
        }
        if (Object.keys(update).length === 0) {
          proSkipped++;
          continue;
        }
        const { error: upErr } = await sb
          .from("pro_subscriptions")
          .update(update)
          .eq("id", row.id);
        if (upErr) {
          // eslint-disable-next-line no-console
          console.error("[backfill] pro_subscriptions update failed:", row.id, upErr.message);
          errors++;
        } else {
          proUpdated++;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[backfill] stripe sessions.retrieve failed (pro):", row.stripe_session_id, e);
        errors++;
      }
    }
  }

  // ---- beta_reservations ------------------------------------------------
  // Currency hat hier einen Default ('eur'), wir füllen also primär `country`.
  // Trotzdem auch `currency` mitziehen, falls jemand explizit USD bezahlt
  // hat und die alte Default-Spalte das überdeckt.
  const { data: betaRows, error: betaErr } = await sb
    .from("beta_reservations")
    .select("id, stripe_session_id, currency, country")
    .is("country", null)
    .limit(500);

  if (betaErr) {
    // eslint-disable-next-line no-console
    console.error("[backfill] beta_reservations select failed:", betaErr.code, betaErr.message);
    errors++;
  } else {
    for (const row of (betaRows ?? []) as Array<{
      id: string;
      stripe_session_id: string | null;
      currency: string | null;
      country: string | null;
    }>) {
      if (!row.stripe_session_id) {
        betaSkipped++;
        continue;
      }
      try {
        const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id, {
          expand: ["customer_details"],
        });
        const update: Record<string, unknown> = {};
        if (typeof session.customer_details?.address?.country === "string") {
          update.country = session.customer_details.address.country.toUpperCase();
        }
        // Currency nur überschreiben, wenn die DB-Zeile noch den
        // 'eur'-Default trägt UND Stripe was anderes geliefert hat.
        if (
          typeof session.currency === "string" &&
          session.currency.toLowerCase() !== (row.currency ?? "").toLowerCase()
        ) {
          update.currency = session.currency.toLowerCase();
        }
        if (Object.keys(update).length === 0) {
          betaSkipped++;
          continue;
        }
        const { error: upErr } = await sb
          .from("beta_reservations")
          .update(update)
          .eq("id", row.id);
        if (upErr) {
          // eslint-disable-next-line no-console
          console.error("[backfill] beta_reservations update failed:", row.id, upErr.message);
          errors++;
        } else {
          betaUpdated++;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[backfill] stripe sessions.retrieve failed (beta):", row.stripe_session_id, e);
        errors++;
      }
    }
  }

  await writeAuditLog({
    action: "backfill_currency_country",
    note: `pro: ${proUpdated} updated / ${proSkipped} skipped · beta: ${betaUpdated} updated / ${betaSkipped} skipped · errors: ${errors}`,
    adminToken,
  });

  // Backfill-Button lebt jetzt unter /admin/settings (vorher direkt auf
  // /admin/users); UsersPage neu rendern, aber zur Settings-Seite
  // zurückspringen, damit das Ergebnis-Banner dort sichtbar wird.
  revalidatePath("/admin/users");
  revalidatePath("/admin/settings");
  redirect(
    `/admin/settings?backfill=ok&pro=${proUpdated}&beta=${betaUpdated}&skipped=${proSkipped + betaSkipped}&errors=${errors}`,
  );
}

/**
 * Re-send a magic-link to an existing user. Used from the detail page
 * when an invited user lost their original mail or the operator wants
 * to give them a fresh login link without resetting their password.
 */
/**
 * Schickt dem User eine Passwort-Reset-Email — mit unserem eigenen
 * bilingualen Glev-Template (de/en) statt Supabase's generic Recovery-
 * Mail.
 *
 * Flow:
 *   1. profiles.language + display_name laden (Sprache + Personalisierung)
 *   2. Supabase generateLink({type:'recovery'}) → action_link holen
 *   3. action_link in unsere `password-reset`-Template einkleben und
 *      via outbox/Resend schicken (gleiche Pipeline wie Beta-Welcome)
 *   4. Audit-Log: "send_password_reset"
 *
 * Das aktuelle Passwort des Users bleibt gültig, bis er den Link
 * klickt und ein neues setzt (Supabase-Standardverhalten, in der
 * Mail explizit erwähnt).
 */
export async function sendPasswordResetAction(formData: FormData): Promise<void> {
  const adminToken = await requireAdminToken();
  const userId = String(formData.get("userId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!userId || !email) throw new Error("userId und email erforderlich");

  const sb = getSupabaseAdmin();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  // Sprache + Anzeigename aus dem Profil ziehen, damit die Mail in der
  // Sprache des Users rausgeht (Default: de).
  const { data: profileRow } = await sb
    .from("profiles")
    .select("language, display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const profile = (profileRow ?? null) as
    | { language?: string | null; display_name?: string | null }
    | null;
  const locale: EmailLocale = profile?.language === "en" ? "en" : "de";
  const displayName = profile?.display_name ?? null;

  // Recovery-Link bei Supabase erzeugen. generateLink liefert den
  // action_link zurück — Supabase verschickt dabei KEINE eigene Mail
  // (das Senden übernehmen wir mit unserem bilingualen Template).
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: "recovery",
    email,
    options: appUrl ? { redirectTo: `${appUrl}/auth/confirm` } : undefined,
  });
  if (linkErr || !linkData?.properties?.action_link) {
    throw new Error("auth: " + (linkErr?.message ?? "kein action_link"));
  }
  const resetUrl = linkData.properties.action_link;

  await enqueueEmail({
    recipient: email,
    template: "password-reset",
    payload: {
      name: displayName,
      resetUrl,
      appUrl: appUrl || null,
      locale,
    },
  });

  await writeAuditLog({
    action: "send_password_reset",
    targetUserId: userId,
    targetEmail: email,
    adminToken,
  });

  revalidateUserPaths(userId);
}

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
