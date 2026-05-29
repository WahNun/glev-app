import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction } from "../users/actions";
import CancelButton from "./CancelButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/subscriptions — Übersicht aller laufenden Pro-Abos mit
 * Kündigen-Button. Quelle: `pro_subscriptions` (Webhook-mirror, also
 * sekundengenau aktuell). Beta-Reservations sind KEINE Subscriptions
 * (einmal-Zahlung), die laufen separat unter /admin/buyers.
 *
 * Default-Filter: nur „aktive" Abos (trialing/active/past_due) — sonst
 * würde man cancelled/pending Reste mit anzeigen, die nicht mehr
 * kündbar sind. Der Filter-Toggle oben rechts schaltet das um.
 */
export default async function AdminSubscriptionsPage({
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
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev Admin — Abos</h1>
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

  const showAllParam = Array.isArray(sp.show) ? sp.show[0] : sp.show;
  const showAll = showAllParam === "all";

  const sb = getSupabaseAdmin();

  let query = sb
    .from("pro_subscriptions")
    .select(
      "email, status, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id, currency, country, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (!showAll) {
    query = query.in("status", ["trialing", "active", "past_due"]);
  }

  const { data, error } = await query;

  type Row = {
    email: string;
    status: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    currency: string | null;
    country: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Counter pro Status — als Quick-Stats über der Tabelle.
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.status ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

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
          Glev Admin — Abos ({rows.length})
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href={showAll ? "/glev-ops/subscriptions" : "/glev-ops/subscriptions?show=all"}
            style={{
              ...btnStyle,
              background: showAll ? "#fff" : "#111",
              color: showAll ? "#111" : "#fff",
              border: "1px solid #111",
              textDecoration: "none",
              padding: "8px 14px",
            }}
          >
            {showAll ? "Nur aktive" : "Alle anzeigen"}
          </Link>
        </div>
      </div>

      {error ? (
        <p style={errStyle}>pro_subscriptions-Fehler: {error.message}</p>
      ) : null}

      <p style={{ fontSize: 13, color: "#555", margin: "0 0 16px" }}>
        Zeigt {showAll ? "alle" : "nur aktive (trialing / active / past_due)"} Pro-Abos
        aus <code>pro_subscriptions</code> (Webhook-Mirror). Beta-Käufer:innen
        haben keine Subscription — die findest du unter{" "}
        <Link href="/glev-ops/buyers" style={{ color: "#3b4cdc" }}>
          /admin/buyers
        </Link>
        .
      </p>

      {/* Status-Counter */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {(["trialing", "active", "past_due", "cancelled", "pending"] as const).map(
          (s) => (
            <div
              key={s}
              style={{
                padding: "8px 14px",
                background: counts[s] ? statusBg(s) : "#f9fafb",
                border: `1px solid ${counts[s] ? statusBorder(s) : "#e5e7eb"}`,
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <strong>{counts[s] ?? 0}</strong>{" "}
              <span style={{ color: "#555" }}>{statusLabel(s)}</span>
            </div>
          ),
        )}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "#f8f8f8", textAlign: "left" }}>
              <th style={th}>E-Mail</th>
              <th style={th}>Status</th>
              <th style={th}>Trial endet</th>
              <th style={th}>Periode endet</th>
              <th style={th}>Land · Währung</th>
              <th style={th}>Stripe</th>
              <th style={th}>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: "center", color: "#999", padding: 24 }}>
                  Keine {showAll ? "" : "aktiven "}Abos.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cancellable = !!r.stripe_subscription_id &&
                  r.status !== "cancelled" && r.status !== "pending";
                return (
                  <tr key={r.stripe_subscription_id ?? r.email} style={{ borderTop: "1px solid #eee" }}>
                    <td style={td}>
                      <code style={{ fontSize: 12 }}>{r.email}</code>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          background: statusBg(r.status),
                          color: statusFg(r.status),
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td style={td}>{fmtDateTime(r.trial_ends_at)}</td>
                    <td style={td}>{fmtDateTime(r.current_period_end)}</td>
                    <td style={td}>
                      {r.country ?? "—"} · {r.currency ? r.currency.toUpperCase() : "—"}
                    </td>
                    <td style={td}>
                      {r.stripe_customer_id ? (
                        <a
                          href={`https://dashboard.stripe.com/customers/${r.stripe_customer_id}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#3b4cdc", fontSize: 12 }}
                        >
                          öffnen ↗
                        </a>
                      ) : (
                        <span style={{ color: "#999" }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      {cancellable && r.stripe_subscription_id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <CancelButton
                            subscriptionId={r.stripe_subscription_id}
                            email={r.email}
                            mode="period_end"
                          />
                          <CancelButton
                            subscriptionId={r.stripe_subscription_id}
                            email={r.email}
                            mode="now"
                          />
                        </div>
                      ) : (
                        <span style={{ color: "#999", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: "#999", marginTop: 16 }}>
        ⚠️ Dies ist die Live-Stripe-API in Produktion — Klick auf „Sofort
        kündigen" stoppt sofort den Pro-Zugang ohne automatischen Refund.
        „Zum Periodenende kündigen" lässt den User bis zum Ablauf der
        bezahlten Periode weiter Pro nutzen (empfohlen).
      </p>
    </main>
  );
}

function statusLabel(s: string | null): string {
  switch (s) {
    case "trialing": return "Trial";
    case "active": return "Aktiv";
    case "past_due": return "Mahnung";
    case "cancelled": return "Gekündigt";
    case "pending": return "Pending";
    default: return s ?? "—";
  }
}
function statusBg(s: string | null): string {
  switch (s) {
    case "trialing": return "#dbeafe";
    case "active": return "#d1fae5";
    case "past_due": return "#fef3c7";
    case "cancelled": return "#fee2e2";
    case "pending": return "#f3f4f6";
    default: return "#f9fafb";
  }
}
function statusFg(s: string | null): string {
  switch (s) {
    case "trialing": return "#1e40af";
    case "active": return "#065f46";
    case "past_due": return "#92400e";
    case "cancelled": return "#991b1b";
    case "pending": return "#374151";
    default: return "#111";
  }
}
function statusBorder(s: string | null): string {
  switch (s) {
    case "trialing": return "#bfdbfe";
    case "active": return "#a7f3d0";
    case "past_due": return "#fde68a";
    case "cancelled": return "#fecaca";
    case "pending": return "#e5e7eb";
    default: return "#e5e7eb";
  }
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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
const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 14,
  margin: "0 0 8px",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  background: "#fff",
};
const th: React.CSSProperties = {
  padding: "10px 12px",
  fontWeight: 700,
  fontSize: 12,
  color: "#555",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  borderBottom: "1px solid #e5e7eb",
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
};
