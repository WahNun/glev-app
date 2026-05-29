import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction, createMetaLeadAction } from "./actions";
import AdminLoginForm from "../_components/AdminLoginForm";
import BuyersTables, { type BetaRow, type ProRow } from "./BuyersTables";
import DuplicateSignups from "./DuplicateSignups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 200;

export type TrialRow = {
  userId: string;
  email: string;
  fullName: string | null;
  trialEndAt: string | null;
  signupSource: string | null;
  createdAt: string | null;
};

export default async function AdminBuyersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Käuferübersicht" error={err} />;
  }

  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (rawQ ?? "").trim();

  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, parseInt(rawPage ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_LIMIT;

  const createdParam = Array.isArray(sp.created) ? sp.created[0] : sp.created;
  const leadErrParam = Array.isArray(sp.lead_err) ? sp.lead_err[0] : sp.lead_err;

  const sb = getSupabaseAdmin();

  const [betaRes, proRes, trialProfilesRes, authUsersRes] = await Promise.all([
    (() => {
      let query = sb
        .from("beta_reservations")
        .select(
          "id, email, full_name, status, amount_cents, currency, stripe_session_id, stripe_customer_id, created_at, fulfilled_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: false });
      if (q) {
        query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
      } else {
        query = query.range(offset, offset + PAGE_LIMIT - 1);
      }
      return query;
    })(),
    (() => {
      let query = sb
        .from("pro_subscriptions")
        .select(
          "id, email, full_name, status, trial_ends_at, current_period_end, stripe_session_id, stripe_customer_id, stripe_subscription_id, created_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: false });
      if (q) {
        query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
      } else {
        query = query.range(offset, offset + PAGE_LIMIT - 1);
      }
      return query;
    })(),
    sb
      .from("profiles")
      .select("user_id, trial_end_at, signup_source, created_at")
      .not("trial_end_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    sb.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const betaErr = betaRes.error?.message ?? null;
  const proErr = proRes.error?.message ?? null;
  const beta = (betaRes.data ?? []) as BetaRow[];
  const pro = (proRes.data ?? []) as ProRow[];
  const betaTotal = betaRes.count ?? beta.length;
  const proTotal = proRes.count ?? pro.length;

  const authUserMap = new Map(
    (authUsersRes.data?.users ?? []).map((u) => [u.id, u]),
  );
  const trialUsers: TrialRow[] = (trialProfilesRes.data ?? []).map((p) => {
    const u = authUserMap.get(p.user_id);
    return {
      userId: p.user_id,
      email: u?.email ?? "—",
      fullName: (u?.user_metadata?.full_name as string | null) ?? null,
      trialEndAt: p.trial_end_at as string | null,
      signupSource: p.signup_source as string | null,
      createdAt: (u?.created_at ?? p.created_at) as string | null,
    };
  });

  const now = new Date();

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>
        Glev Support — Käuferübersicht
      </h1>

      {/* ── Meta-Lead anlegen ─────────────────────────────────── */}
      <section style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px" }}>
          Meta-Lead anlegen — 7-Tage Trial
        </h2>
        {createdParam === "1" && (
          <p style={{ color: "#166534", background: "#dcfce7", padding: "8px 12px", borderRadius: 6, fontSize: 14, marginBottom: 12 }}>
            ✓ Account angelegt. Supabase hat einen Setup-Link an die E-Mail-Adresse geschickt. Drip-Mails (Tag 6 + 7) sind scheduliert.
          </p>
        )}
        {leadErrParam && (
          <p style={{ color: "#c00", fontSize: 14, marginBottom: 12 }}>
            Fehler: {leadErrParam === "invalid_email" ? "Ungültige E-Mail-Adresse." : leadErrParam === "create_failed" ? "Account konnte nicht angelegt werden." : leadErrParam}
          </p>
        )}
        <form action={createMetaLeadAction} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>Name (optional)</label>
            <input
              name="name"
              type="text"
              placeholder="Lena Müller"
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>E-Mail *</label>
            <input
              name="email"
              type="email"
              required
              placeholder="lead@beispiel.de"
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>Sprache</label>
            <select name="locale" style={inputStyle}>
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
          </div>
          <button type="submit" style={btnStyle}>
            Trial starten →
          </button>
        </form>
      </section>

      {/* ── 7-Tage-Trial — CRM ───────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>
          7-Tage Trial{" "}
          <span style={{ fontSize: 13, fontWeight: 400, color: "#666" }}>
            ({trialUsers.length} Einträge)
          </span>
        </h2>
        {trialUsers.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>Noch keine Trial-User.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <Th>E-Mail</Th>
                  <Th>Name</Th>
                  <Th>Quelle</Th>
                  <Th>Trial endet</Th>
                  <Th>Status</Th>
                  <Th>Angelegt</Th>
                </tr>
              </thead>
              <tbody>
                {trialUsers.map((u) => {
                  const end = u.trialEndAt ? new Date(u.trialEndAt) : null;
                  const expired = end ? end < now : false;
                  const daysLeft = end
                    ? Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  return (
                    <tr key={u.userId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <Td>{u.email}</Td>
                      <Td>{u.fullName ?? "—"}</Td>
                      <Td>
                        {u.signupSource === "meta_lead" ? (
                          <span style={badgeMeta}>Meta Lead</span>
                        ) : (
                          <span style={badgeDefault}>{u.signupSource ?? "Direktanmeldung"}</span>
                        )}
                      </Td>
                      <Td>{end ? fmtDate(u.trialEndAt) : "—"}</Td>
                      <Td>
                        {expired ? (
                          <span style={badgeExpired}>Abgelaufen</span>
                        ) : daysLeft !== null ? (
                          <span style={badgeActive}>Aktiv · noch {daysLeft}d</span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>{fmtDate(u.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {betaErr ? <p style={errStyle}>Beta DB-Fehler: {betaErr}</p> : null}
      {proErr ? <p style={errStyle}>Pro DB-Fehler: {proErr}</p> : null}

      <DuplicateSignups beta={beta} pro={pro} />

      <BuyersTables
        beta={beta}
        pro={pro}
        betaTotal={betaTotal}
        proTotal={proTotal}
        pageLimit={PAGE_LIMIT}
        page={page}
        q={q}
      />
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#6b7280", textAlign: "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "8px 12px", fontSize: 13, color: "#111", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1200,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 32,
  background: "#fafafa",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  minWidth: 200,
};

const btnStyle: React.CSSProperties = {
  padding: "9px 18px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 14,
  margin: "0 0 8px",
};

const badgeMeta: React.CSSProperties = {
  background: "#eff6ff",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 11,
  fontWeight: 600,
};

const badgeDefault: React.CSSProperties = {
  background: "#f3f4f6",
  color: "#6b7280",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 11,
};

const badgeActive: React.CSSProperties = {
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 11,
  fontWeight: 600,
};

const badgeExpired: React.CSSProperties = {
  background: "#fef2f2",
  color: "#991b1b",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 11,
};
