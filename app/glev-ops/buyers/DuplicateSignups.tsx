"use client";

import { useState, useEffect } from "react";
import type { BetaRow, ProRow } from "./BuyersTables";
import DuplicateActions from "./DuplicateActions";

/**
 * Mehrfach-Registrierungen — gruppiert die geladenen Beta- und Pro-
 * Käufer:innen nach E-Mail (case-insensitive) und zeigt jede Gruppe
 * mit ≥2 Einträgen oben auf /admin/buyers an.
 *
 * "Schließen"-Button: entfernt die Gruppe aus der prominenten Übersicht
 * (als "geklärt" markiert). Gespeichert in localStorage — bleibt über
 * Seiten-Reloads erhalten. "Alle anzeigen"-Link blendet alle wieder ein.
 */

const STORAGE_KEY = "glev_admin_dismissed_dups";

type Entry = {
  source: "beta" | "pro";
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  created_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_session_id: string | null;
  amount_cents: number | null;
  currency: string | null;
};

function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtMinGap(timestamps: Array<string | null>): string {
  const ms = timestamps
    .map((t) => (t ? new Date(t).getTime() : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (ms.length < 2) return "—";
  let min = Infinity;
  for (let i = 1; i < ms.length; i++) {
    min = Math.min(min, ms[i] - ms[i - 1]);
  }
  if (!Number.isFinite(min)) return "—";
  const mins = Math.round(min / 60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function buildClarifyMailto(group: Entry[]): string {
  const email = group[0]?.email ?? "";
  const name = group.find((g) => g.full_name)?.full_name ?? "";
  const types = new Set(group.map((g) => g.source));
  const variants: string[] = [];
  if (types.has("beta")) variants.push("Beta-Zugang (€19 einmalig)");
  if (types.has("pro")) variants.push("Pro-Abo (€14,90/Monat nach Probezeit)");

  const subject = "Glev — kurze Rückfrage zu deiner Anmeldung";

  const greeting = name ? `Hallo ${name.split(" ")[0]},` : "Hallo,";
  const variantsList = variants.map((v) => `  • ${v}`).join("\n");
  const enVariants = variants
    .map((v) =>
      v.startsWith("Beta")
        ? "  • Beta access (€19 one-time)"
        : "  • Pro subscription (€14.90/month after trial)",
    )
    .join("\n");

  const body =
    `${greeting}\n\n` +
    `du hast dich kürzlich mehrfach (${group.length}×) bei Glev registriert. Damit du nicht doppelt zahlst, kläre ich gerne kurz mit dir, welche der Varianten du tatsächlich behalten möchtest:\n\n` +
    `${variantsList}\n\n` +
    `Antworte einfach kurz auf diese Mail mit deiner Wahl, dann kümmere ich mich um den Rest (kündigen / erstatten falls nötig).\n\n` +
    `Viele Grüße\nLucas\n\n` +
    `— English —\n\n` +
    `${name ? `Hi ${name.split(" ")[0]},` : "Hi,"}\n\n` +
    `you recently signed up to Glev multiple times (${group.length}×). So you don't pay twice, could you tell me which one you'd like to keep:\n\n` +
    `${enVariants}\n\n` +
    `Just reply to this email and I'll cancel/refund the other one for you.\n\n` +
    `Cheers\nLucas\n`;

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function DuplicateSignups({
  beta,
  pro,
}: {
  beta: BetaRow[];
  pro: ProRow[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore parse errors
    }
    setMounted(true);
  }, []);

  function dismiss(email: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(email);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }

  function resetDismissed() {
    setDismissed(new Set());
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }

  const all: Entry[] = [
    ...beta.map<Entry>((b) => ({
      source: "beta",
      id: b.id,
      email: b.email,
      full_name: b.full_name,
      status: b.status,
      created_at: b.created_at,
      stripe_customer_id: b.stripe_customer_id ?? null,
      stripe_subscription_id: null,
      stripe_session_id: b.stripe_session_id,
      amount_cents: b.amount_cents,
      currency: b.currency,
    })),
    ...pro.map<Entry>((p) => ({
      source: "pro",
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      status: p.status,
      created_at: p.created_at,
      stripe_customer_id: p.stripe_customer_id ?? null,
      stripe_subscription_id: p.stripe_subscription_id ?? null,
      stripe_session_id: p.stripe_session_id,
      amount_cents: null,
      currency: null,
    })),
  ];

  const groups = new Map<string, Entry[]>();
  for (const e of all) {
    const k = (e.email ?? "").trim().toLowerCase();
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  const allDups = Array.from(groups.entries())
    .filter(([, es]) => es.length >= 2)
    .map(([email, es]) => ({
      email,
      entries: es.slice().sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      }),
    }))
    .sort((a, b) => b.entries.length - a.entries.length);

  const visibleDups = mounted
    ? allDups.filter((g) => !dismissed.has(g.email))
    : allDups;

  const hiddenCount = allDups.length - visibleDups.length;

  if (allDups.length === 0) {
    return (
      <section style={section}>
        <h2 style={h2}>Mehrfach-Registrierungen</h2>
        <p style={muted}>
          Aktuell keine doppelten E-Mail-Adressen in den geladenen Käufer-Listen.
        </p>
      </section>
    );
  }

  if (visibleDups.length === 0) {
    return (
      <section style={{ ...section, borderColor: "#bbf7d0" }}>
        <h2 style={h2}>Mehrfach-Registrierungen</h2>
        <p style={muted}>
          Alle {allDups.length} Fälle als geklärt markiert.{" "}
          <button type="button" onClick={resetDismissed} style={btnReset}>
            Alle wieder anzeigen
          </button>
        </p>
      </section>
    );
  }

  const totalDupRows = visibleDups.reduce((s, g) => s + g.entries.length, 0);

  return (
    <section style={section}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ ...h2, margin: 0 }}>
          Mehrfach-Registrierungen — {visibleDups.length} E-Mail
          {visibleDups.length === 1 ? "" : "s"} mit insgesamt {totalDupRows} Einträgen
        </h2>
        {hiddenCount > 0 && (
          <button type="button" onClick={resetDismissed} style={btnReset}>
            + {hiddenCount} geklärt — alle anzeigen
          </button>
        )}
      </div>
      <p style={muted}>
        Pro Gruppe öffnet „Klär-Mail" eine vorausgefüllte zweisprachige
        E-Mail in deinem Mail-Programm. Die Stripe-Buttons schreiben sofort
        live in Stripe — kurzer Confirm-Klick, kein E-Mail-Tippen.
      </p>

      {visibleDups.map((g) => {
        const fullName = g.entries.find((e) => e.full_name)?.full_name ?? null;
        const betaCount = g.entries.filter((e) => e.source === "beta").length;
        const proCount = g.entries.filter((e) => e.source === "pro").length;
        const customerIds = Array.from(
          new Set(g.entries.map((e) => e.stripe_customer_id).filter((x): x is string => !!x)),
        );
        return (
          <div key={g.email} style={groupCard}>
            <div style={groupHead}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{g.email}</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
                  {fullName ?? "(ohne Name)"} · {g.entries.length} Registrierungen
                  {betaCount ? ` · ${betaCount}× Beta` : ""}
                  {proCount ? ` · ${proCount}× Pro` : ""}
                  {" · kürzester Abstand: "}
                  <strong>{fmtMinGap(g.entries.map((e) => e.created_at))}</strong>
                  {customerIds.length > 1
                    ? ` · ${customerIds.length} verschiedene Stripe-Customer`
                    : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <a
                  href={buildClarifyMailto(g.entries)}
                  style={btnPrimary}
                  title="Vorausgefüllte Mail an die Kund:in öffnen"
                >
                  ✉ Klär-Mail
                </a>
                <button
                  type="button"
                  onClick={() => dismiss(g.email)}
                  style={btnClose}
                  title="Als geklärt markieren und aus dieser Übersicht entfernen"
                >
                  ✓ Schließen
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={table}>
                <thead>
                  <tr style={{ background: "#fafafa", textAlign: "left" }}>
                    <th style={th}>Wann</th>
                    <th style={th}>Quelle</th>
                    <th style={th}>Status</th>
                    <th style={th}>Stripe</th>
                    <th style={th}>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((e) => (
                    <tr key={`${e.source}-${e.id}`} style={{ borderTop: "1px solid #eee" }}>
                      <td style={td}>{fmtDateTime(e.created_at)}</td>
                      <td style={td}>
                        <span
                          style={{
                            background: e.source === "pro" ? "#5b6cff22" : "#10b98122",
                            color: e.source === "pro" ? "#3b4cdc" : "#047857",
                            fontSize: 12,
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontWeight: 600,
                          }}
                        >
                          {e.source === "pro" ? "Pro" : "Beta"}
                        </span>
                      </td>
                      <td style={td}>{e.status ?? "—"}</td>
                      <td style={td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {e.stripe_customer_id ? (
                            <a
                              href={`https://dashboard.stripe.com/customers/${e.stripe_customer_id}`}
                              target="_blank"
                              rel="noreferrer"
                              style={linkSm}
                            >
                              Customer ↗
                            </a>
                          ) : null}
                          {e.stripe_subscription_id ? (
                            <a
                              href={`https://dashboard.stripe.com/subscriptions/${e.stripe_subscription_id}`}
                              target="_blank"
                              rel="noreferrer"
                              style={linkSm}
                            >
                              Subscription ↗
                            </a>
                          ) : null}
                          {!e.stripe_customer_id && !e.stripe_subscription_id ? (
                            <span style={{ color: "#999", fontSize: 12 }}>—</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={td}>
                        <DuplicateActions
                          email={e.email}
                          source={e.source}
                          subscriptionId={e.stripe_subscription_id}
                          customerId={e.stripe_customer_id}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

const section: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #fde68a",
  borderRadius: 10,
  padding: 16,
  marginBottom: 24,
};
const h2: React.CSSProperties = { fontSize: 16, margin: "0 0 6px" };
const muted: React.CSSProperties = { color: "#666", fontSize: 13, margin: "0 0 12px" };
const groupCard: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  background: "#fffdf6",
};
const groupHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#111",
  color: "#fff",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const btnClose: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f0fdf4",
  color: "#166534",
  border: "1px solid #86efac",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};
const btnReset: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#3b4cdc",
  fontSize: 13,
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
  fontFamily: "inherit",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const linkSm: React.CSSProperties = { color: "#3b4cdc", fontSize: 12, textDecoration: "none" };
