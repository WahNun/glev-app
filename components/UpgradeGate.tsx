"use client";

import Link from "next/link";
import { usePlan } from "@/hooks/usePlan";
import { requiredPlanLabel, FEATURE_TIERS } from "@/lib/planFeatures";

const ACCENT = "#4F6EF7";

export default function UpgradeGate({
  feature,
  children,
  variant = "overlay",
  blurPx = 2.5,
  opacity = 0.6,
}: {
  feature: string;
  children?: React.ReactNode;
  variant?: "overlay" | "row";
  blurPx?: number;
  opacity?: number;
}) {
  const { canAccess, loading } = usePlan();

  if (loading || canAccess(feature)) {
    return <>{children}</>;
  }

  const tier = FEATURE_TIERS[feature] ?? "pro";
  const planName = requiredPlanLabel(tier);

  if (variant === "row") {
    return (
      <Link
        href="/pro"
        aria-label={`${planName} erforderlich`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `${ACCENT}14`,
          color: ACCENT,
          textDecoration: "none",
          flexShrink: 0,
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        🔒
      </Link>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {children && (
        <div
          aria-hidden="true"
          style={{
            filter: `blur(${blurPx}px)`,
            opacity,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {children}
        </div>
      )}

      <Link
        href="/pro"
        style={{
          position: children ? "absolute" : "relative",
          inset: children ? 0 : undefined,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: children ? 0 : "36px 24px",
          minHeight: children ? undefined : 200,
          textAlign: "center",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            padding: "20px 24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          }}
        >
          <div style={{ fontSize: 28, lineHeight: 1 }}>🔒</div>

          <div
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 20,
              background: `${ACCENT}18`,
              color: ACCENT,
              fontSize: 11,
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
              fontSize: 13,
              color: "var(--text-dim)",
              maxWidth: 220,
              lineHeight: 1.5,
            }}
          >
            Ab{" "}
            <strong style={{ color: "var(--text)" }}>{planName}</strong>{" "}
            verfügbar
          </p>

          <div
            style={{
              display: "inline-block",
              padding: "10px 22px",
              background: ACCENT,
              color: "var(--on-accent)",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "-0.01em",
              marginTop: 2,
            }}
          >
            Upgraden →
          </div>
        </div>
      </Link>
    </div>
  );
}
