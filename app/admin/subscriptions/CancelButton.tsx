"use client";

import { useState, useTransition } from "react";
import { cancelStripeSubAction } from "@/lib/admin/stripeActions";

/**
 * Kündigen-Button für eine einzelne Stripe-Subscription. Zwei Modi:
 *  - "period_end" (Default, gelb): User behält Pro bis zum Ende der
 *    bezahlten Periode. Empfohlen für reguläre Kündigungen.
 *  - "now" (rot, hinter zweitem Klick): sofortige Kündigung, kein
 *    Pro-Zugang mehr, KEIN automatischer Refund.
 *
 * Beide Modi gehen durch `cancelStripeSubAction` (live Stripe-API)
 * und schreiben Audit-Log. Doppelter Confirm verhindert Misstaps —
 * das ist die einzige Stelle im Admin, wo wir mit einem Klick echtes
 * Geld stoppen können.
 */
export default function CancelButton({
  subscriptionId,
  email,
  mode,
}: {
  subscriptionId: string;
  email: string;
  mode: "now" | "period_end";
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    mode === "now"
      ? armed
        ? "Wirklich SOFORT kündigen?"
        : "Sofort kündigen"
      : armed
        ? "Bestätigen — Kündigen zum Periodenende"
        : "Zum Periodenende kündigen";

  const baseStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: pending ? "wait" : "pointer",
    border: "1px solid",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };

  const style: React.CSSProperties =
    mode === "now"
      ? {
          ...baseStyle,
          background: armed ? "#b91c1c" : "#fff",
          color: armed ? "#fff" : "#b91c1c",
          borderColor: "#b91c1c",
        }
      : {
          ...baseStyle,
          background: armed ? "#b45309" : "#fff",
          color: armed ? "#fff" : "#b45309",
          borderColor: "#b45309",
        };

  function onClick(): void {
    if (!armed) {
      setArmed(true);
      // Auto-disarm nach 5s, damit ein „Halb-Klick" nicht ewig aktiv bleibt.
      setTimeout(() => setArmed(false), 5000);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("subscriptionId", subscriptionId);
        fd.set("email", email);
        fd.set("mode", mode);
        await cancelStripeSubAction(fd);
        setArmed(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setArmed(false);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" onClick={onClick} disabled={pending} style={style}>
        {pending ? "Läuft…" : label}
      </button>
      {error ? (
        <span style={{ fontSize: 11, color: "#b91c1c" }}>Fehler: {error}</span>
      ) : null}
    </div>
  );
}
