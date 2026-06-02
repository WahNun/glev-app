import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import { loginAction } from "./actions";
import AdminLoginForm from "../_components/AdminLoginForm";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";
import CrmView, { type CrmUserRow, type CrmBetaRow, type CrmProRow } from "./CrmView";
import Link from "next/link";
import { grantPlanByEmailAction, grantBetaFreeYearAction } from "../users/actions";
import { createMetaLeadAction } from "../buyers/actions";
import ActivatePendingButton from "../buyers/ActivatePendingButton";
import ReminderButton from "../buyers/ReminderButton";
import BulkSmsButton from "../buyers/BulkSmsButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="CRM" error={err} />;
  }

  const createdParam = Array.isArray(sp.created) ? sp.created[0] : sp.created;
  const leadErrParam = Array.isArray(sp.lead_err) ? sp.lead_err[0] : sp.lead_err;
  const deletedParam = Array.isArray(sp.deleted) ? sp.deleted[0] : sp.deleted;
  const grantedParam = Array.isArray(sp.granted) ? sp.granted[0] : sp.granted;
  const grantedPlanParam = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const grantErrParam = Array.isArray(sp.grant_err) ? sp.grant_err[0] : sp.grant_err;
  const grantErrEmail = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const bfyGrantedParam = Array.isArray(sp.bfy_granted) ? sp.bfy_granted[0] : sp.bfy_granted;
  const bfyUntilParam = Array.isArray(sp.until) ? sp.until[0] : sp.until;
  const bfyNewParam = Array.isArray(sp.new) ? sp.new[0] : sp.new;
  const bfyPlanParam = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const bfyErrParam = Array.isArray(sp.bfy_err) ? sp.bfy_err[0] : sp.bfy_err;

  const grantErrMsg =
    grantErrParam === "email" ? "Bitte gültige E-Mail eingeben."
    : grantErrParam === "plan" ? "Ungültiger Plan."
    : grantErrParam === "lookup" ? "User-Suche fehlgeschlagen — bitte später erneut versuchen."
    : grantErrParam === "notfound" ? `Kein Account mit ${grantErrEmail ?? "dieser E-Mail"} gefunden. User muss sich erst registriert haben.`
    : grantErrParam === "db" ? `Datenbank-Fehler beim Freischalten von ${grantErrEmail ?? "User"}.`
    : null;

  const bfyErrMsg =
    bfyErrParam === "email" ? "Bitte gültige E-Mail eingeben."
    : bfyErrParam === "lookup" ? "User-Suche fehlgeschlagen — bitte später erneut versuchen."
    : bfyErrParam === "invite" ? `Konnte ${grantErrEmail ?? "User"} nicht neu anlegen — bitte Logs prüfen.`
    : bfyErrParam === "db" ? `Datenbank-Fehler beim Beta-Free-Year-Freischalten von ${grantErrEmail ?? "User"}.`
    : null;

  const sb = getSupabaseAdmin();

  const [authUsersRes, profilesRes, cgmRes, proRes, betaRes, profilesOptRes, trialProfilesRes, clicksRes] =
    await Promise.all([
      sb.auth.admin.listUsers({ page: 1, perPage: PAGE_SIZE }),
      sb.from("profiles").select(
        "user_id, display_name, role, language, plan, cgm_connected, cgm_source, nightscout_url, trial_end_at, trial_start_at, signup_source, onboarding_completed_at, created_at",
      ),
      sb.from("cgm_credentials").select("user_id, llu_email"),
      sb.from("pro_subscriptions")
        .select("id, email, full_name, status, trial_ends_at, current_period_end, stripe_session_id, stripe_customer_id, stripe_subscription_id, currency, country, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      sb.from("beta_reservations")
        .select("id, email, full_name, status, amount_cents, currency, stripe_session_id, created_at, fulfilled_at")
        .order("created_at", { ascending: false })
        .limit(500),
      sb.from("profiles").select(
        "user_id, subscription_status, manual_plan_override, manual_plan_expires_at, manual_plan_note, gift_label, deleted_at, created_by_admin",
      ),
      sb.from("profiles")
        .select("user_id, trial_start_at, trial_end_at, signup_source, created_at, onboarding_completed_at")
        .or("trial_end_at.not.is.null,signup_source.eq.meta_lead")
        .order("created_at", { ascending: false })
        .limit(500),
      sb.from("short_links")
        .select("owner_email, source, clicked_at")
        .not("owner_email", "is", null)
        .not("clicked_at", "is", null),
    ]);

  const authUsers = (authUsersRes.data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
    user_metadata: u.user_metadata ?? {},
  }));

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
    onboarding_completed_at: string | null;
    created_at: string | null;
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
  type ProSubRow = {
    id: string;
    email: string;
    full_name: string | null;
    status: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    stripe_session_id: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    currency: string | null;
    country: string | null;
    created_at: string | null;
  };
  type BetaResRow = {
    id: string;
    email: string;
    full_name: string | null;
    status: string | null;
    amount_cents: number | null;
    currency: string | null;
    country: string | null;
    stripe_session_id: string | null;
    created_at: string | null;
    fulfilled_at: string | null;
  };

  const profiles = (profilesRes.data ?? []) as ProfRow[];
  const profilesOpt = (profilesOptRes.data ?? []) as ProfOptRow[];
  const cgms = (cgmRes.data ?? []) as { user_id: string; llu_email: string }[];
  const pros = (proRes.data ?? []) as ProSubRow[];
  const betas = (betaRes.data ?? []) as BetaResRow[];

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const profileOptById = new Map(profilesOpt.map((p) => [p.user_id, p]));
  const lluByUser = new Map(cgms.map((c) => [c.user_id, c.llu_email]));
  const proByEmail = new Map(pros.map((p) => [p.email.toLowerCase(), p]));
  const betaByEmail = new Map(betas.map((b) => [b.email.toLowerCase(), b]));

  const authUserMap = new Map(authUsers.map((u) => [u.id, u]));
  const authUserByEmail = new Map(authUsers.map((u) => [u.email.toLowerCase(), u]));

  const clickMap = new Map<string, { sms: boolean; email: boolean }>();
  for (const row of clicksRes.data ?? []) {
    const ownerEmail = ((row.owner_email as string) ?? "").toLowerCase();
    if (!ownerEmail) continue;
    const cur = clickMap.get(ownerEmail) ?? { sms: false, email: false };
    const src = (row.source as string | null) ?? "";
    if (src.includes("sms")) cur.sms = true;
    if (src.includes("email")) cur.email = true;
    clickMap.set(ownerEmail, cur);
  }

  const trialProfileMap = new Map(
    (trialProfilesRes.data ?? []).map((p) => [p.user_id as string, p]),
  );

  const users: CrmUserRow[] = authUsers.map((u) => {
    const p = profileById.get(u.id);
    const opt = profileOptById.get(u.id);
    const emailLower = u.email.toLowerCase();
    const pro = proByEmail.get(emailLower);
    const beta = betaByEmail.get(emailLower);
    const trialP = trialProfileMap.get(u.id);
    const clicks = clickMap.get(emailLower);

    let derivedPlan: string | null = p?.plan ?? null;
    if (pro?.status === "trialing" || pro?.status === "active") derivedPlan = "pro";
    else if (beta?.status === "fulfilled") derivedPlan = "beta";
    else if ((opt?.subscription_status ?? "").toLowerCase() === "beta") derivedPlan = "beta";

    const effective = computeEffectivePlan({
      manual_plan_override: opt?.manual_plan_override,
      manual_plan_expires_at: opt?.manual_plan_expires_at,
      plan: derivedPlan,
      subscription_status: opt?.subscription_status,
    });

    let cgmKind: CrmUserRow["cgm"] = "none";
    if (lluByUser.has(u.id)) cgmKind = "llu";
    else if (p?.nightscout_url) cgmKind = "nightscout";
    else if (p?.cgm_source === "apple_health") cgmKind = "applehealth";
    else if (p?.cgm_connected) cgmKind = "junction";

    return {
      id: u.id,
      email: u.email,
      display_name: p?.display_name ?? null,
      role: p?.role ?? "user",
      language: p?.language ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: u.banned_until,
      plan: effective,
      manual_plan_override: opt?.manual_plan_override ?? null,
      manual_plan_note: opt?.manual_plan_note ?? null,
      gift_label: opt?.gift_label ?? null,
      deleted_at: opt?.deleted_at ?? null,
      created_by_admin: opt?.created_by_admin ?? false,
      cgm: cgmKind,
      pro_status: pro?.status ?? null,
      trial_ends_at: pro?.trial_ends_at ?? null,
      profile_trial_end_at: trialP?.trial_end_at as string | null ?? p?.trial_end_at ?? null,
      profile_trial_start_at: trialP?.trial_start_at as string | null ?? p?.trial_start_at ?? null,
      signup_source: trialP?.signup_source as string | null ?? p?.signup_source ?? null,
      beta_status: beta?.status ?? null,
      legacy_beta: (opt?.subscription_status ?? "").toLowerCase() === "beta",
      currency:
        (pro?.currency ? pro.currency.toLowerCase() : null) ??
        (beta?.currency ? beta.currency.toLowerCase() : null) ??
        null,
      country:
        (pro?.country ? pro.country.toUpperCase() : null) ??
        (beta?.country ? beta.country.toUpperCase() : null) ??
        null,
      phone: (u.user_metadata?.phone as string | null) ?? null,
      onboarding_completed_at: trialP?.onboarding_completed_at as string | null ?? null,
      sms_clicked: clicks?.sms ?? false,
      email_clicked: clicks?.email ?? false,
    };
  });

  const betaRows: CrmBetaRow[] = betas.map((r) => ({
    id: r.id,
    email: r.email,
    full_name: r.full_name,
    status: r.status,
    amount_cents: r.amount_cents,
    currency: r.currency,
    stripe_session_id: r.stripe_session_id,
    created_at: r.created_at,
    fulfilled_at: r.fulfilled_at,
    user_id: authUserByEmail.get(r.email.toLowerCase())?.id,
  }));

  const proRows: CrmProRow[] = pros.map((r) => ({
    id: r.id,
    email: r.email,
    full_name: r.full_name,
    status: r.status,
    trial_ends_at: r.trial_ends_at,
    current_period_end: r.current_period_end,
    stripe_session_id: r.stripe_session_id,
    created_at: r.created_at,
    user_id: authUserByEmail.get(r.email.toLowerCase())?.id,
  }));

  const authErr = authUsersRes.error?.message ?? null;

  return (
    <main style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>
          CRM{" "}
          <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>
            {users.length} Nutzer · {betaRows.length} Beta · {proRows.length} Pro
          </span>
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/glev-ops/users/new" style={primaryBtn}>+ Nutzer anlegen</Link>
        </div>
      </div>

      {authErr && <p style={errStyle}>auth.users-Fehler: {authErr}</p>}
      {deletedParam && <p style={successStyle}>User <strong>{deletedParam}</strong> wurde komplett gelöscht.</p>}
      {grantedParam && <p style={successStyle}>✓ <strong>{grantedParam}</strong> wurde auf <strong>{grantedPlanParam ?? "—"}</strong> freigeschaltet.</p>}
      {grantErrMsg && <p style={errStyle}>{grantErrMsg}</p>}
      {bfyGrantedParam && (
        <p style={successStyle}>
          ✓ <strong>{bfyGrantedParam}</strong> wurde ins <strong>{bfyPlanParam === "pro" ? "Pro" : "Beta"}-Free-Year-Programm</strong> aufgenommen — Zugang bis <strong>{bfyUntilParam ?? "—"}</strong>, Welcome-Mail{bfyPlanParam === "pro" ? "" : " + Drip (Tag 7/14/30)"} eingeplant.
          {bfyNewParam ? <> <strong>Neuer Account angelegt</strong> — Login-Link in der Welcome-Mail.</> : null}
        </p>
      )}
      {bfyErrMsg && <p style={errStyle}>{bfyErrMsg}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginBottom: 24 }}>
        <section style={panelStyle}>
          <h2 style={panelTitle}>Meta-Lead anlegen — 7-Tage Trial</h2>
          {createdParam === "1" && <p style={successStyle}>✓ Account angelegt. Invite-Email + SMS (falls Telefon) verschickt.</p>}
          {leadErrParam && <p style={errStyle}>Fehler: {leadErrParam === "invalid_email" ? "Ungültige E-Mail." : leadErrParam === "create_failed" ? "Account konnte nicht angelegt werden." : leadErrParam}</p>}
          <form action={createMetaLeadAction} style={flexForm}>
            <input name="first_name" type="text" placeholder="Vorname" style={inputStyle} />
            <input name="last_name" type="text" placeholder="Nachname" style={inputStyle} />
            <input name="email" type="email" required placeholder="E-Mail *" style={{ ...inputStyle, flex: "1 1 200px" }} />
            <input name="phone" type="tel" placeholder="+4917612345678" style={{ ...inputStyle, minWidth: 160 }} />
            <select name="locale" style={inputStyle}>
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
            <button type="submit" style={btnStyle}>Lead anlegen →</button>
          </form>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <ActivatePendingButton />
            <ReminderButton />
            <BulkSmsButton />
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={panelTitle}>Schnell-Freischaltung</h2>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px" }}>User muss bereits registriert sein. Setzt manuellen Plan-Override.</p>
          <form action={grantPlanByEmailAction} style={flexForm}>
            <input type="email" name="email" required placeholder="user@example.com" style={{ ...inputStyle, flex: "1 1 200px" }} />
            <select name="plan" defaultValue="beta" style={inputStyle}>
              <option value="beta">S — Smart</option>
              <option value="pro">M — Pro</option>
              <option value="plus">L — Plus</option>
              <option value="free">⛔ Free entziehen</option>
            </select>
            <input type="text" name="note" placeholder="Notiz (optional)" style={{ ...inputStyle, flex: "1 1 160px" }} />
            <button type="submit" style={btnStyle}>Freischalten</button>
          </form>
        </section>

        <section style={{ ...panelStyle, background: "#ecfdf5", borderColor: "#a7f3d0" }}>
          <h2 style={{ ...panelTitle, color: "#065f46" }}>Free-Year-Programm</h2>
          <p style={{ fontSize: 12, color: "#065f46", margin: "0 0 10px" }}>1 Jahr kostenloser Zugang. Funktioniert auch für noch nicht registrierte User.</p>
          <form action={grantBetaFreeYearAction} style={flexForm}>
            <input type="email" name="email" required placeholder="user@example.com" style={{ ...inputStyle, flex: "1 1 180px" }} />
            <input type="text" name="fullName" placeholder="Name (optional)" style={{ ...inputStyle, flex: "1 1 160px" }} />
            <select name="plan" defaultValue="beta" style={inputStyle}>
              <option value="beta">S — Smart (Friends &amp; Family)</option>
              <option value="pro">M — Pro (Diabetolog:innen)</option>
              <option value="plus">L — Plus</option>
            </select>
            <input type="text" name="note" placeholder="Notiz (optional)" style={{ ...inputStyle, flex: "1 1 140px" }} />
            <button type="submit" style={{ ...btnStyle, background: "#047857" }}>1 Jahr + Welcome →</button>
          </form>
        </section>
      </div>

      <CrmView users={users} beta={betaRows} pro={proRows} pageSize={PAGE_SIZE} />
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
const panelStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "16px 18px",
  background: "#fafafa",
};
const panelTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 10px" };
const inputStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, fontFamily: "inherit", minWidth: 120 };
const btnStyle: React.CSSProperties = { padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const flexForm: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" };
const primaryBtn: React.CSSProperties = { padding: "8px 14px", background: "#111", color: "#fff", borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: "none" };
const errStyle: React.CSSProperties = { color: "#c00", fontSize: 14, margin: "0 0 10px" };
const successStyle: React.CSSProperties = { color: "#047857", fontSize: 14, margin: "0 0 10px", background: "#ecfdf5", padding: "8px 12px", borderRadius: 6, border: "1px solid #a7f3d0" };
