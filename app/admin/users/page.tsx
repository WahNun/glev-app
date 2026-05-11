import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction } from "./actions";
import UsersTable, { type UserRow } from "./UsersTable";
import Link from "next/link";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";

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
    const err =
      errParam === "bad"
        ? "Falsches Token."
        : errParam === "server"
          ? "ADMIN_API_SECRET ist nicht konfiguriert."
          : null;
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev Admin — Nutzer</h1>
        <p style={{ marginBottom: 16, color: "#555" }}>
          Internal-only. Bitte das <code>ADMIN_API_SECRET</code> einfügen.
        </p>
        <form
          action={loginAction}
          style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}
        >
          <input
            type="password"
            name="token"
            autoComplete="off"
            required
            placeholder="ADMIN_API_SECRET"
            style={inputStyle}
          />
          <button type="submit" style={btnStyle}>
            Einloggen
          </button>
          {err ? <span style={{ color: "#c00", fontSize: 14 }}>{err}</span> : null}
        </form>
      </main>
    );
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

  const [profilesRes, cgmRes, proRes] = await Promise.all([
    userIds.length
      ? sb
          .from("profiles")
          .select(
            "user_id, display_name, role, language, plan, subscription_status, manual_plan_override, manual_plan_note, deleted_at, created_by_admin, cgm_connected, cgm_source, nightscout_url",
          )
          .in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? sb.from("cgm_credentials").select("user_id, llu_email").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("pro_subscriptions")
      .select("email, status, trial_ends_at, current_period_end")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  type ProfRow = {
    user_id: string;
    display_name: string | null;
    role: string | null;
    language: string | null;
    plan: string | null;
    subscription_status: string | null;
    manual_plan_override: string | null;
    manual_plan_note: string | null;
    deleted_at: string | null;
    created_by_admin: boolean | null;
    cgm_connected: boolean | null;
    cgm_source: string | null;
    nightscout_url: string | null;
  };
  type CgmRow = { user_id: string; llu_email: string };
  type ProSubRow = {
    email: string;
    status: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
  };

  const profiles = (profilesRes.data ?? []) as ProfRow[];
  const cgms = (cgmRes.data ?? []) as CgmRow[];
  const pros = (proRes.data ?? []) as ProSubRow[];

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const lluByUser = new Map(cgms.map((c) => [c.user_id, c.llu_email]));
  const proByEmail = new Map(pros.map((p) => [p.email.toLowerCase(), p]));

  const rows: UserRow[] = authUsers.map((u) => {
    const p = profileById.get(u.id);
    const email = (u.email ?? "").toLowerCase();
    const pro = proByEmail.get(email);
    const effective = computeEffectivePlan({
      manual_plan_override: p?.manual_plan_override,
      plan: p?.plan,
      subscription_status: p?.subscription_status,
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
      language: p?.language ?? "de",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      banned_until: u.banned_until ?? null,
      plan: effective,
      manual_plan_override: p?.manual_plan_override ?? null,
      manual_plan_note: p?.manual_plan_note ?? null,
      deleted_at: p?.deleted_at ?? null,
      created_by_admin: !!p?.created_by_admin,
      cgm: cgmKind,
      pro_status: pro?.status ?? null,
      trial_ends_at: pro?.trial_ends_at ?? null,
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
        <Link href="/admin/users/new" style={primaryBtnStyle}>
          + Nutzer anlegen
        </Link>
      </div>

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
const successStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 14,
  margin: "0 0 12px",
  background: "#ecfdf5",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #a7f3d0",
};
