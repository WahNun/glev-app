import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  loginAction,
  grantPlanByEmailAction,
  grantBetaFreeYearAction,
} from "./actions";
import { isAdminAuthed } from "@/lib/adminAuth";
import UsersTable, { type UserRow } from "./UsersTable";
import UserUpsertForm from "./UserUpsertForm";
import Link from "next/link";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";
import AdminLoginForm from "../_components/AdminLoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

/**
 * /admin/users — Stage 1 (Sehen).
 *
 * Lädt:
 *   - bis zu 200 User aus auth.users (sb.auth.admin.listUsers)
 *   - alle zugehörigen `profiles`-Zeilen (eine Round-Trip mit IN-Liste)
 *   - alle aktiven `cgm_credentials`-Zeilen (für Spalte „CGM verbunden")
 *
 * Der Filter (Plan / Trial / Zahlung / Gelöscht) und die Suche laufen
 * client-seitig in `UsersTable`. Das hält die Server-Komponente einfach
 * und gleichzeitig die UX flüssig (debounced search ohne Round-Trip).
 *
 * Pagination ist Stage 1 bewusst out-of-scope — die ersten 200 reichen
 * fürs MVP, im Listenkopf wird angezeigt, wenn das Limit erreicht ist.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Nutzer" error={err} />;
  }
  const sb = getSupabaseAdmin();

  let authErr: string | null = null;
  let authUsers: Array<{
    id: string;
    email: string | null | undefined;
    created_at: string;
    last_sign_in_at: string | null | undefined;
    email_confirmed_at: string | null | undefined;
    banned_until: string | null | undefined;
  }> = [];
  try {
    const { data, error } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: PAGE_SIZE,
    });
    if (error) throw error;
    authUsers = (data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: (u as { banned_until?: string | null }).banned_until,
    }));
  } catch (e) {
    authErr = e instanceof Error ? e.message : String(e);
  }

  const userIds = authUsers.map((u) => u.id);

  // Optionaler Zweit-SELECT für Spalten, die in einigen Umgebungen
  // (alte Migrationen) noch fehlen können. Wir trennen das vom
  // Haupt-SELECT, damit ein fehlendes Feld nicht die ganze Liste killt.
  // Wichtig für die Beta-Anzeige: alte Beta-Käufer:innen (Stripe-Produkt
  // vor 25.04.2026) haben KEINE Zeile in `beta_reservations`, sondern
  // wurden vom älteren Webhook direkt mit profiles.subscription_status=
  // 'beta' markiert (siehe app/api/webhooks/stripe/route.ts). Ohne
  // diesen optionalen Lookup würden sie als "Free" erscheinen.
  const [profilesRes, cgmRes, proRes, betaRes, profilesOptRes] = await Promise.all([
    userIds.length
      ? sb
          .from("profiles")
          // Wir selectieren bewusst NUR Spalten, die im Basis-Schema
          // garantiert existieren. Die Felder aus
          // 20260510_add_admin_user_management.sql
          // (manual_plan_override, manual_plan_note, manual_plan_set_at,
          // deleted_at, created_by_admin) und das Legacy-Feld
          // subscription_status sind in vielen Umgebungen noch nicht
          // migriert — wenn auch nur eine davon fehlt, schlägt der
          // ganze SELECT fehl und blendet den roten Banner ein.
          // Sobald die Migration läuft, kann man die Spalten hier
          // wieder ergänzen (siehe unten den row-Mapper, der schon
          // mit den optionalen Feldern umgehen kann).
          .select(
            "user_id, display_name, role, language, plan, cgm_connected, cgm_source, nightscout_url, trial_end_at, trial_start_at, signup_source",
          )
          .in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? sb.from("cgm_credentials").select("user_id, llu_email").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("pro_subscriptions")
      .select("email, status, trial_ends_at, current_period_end, currency, country")
      .order("created_at", { ascending: false })
      .limit(500),
    // Beta-Käufer:innen separat laden — `profiles.subscription_status` ist
    // noch nicht überall migriert, daher wäre `computeEffectivePlan`
    // alleine unzuverlässig für Beta-Erkennung. Source of truth ist die
    // beta_reservations-Tabelle (status='fulfilled' = bezahlt + freigeschaltet).
    sb
      .from("beta_reservations")
      .select("email, status, created_at, currency, country")
      .order("created_at", { ascending: false })
      .limit(500),
    // Best-effort: optionale Spalten. Wenn die Migration in dieser
    // Umgebung fehlt, bricht dieser SELECT — wir fangen das ab und
    // fallen still auf eine leere Map zurück, ohne die Hauptliste
    // zu beeinflussen.
    userIds.length
      ? sb
          .from("profiles")
          .select(
            "user_id, subscription_status, manual_plan_override, manual_plan_expires_at, manual_plan_note, gift_label, deleted_at, created_by_admin",
          )
          .in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type ProfRow = {
    user_id: string;
    display_name: string | null;
    role: string | null;
    language: string | null;
    plan: string | null;
    cgm_connected: boolean | null;
    cgm_source: string | null;
    nightscout_url: string | null;
    trial_end_at: string | null;
    trial_start_at: string | null;
    signup_source: string | null;
  };
  type CgmRow = { user_id: string; llu_email: string };
  type ProSubRow = {
    email: string;
    status: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    currency: string | null;
    country: string | null;
  };
  type BetaRow = {
    email: string;
    status: string | null;
    created_at: string | null;
    currency: string | null;
    country: string | null;
  };

  type ProfOptRow = {
    user_id: string;
    subscription_status: string | null;
    manual_plan_override: string | null;
    manual_plan_expires_at: string | null;
    manual_plan_note: string | null;
    gift_label: string | null;
    deleted_at: string | null;
    created_by_admin: boolean | null;
  };

  const profiles = (profilesRes.data ?? []) as ProfRow[];
  const cgms = (cgmRes.data ?? []) as CgmRow[];
  const pros = (proRes.data ?? []) as ProSubRow[];
  const betas = (betaRes.data ?? []) as BetaRow[];
  // Wenn der optionale SELECT fehlgeschlagen ist (Migration fehlt),
  // bekommen wir einfach eine leere Liste — UI fällt dann auf die
  // alten Defaults zurück.
  const profilesOpt = (profilesOptRes.data ?? []) as ProfOptRow[];

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const profileOptById = new Map(profilesOpt.map((p) => [p.user_id, p]));
  const lluByUser = new Map(cgms.map((c) => [c.user_id, c.llu_email]));
  const proByEmail = new Map(pros.map((p) => [p.email.toLowerCase(), p]));
  const betaByEmail = new Map(betas.map((b) => [b.email.toLowerCase(), b]));

  const rows: UserRow[] = authUsers.map((u) => {
    const p = profileById.get(u.id);
    const opt = profileOptById.get(u.id);
    const email = (u.email ?? "").toLowerCase();
    const pro = proByEmail.get(email);
    const beta = betaByEmail.get(email);
    // Effektiven Plan aus ALLEN verfügbaren Quellen berechnen — nicht
    // nur aus profiles.plan. Stripe schreibt profiles.plan='pro' erst
    // NACH der ersten echten Zahlung, während des 7-Tage-Trials steht
    // dort noch 'free'. Beta hat zwei Quellen: (a) neue Käufer:innen
    // landen in beta_reservations (status='fulfilled'), (b) alte
    // Käufer:innen vor 25.04.2026 wurden direkt mit
    // profiles.subscription_status='beta' markiert.
    let derivedPlan: string | null = p?.plan ?? null;
    if (pro?.status === "trialing" || pro?.status === "active") {
      derivedPlan = "pro";
    } else if (beta?.status === "fulfilled") {
      derivedPlan = "beta";
    } else if ((opt?.subscription_status ?? "").toLowerCase() === "beta") {
      derivedPlan = "beta";
    }
    const effective = computeEffectivePlan({
      manual_plan_override: opt?.manual_plan_override,
      manual_plan_expires_at: opt?.manual_plan_expires_at,
      plan: derivedPlan,
      subscription_status: opt?.subscription_status,
    });
    let cgmKind: "none" | "llu" | "nightscout" | "applehealth" | "junction" = "none";
    if (lluByUser.has(u.id)) cgmKind = "llu";
    else if (p?.nightscout_url) cgmKind = "nightscout";
    else if (p?.cgm_source === "apple_health") cgmKind = "applehealth";
    else if (p?.cgm_connected) cgmKind = "junction";

    return {
      id: u.id,
      email: u.email ?? "",
      display_name: p?.display_name ?? null,
      role: p?.role ?? "user",
      // WICHTIG: kein "de"-Fallback. profiles.language ist nur gesetzt,
      // wenn der User explizit im Settings-Screen umgestellt hat. Die
      // echte Runtime-Sprache kommt aus Cookie + Accept-Language-Header
      // (siehe next-intl-Setup) und kennen wir hier nicht. Ein stiller
      // "de"-Default wäre für UK/US-User irreführend.
      language: p?.language ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      banned_until: u.banned_until ?? null,
      plan: effective,
      // Diese vier Felder kommen aus dem optionalen Zweit-SELECT — wenn
      // die Migration fehlt, fallen wir still auf die alten Defaults
      // zurück (das war vorher auch das Verhalten).
      manual_plan_override: opt?.manual_plan_override ?? null,
      manual_plan_note: opt?.manual_plan_note ?? null,
      gift_label: opt?.gift_label ?? null,
      deleted_at: opt?.deleted_at ?? null,
      created_by_admin: opt?.created_by_admin ?? false,
      cgm: cgmKind,
      pro_status: pro?.status ?? null,
      trial_ends_at: pro?.trial_ends_at ?? null,
      profile_trial_end_at: p?.trial_end_at ?? null,
      profile_trial_start_at: p?.trial_start_at ?? null,
      signup_source: p?.signup_source ?? null,
      beta_status: beta?.status ?? null,
      // Currency + Land für den Filter — Pro hat Vorrang (Subscription
      // läuft ja noch, ist relevanter als eine evtl. ältere Beta-
      // Reservation derselben Person), sonst Beta. Beide Quellen sind
      // optional (alte Migration → null), die UI zeigt dann "—".
      currency:
        (pro?.currency ? pro.currency.toLowerCase() : null) ??
        (beta?.currency ? beta.currency.toLowerCase() : null) ??
        null,
      country:
        (pro?.country ? pro.country.toUpperCase() : null) ??
        (beta?.country ? beta.country.toUpperCase() : null) ??
        null,
      // Alte Beta-Käufer:innen (vor 25.04.2026) haben keine Reservation,
      // sondern stehen nur als profiles.subscription_status='beta'.
      // UsersTable nutzt das fürs Beta-Filter-Tab.
      legacy_beta:
        (opt?.subscription_status ?? "").toLowerCase() === "beta",
    };
  });

  const deletedParam = Array.isArray(sp.deleted) ? sp.deleted[0] : sp.deleted;
  const grantedParam = Array.isArray(sp.granted) ? sp.granted[0] : sp.granted;
  const grantedPlanParam = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const grantErrParam = Array.isArray(sp.grant_err) ? sp.grant_err[0] : sp.grant_err;
  const grantErrEmail = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const grantErrMsg =
    grantErrParam === "email"
      ? "Bitte gültige E-Mail eingeben."
      : grantErrParam === "plan"
        ? "Ungültiger Plan."
        : grantErrParam === "lookup"
          ? "User-Suche fehlgeschlagen — bitte später erneut versuchen."
          : grantErrParam === "notfound"
            ? `Keine Account mit ${grantErrEmail ?? "dieser E-Mail"} gefunden. User muss sich erst registriert haben.`
            : grantErrParam === "db"
              ? `Datenbank-Fehler beim Freischalten von ${grantErrEmail ?? "User"}.`
              : null;

  // Beta-Free-Year-Programm — eigene Banner + Fehler, damit man sieht
  // ob NUR der Plan oder auch Welcome-Mail+Drip durchgegangen sind.
  const bfyGrantedParam = Array.isArray(sp.bfy_granted)
    ? sp.bfy_granted[0]
    : sp.bfy_granted;
  const bfyUntilParam = Array.isArray(sp.until) ? sp.until[0] : sp.until;
  const bfyNewParam = Array.isArray(sp.new) ? sp.new[0] : sp.new;
  const bfyPlanParam = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const bfyErrParam = Array.isArray(sp.bfy_err) ? sp.bfy_err[0] : sp.bfy_err;
  const bfyErrMsg =
    bfyErrParam === "email"
      ? "Bitte gültige E-Mail eingeben."
      : bfyErrParam === "lookup"
        ? "User-Suche fehlgeschlagen — bitte später erneut versuchen."
        : bfyErrParam === "invite"
          ? `Konnte ${grantErrEmail ?? "User"} nicht neu anlegen — bitte Logs prüfen.`
          : bfyErrParam === "db"
            ? `Datenbank-Fehler beim Beta-Free-Year-Freischalten von ${grantErrEmail ?? "User"}.`
            : null;

  return (
    <main style={pageStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>
          Glev Admin — Nutzer ({rows.length}
          {rows.length === PAGE_SIZE ? "+" : ""})
        </h1>
        <Link href="/glev-ops/users/new" style={primaryBtnStyle}>
          + Nutzer anlegen
        </Link>
      </div>

      {/* Unified Upsert Form — ersetzt Quick-Grant + Free-Year + Nutzer-anlegen */}
      <UserUpsertForm />

      {deletedParam ? (
        <p style={successStyle}>
          User <strong>{deletedParam}</strong> wurde komplett gelöscht.
        </p>
      ) : null}
      {grantedParam ? (
        <p style={successStyle}>
          ✓ <strong>{grantedParam}</strong> wurde auf{" "}
          <strong>{grantedPlanParam ?? "—"}</strong> freigeschaltet (manueller
          Plan-Override gesetzt, hat Vorrang vor Stripe).
        </p>
      ) : null}
      {grantErrMsg ? <p style={errStyle}>{grantErrMsg}</p> : null}
      {bfyGrantedParam ? (
        <p style={successStyle}>
          ✓ <strong>{bfyGrantedParam}</strong> wurde ins{" "}
          <strong>{bfyPlanParam === "pro" ? "Pro" : "Beta"}-Free-Year-Programm</strong>
          {" "}aufgenommen — Zugang bis <strong>{bfyUntilParam ?? "—"}</strong>,
          Welcome-Mail{bfyPlanParam === "pro" ? "" : " + Drip (Tag 7/14/30)"} eingeplant.
          {bfyNewParam ? (
            <>
              {" "}<strong>Neuer Account angelegt</strong> — die Welcome-Mail
              enthält einen Login-Link, der zur Account-Einrichtung
              (Name + Passwort) führt.
            </>
          ) : null}
        </p>
      ) : null}
      {bfyErrMsg ? <p style={errStyle}>{bfyErrMsg}</p> : null}
      {authErr ? <p style={errStyle}>auth.users-Fehler: {authErr}</p> : null}
      {profilesRes.error ? (
        <p style={errStyle}>profiles-Fehler: {profilesRes.error.message}</p>
      ) : null}

      {/* Quick-Grant — DEPRECATED: Im neuen "User anlegen / Plan setzen"-Formular oben verfügbar */}
      <section style={{ ...grantBoxStyle, opacity: 0.5, pointerEvents: "none" }}>
        <div style={deprecatedBadge}>DEPRECATED — bitte neues Formular oben verwenden</div>
        <h2 style={{ fontSize: 14, margin: "0 0 4px", color: "#111", fontWeight: 700 }}>
          Schnell-Freischaltung per E-Mail
        </h2>
        <p style={{ fontSize: 12, color: "#666", margin: "0 0 12px" }}>
          User muss bereits registriert sein. Setzt einen manuellen
          Plan-Override — überschreibt Stripe-Status, ohne ihn zu verändern.
          Reversibel über die Detailseite.
        </p>
        <form
          action={grantPlanByEmailAction}
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          <input
            type="email"
            name="email"
            required
            placeholder="user@example.com"
            style={{ ...inputStyle, flex: "1 1 240px", minWidth: 200 }}
          />
          <select
            name="plan"
            defaultValue="beta"
            style={{ ...inputStyle, flex: "0 0 160px" }}
          >
            <option value="beta">S — Smart (9 €/Mo)</option>
            <option value="pro">M — Pro (14,90 €/Mo)</option>
            <option value="plus">L — Plus (29 €/Mo)</option>
            <option value="free">⛔ Free — Zugang entziehen</option>
          </select>
          <input
            type="text"
            name="note"
            placeholder="Notiz (optional, z.B. Name)"
            style={{ ...inputStyle, flex: "1 1 220px", minWidth: 180 }}
          />
          <button type="submit" style={btnStyle}>
            Freischalten
          </button>
        </form>
      </section>

      {/* Free-Year-Programm — DEPRECATED: Im neuen "User anlegen / Plan setzen"-Formular oben verfügbar */}
      <section style={{ ...bfyBoxStyle, opacity: 0.5, pointerEvents: "none" }}>
        <div style={deprecatedBadge}>DEPRECATED — bitte neues Formular oben verwenden</div>
        <h2 style={{ fontSize: 14, margin: "0 0 4px", color: "#065f46", fontWeight: 700 }}>
          Free-Year-Programm (Friends &amp; Family / Diabetolog:innen)
        </h2>
        <p style={{ fontSize: 12, color: "#065f46", margin: "0 0 12px" }}>
          1 Jahr kostenloser Zugang — wahlweise <strong>Beta</strong> (Friends
          &amp; Family, mit Onboarding-Drip Tag 7/14/30) oder <strong>Pro</strong>
          {" "}(Diabetolog:innen, Multiplikator:innen — ohne Drip).
          Sendet Welcome-Mail mit explizitem End-Datum.
          Funktioniert auch für noch <strong>nicht registrierte</strong> User
          — dann legen wir den Account stumm an, die Welcome-Mail enthält
          einen Login-Link, und auf <code>/welcome/beta</code> setzt
          die Person Name + Passwort. Idempotent — zweimal klicken schadet nicht.
        </p>
        <form
          action={grantBetaFreeYearAction}
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          <input
            type="email"
            name="email"
            required
            placeholder="user@example.com"
            style={{ ...inputStyle, flex: "1 1 200px", minWidth: 180 }}
          />
          <input
            type="text"
            name="fullName"
            placeholder="Name (optional, sonst fragen wir bei Signup)"
            style={{ ...inputStyle, flex: "1 1 200px", minWidth: 180 }}
          />
          <select
            name="plan"
            defaultValue="beta"
            style={{ ...inputStyle, flex: "0 0 200px", minWidth: 160 }}
            title="Plan-Auswahl"
          >
            <option value="beta">S — Smart (1 Jahr, Friends &amp; Family)</option>
            <option value="pro">M — Pro (1 Jahr, z.B. Diabetolog:innen)</option>
            <option value="plus">L — Plus (1 Jahr)</option>
          </select>
          <input
            type="text"
            name="note"
            placeholder='Notiz (optional)'
            style={{ ...inputStyle, flex: "1 1 180px", minWidth: 160 }}
          />
          <button type="submit" style={bfyBtnStyle}>
            1 Jahr freischalten + Welcome
          </button>
        </form>
      </section>

      {/* Backfill-Button ist nach /admin/settings umgezogen — er wird
          selten gebraucht und nahm hier nur Platz weg. */}

      <UsersTable rows={rows} pageSize={PAGE_SIZE} truncated={rows.length === PAGE_SIZE} />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1400,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};
const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#111",
  color: "#fff",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
};
const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 14,
  margin: "0 0 8px",
};
const grantBoxStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 14,
  marginBottom: 16,
};
const successStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 14,
  margin: "0 0 12px",
  background: "#ecfdf5",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #a7f3d0",
};
const bfyBoxStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  borderRadius: 8,
  padding: 14,
  marginBottom: 16,
};
const bfyBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#047857",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const deprecatedBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  background: "#6b7280",
  color: "#fff",
  borderRadius: 4,
  padding: "2px 6px",
  marginBottom: 8,
};
