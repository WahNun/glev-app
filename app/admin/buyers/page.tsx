import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction } from "./actions";
import BuyersTables, { type BetaRow, type ProRow } from "./BuyersTables";

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
 *
 * Search (task #151): the most-recent-200 rows from each table are fetched
 * server-side; the search input itself lives in `BuyersTables` (a client
 * component) and filters in-memory by case-insensitive substring against
 * `email` OR `full_name`. The section heading counts reflect the filtered
 * result. We intentionally keep the fetch capped — search is meant to
 * narrow down the recent window, not act as a full-table search.
 */

const PAGE_LIMIT = 200;

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
      .select("id, email, full_name, status, amount_cents, currency, stripe_session_id, created_at, fulfilled_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
    sb
      .from("pro_subscriptions")
      .select("id, email, full_name, status, trial_ends_at, current_period_end, stripe_session_id, created_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
  ]);

  const betaErr = betaRes.error?.message ?? null;
  const proErr = proRes.error?.message ?? null;
  const beta = (betaRes.data ?? []) as BetaRow[];
  const pro = (proRes.data ?? []) as ProRow[];

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>
        Glev Support — Käuferübersicht
      </h1>

      {betaErr ? <p style={errStyle}>Beta DB-Fehler: {betaErr}</p> : null}
      {proErr ? <p style={errStyle}>Pro DB-Fehler: {proErr}</p> : null}

      <BuyersTables
        beta={beta}
        pro={pro}
        pageLimit={PAGE_LIMIT}
        betaTruncated={beta.length === PAGE_LIMIT}
        proTruncated={pro.length === PAGE_LIMIT}
      />
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
