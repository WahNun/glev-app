"use client";

import { useTransition, useState } from "react";
import {
  cancelStripeSubAction,
  deleteStripeCustomerAction,
  refundLatestInvoiceAction,
  extendStripeTrialAction,
} from "@/lib/admin/stripeActions";

/**
 * Action-Buttons für eine einzelne Duplikat-Zeile (oder allgemein für
 * eine Stripe-Subscription/-Customer im Admin). Jede Aktion läuft
 * durch ein einfaches `confirm()`-Dialog (kein E-Mail-Tippen) und
 * schreibt sofort live in Stripe.
 *
 * Layout: Löschen prominent (häufigster Fall bei Duplikaten),
 * "Bis Periodenende" daneben als Alternative, Refund + Trial nur als
 * kleine Sekundär-Buttons.
 */
export default function DuplicateActions({
  email,
  source,
  subscriptionId,
  customerId,
}: {
  email: string;
  source: "beta" | "pro";
  subscriptionId: string | null;
  customerId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [refundOpen, setRefundOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [trialDays, setTrialDays] = useState("7");

  function call(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
    fields: Record<string, string>,
    confirmMsg: string,
  ): void {
    if (!confirm(confirmMsg)) return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        alert("Fehler: " + (result.error ?? "Unbekannter Fehler"));
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
      {subscriptionId ? (
        <>
          <button
            type="button"
            disabled={pending}
            style={btnDanger}
            onClick={() =>
              call(
                cancelStripeSubAction,
                { subscriptionId, mode: "now", email },
                `Subscription ${subscriptionId} SOFORT in Stripe kündigen?\n\nUser verliert Pro sofort.`,
              )
            }
          >
            ✕ Sofort kündigen
          </button>
          <button
            type="button"
            disabled={pending}
            style={btnSecondary}
            onClick={() =>
              call(
                cancelStripeSubAction,
                { subscriptionId, mode: "period_end", email },
                `Subscription ${subscriptionId} zum Periodenende kündigen?\n\nUser behält Pro bis Periodenende, danach automatisch aus.`,
              )
            }
          >
            ⏳ Bis Periodenende
          </button>
        </>
      ) : null}

      {customerId ? (
        <button
          type="button"
          disabled={pending}
          style={btnDanger}
          onClick={() =>
            call(
              deleteStripeCustomerAction,
              { customerId, email },
              `Stripe-Customer ${customerId} LÖSCHEN?\n\nKlappt nur, wenn keine aktive Subscription mehr dranhängt.`,
            )
          }
        >
          🗑 Customer löschen
        </button>
      ) : null}

      {subscriptionId ? (
        <>
          {!refundOpen ? (
            <button
              type="button"
              disabled={pending}
              style={btnTiny}
              onClick={() => setRefundOpen(true)}
            >
              € Refund letzte Zahlung…
            </button>
          ) : (
            <div style={miniRow}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="leer = voll, sonst € z.B. 12.50"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                style={miniInput}
              />
              <button
                type="button"
                disabled={pending}
                style={btnTinyPrimary}
                onClick={() => {
                  const amount = refundAmount.trim();
                  const cents = amount
                    ? Math.round(Number(amount.replace(",", ".")) * 100).toString()
                    : "";
                  if (amount && (!cents || Number(cents) <= 0)) {
                    alert("Ungültiger Betrag");
                    return;
                  }
                  call(
                    refundLatestInvoiceAction,
                    { subscriptionId, email, amountCents: cents },
                    `Refund auf Subscription ${subscriptionId}: ${
                      amount ? `${amount}€ Teilrefund` : "VOLL-Refund letzte Invoice"
                    }?`,
                  );
                  setRefundOpen(false);
                  setRefundAmount("");
                }}
              >
                Refund
              </button>
              <button
                type="button"
                style={btnTiny}
                onClick={() => {
                  setRefundOpen(false);
                  setRefundAmount("");
                }}
              >
                ×
              </button>
            </div>
          )}

          {!trialOpen ? (
            <button
              type="button"
              disabled={pending}
              style={btnTiny}
              onClick={() => setTrialOpen(true)}
            >
              ⏰ Trial verlängern…
            </button>
          ) : (
            <div style={miniRow}>
              <input
                type="number"
                min={1}
                max={365}
                placeholder="Tage"
                value={trialDays}
                onChange={(e) => setTrialDays(e.target.value)}
                style={{ ...miniInput, width: 60 }}
              />
              <button
                type="button"
                disabled={pending}
                style={btnTinyPrimary}
                onClick={() => {
                  const days = Number(trialDays);
                  if (!Number.isFinite(days) || days < 1 || days > 365) {
                    alert("1–365 Tage");
                    return;
                  }
                  call(
                    extendStripeTrialAction,
                    { subscriptionId, days: String(days), email },
                    `Trial um ${days} Tage verlängern?`,
                  );
                  setTrialOpen(false);
                }}
              >
                +{trialDays}d
              </button>
              <button type="button" style={btnTiny} onClick={() => setTrialOpen(false)}>
                ×
              </button>
            </div>
          )}
        </>
      ) : null}

      {!subscriptionId && !customerId ? (
        <span style={{ color: "#999", fontSize: 12 }}>
          {source === "beta"
            ? "Beta — bitte direkt im Stripe-Dashboard"
            : "keine Stripe-IDs"}
        </span>
      ) : null}

      {pending ? <span style={{ color: "#666", fontSize: 11 }}>läuft…</span> : null}
    </div>
  );
}

const btnDanger: React.CSSProperties = {
  padding: "6px 10px",
  background: "#b91c1c",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 10px",
  background: "#fff",
  color: "#111",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};
const btnTiny: React.CSSProperties = {
  padding: "3px 8px",
  background: "transparent",
  color: "#444",
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};
const btnTinyPrimary: React.CSSProperties = {
  padding: "3px 8px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 600,
};
const miniRow: React.CSSProperties = { display: "flex", gap: 4, alignItems: "center" };
const miniInput: React.CSSProperties = {
  padding: "3px 6px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "inherit",
  minWidth: 0,
  flex: 1,
};
