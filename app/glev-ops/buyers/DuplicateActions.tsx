"use client";

import { useTransition, useState } from "react";
import {
  cancelStripeSubAction,
  deleteStripeCustomerAction,
  refundLatestInvoiceAction,
  extendStripeTrialAction,
} from "@/lib/admin/stripeActions";
import ConfirmModal from "../_components/ConfirmModal";

/**
 * Action-Buttons für eine einzelne Duplikat-Zeile (oder allgemein für
 * eine Stripe-Subscription/-Customer im Admin). Jede Aktion zeigt ein
 * echtes ConfirmModal statt window.confirm().
 */

type PendingAction = {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  execute: () => void;
};

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
  const [isPending, startTransition] = useTransition();
  const [refundOpen, setRefundOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [trialDays, setTrialDays] = useState("7");
  const [modal, setModal] = useState<PendingAction | null>(null);

  function ask(action: PendingAction) {
    setModal(action);
  }

  function confirm() {
    if (!modal) return;
    modal.execute();
    setModal(null);
  }

  function run(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>,
    fields: Record<string, string>,
  ) {
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
    <>
      <ConfirmModal
        open={!!modal}
        title={modal?.title ?? ""}
        message={modal?.message}
        confirmLabel={modal?.confirmLabel ?? "Bestätigen"}
        danger={modal?.danger ?? false}
        onConfirm={confirm}
        onCancel={() => setModal(null)}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
        {subscriptionId ? (
          <>
            <button
              type="button"
              disabled={isPending}
              style={btnDanger}
              onClick={() =>
                ask({
                  title: "Subscription sofort kündigen?",
                  message: `${subscriptionId}\n\nUser verliert Pro-Zugang sofort.`,
                  confirmLabel: "Sofort kündigen",
                  danger: true,
                  execute: () => run(cancelStripeSubAction, { subscriptionId, mode: "now", email }),
                })
              }
            >
              ✕ Sofort kündigen
            </button>
            <button
              type="button"
              disabled={isPending}
              style={btnSecondary}
              onClick={() =>
                ask({
                  title: "Bis Periodenende kündigen?",
                  message: `${subscriptionId}\n\nUser behält Pro bis Periodenende, dann automatisch beendet.`,
                  confirmLabel: "Bis Periodenende kündigen",
                  danger: false,
                  execute: () => run(cancelStripeSubAction, { subscriptionId, mode: "period_end", email }),
                })
              }
            >
              ⏳ Bis Periodenende
            </button>
          </>
        ) : null}

        {customerId ? (
          <button
            type="button"
            disabled={isPending}
            style={btnDanger}
            onClick={() =>
              ask({
                title: "Stripe-Customer löschen?",
                message: `${customerId}\n\nNur möglich wenn keine aktive Subscription mehr hängt. Diese Aktion kann nicht rückgängig gemacht werden.`,
                confirmLabel: "Customer löschen",
                danger: true,
                execute: () => run(deleteStripeCustomerAction, { customerId, email }),
              })
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
                disabled={isPending}
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
                  disabled={isPending}
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
                    ask({
                      title: "Refund durchführen?",
                      message: `${amount ? `${amount} € Teilrefund` : "Vollständiger Refund"} auf ${subscriptionId}.`,
                      confirmLabel: "Refund auslösen",
                      danger: false,
                      execute: () => {
                        run(refundLatestInvoiceAction, { subscriptionId, email, amountCents: cents });
                        setRefundOpen(false);
                        setRefundAmount("");
                      },
                    });
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
                disabled={isPending}
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
                  disabled={isPending}
                  style={btnTinyPrimary}
                  onClick={() => {
                    const days = Number(trialDays);
                    if (!Number.isFinite(days) || days < 1 || days > 365) {
                      alert("1–365 Tage");
                      return;
                    }
                    ask({
                      title: `Trial um ${days} Tage verlängern?`,
                      message: `Subscription: ${subscriptionId}`,
                      confirmLabel: `+${days} Tage`,
                      danger: false,
                      execute: () => {
                        run(extendStripeTrialAction, { subscriptionId, days: String(days), email });
                        setTrialOpen(false);
                      },
                    });
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

        {isPending ? <span style={{ color: "#666", fontSize: 11 }}>läuft…</span> : null}
      </div>
    </>
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
