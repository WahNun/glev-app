import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loginAction } from "./actions";
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
      trial_start_at: p?.trial_start_at,
      trial_end_at: p?.trial_end_at,
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
      {authErr ? <p style={errStyle}>auth.users-Fehler: {authErr}</p> : null}
      {profilesRes.error ? (
        <p style={errStyle}>profiles-Fehler: {profilesRes.error.message}</p>
      ) : null}

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
const successStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 14,
  margin: "0 0 12px",
  background: "#ecfdf5",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #a7f3d0",
};
