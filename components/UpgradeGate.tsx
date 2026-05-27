"use client";

import Link from "next/link";
import { usePlan } from "@/hooks/usePlan";
import { requiredPlanLabel, FEATURE_TIERS } from "@/lib/planFeatures";

const ACCENT = "#4F6EF7";

export default function UpgradeGate({
  feature,
  children,
}: {
  feature: string;
  children?: React.ReactNode;
}) {
  const { canAccess, loading } = usePlan();

  if (loading || canAccess(feature)) {
    return <>{children}</>;
  }

  const tier = FEATURE_TIERS[feature] ?? "pro";
  const planName = requiredPlanLabel(tier);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "36px 24px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        textAlign: "center",
        minHeight: 220,
      }}
    >
      <div style={{ fontSize: 32, lineHeight: 1 }}>🔒</div>

      <div
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: 20,
          background: `${ACCENT}18`,
          color: ACCENT,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {planName}
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "var(--text-dim)",
          maxWidth: 260,
          lineHeight: 1.6,
        }}
      >
        Dieses Feature ist ab{" "}
        <strong style={{ color: "var(--text)" }}>{planName}</strong>{" "}
        verfügbar.
      </p>

      <Link
        href="/pro"
        style={{
          marginTop: 4,
          display: "inline-block",
          padding: "12px 28px",
          background: ACCENT,
          color: "#fff",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: "none",
          letterSpacing: "-0.01em",
        }}
      >
        Jetzt upgraden →
      </Link>
    </div>
  );
}
