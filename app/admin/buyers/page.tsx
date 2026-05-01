import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction, logoutAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal admin / support lookup view for the two buyer tables
 * (`beta_reservations` + `pro_subscriptions`).
 *
 * Built so support staff can resolve refund / onboarding questions without
 * SSH'ing into the DB. Surfaces both the `email` and the `full_name` that
 * task #70 added (collected via the mandatory Stripe Checkout custom field
 * from task #68 and persisted by the webhooks).
 *
 * Auth: we reuse the existing `ADMIN_API_SECRET` Bearer-token pattern from
 * `/api/admin/invite` — the operator pastes the secret once into a login
 * form, we constant-time-compare and stash it in an httpOnly cookie scoped
 * to `/admin`. No Supabase user session involved on purpose: this view uses
 * the service role to read both tables (RLS is intentionally disabled on
 * them) so we cannot piggy-back on the user-facing auth.
 */

type Beta = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string | null;
  fulfilled_at: string | null;
};

type Pro = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string | null;
};

const PAGE_LIMIT = 200;

function fmtName(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  return s.length > 0 ? s : "—";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtAmount(cents: number | null | undefined, ccy: string | null | undefined): string {
  if (cents == null) return "—";
  const c = (ccy ?? "eur").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${c}`;
}

export default async function AdminBuyersPage({
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
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev Support — Käuferübersicht</h1>
        <p style={{ marginBottom: 16, color: "#555" }}>
          Internal-only. Bitte das <code>ADMIN_API_SECRET</code> einfügen, um beta &amp; pro
          Käufer einzusehen.
        </p>
        <form action={loginAction} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
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

  const [betaRes, proRes] = await Promise.all([
    sb
      .from("beta_reservations")
      .select("id, email, full_name, status, amount_cents, currency, created_at, fulfilled_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
    sb
      .from("pro_subscriptions")
      .select("id, email, full_name, status, trial_ends_at, current_period_end, created_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
  ]);

  const betaErr = betaRes.error?.message ?? null;
  const proErr = proRes.error?.message ?? null;
  const beta = (betaRes.data ?? []) as Beta[];
  const pro = (proRes.data ?? []) as Pro[];

  return (
    <main style={pageStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Glev Support — Käuferübersicht</h1>
        <form action={logoutAction}>
          <button type="submit" style={{ ...btnStyle, background: "#666" }}>
            Logout
          </button>
        </form>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2Style}>
          Beta-Reservierungen{" "}
          <span style={countStyle}>({beta.length}{beta.length === PAGE_LIMIT ? `+ neueste ${PAGE_LIMIT}` : ""})</span>
        </h2>
        {betaErr ? <p style={errStyle}>DB-Fehler: {betaErr}</p> : null}
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Betrag</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Fulfilled</th>
              </tr>
            </thead>
            <tbody>
              {beta.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    Keine Reservierungen.
                  </td>
                </tr>
              ) : (
                beta.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtAmount(r.amount_cents, r.currency)}</td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.fulfilled_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={h2Style}>
          Pro-Abos{" "}
          <span style={countStyle}>({pro.length}{pro.length === PAGE_LIMIT ? `+ neueste ${PAGE_LIMIT}` : ""})</span>
        </h2>
        {proErr ? <p style={errStyle}>DB-Fehler: {proErr}</p> : null}
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Trial endet</th>
                <th style={thStyle}>Period endet</th>
                <th style={thStyle}>Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {pro.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    Keine Pro-Abos.
                  </td>
                </tr>
              ) : (
                pro.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtDate(r.trial_ends_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.current_period_end)}</td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
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

const h2Style: React.CSSProperties = {
  fontSize: 16,
  margin: "0 0 8px",
};

const countStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "#666",
  fontSize: 13,
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 6,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  background: "#f7f7f7",
  borderBottom: "1px solid #e5e5e5",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
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

const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 13,
  margin: "0 0 8px",
};
