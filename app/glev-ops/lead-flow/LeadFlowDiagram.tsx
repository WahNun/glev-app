"use client";

import { useState } from "react";

// ── color tokens ──────────────────────────────────────────────────────────────
const C = {
  blue:   "#3b82f6",
  red:    "#ef4444",
  green:  "#22c55e",
  teal:   "#10b981",
  purple: "#8b5cf6",
  pink:   "#ec4899",
  amber:  "#f59e0b",
  indigo: "#6366f1",
} as const;

type ArrowColor = keyof typeof C;

// ── node definitions ──────────────────────────────────────────────────────────
interface FlowNode {
  id: string;
  x: number; y: number; w: number; h: number;
  color: string; bg: string;
  title: string;
  lines?: string[];
  detail?: string;
  codeRef?: string;
}

const NODES: FlowNode[] = [
  // ── main flow ──────────────────────────────────────────────────────────────
  {
    id: "meta-form",
    x: 30, y: 30, w: 280, h: 70,
    color: C.green, bg: "#0d1a0d",
    title: "Meta Lead Form",
    lines: ["Instagram / Facebook Ad"],
    detail:
      "Meta Lead Ads senden einen Webhook POST sobald ein Nutzer das Formular ausfüllt. Kein Glev-Account erforderlich.",
    codeRef: "app/api/meta/leads/route.ts",
  },
  {
    id: "api-leads",
    x: 30, y: 160, w: 280, h: 100,
    color: C.blue, bg: "#0d0d1a",
    title: "/api/meta/leads",
    lines: ["→ Supabase: leads INSERT", "→ provisionMetaLead()"],
    detail:
      "Empfängt und validiert den Meta-Webhook-Payload, schreibt den Lead in die DB und startet die Provision-Chain.",
    codeRef: "app/api/meta/leads/route.ts",
  },
  {
    id: "api-notification",
    x: 30, y: 325, w: 280, h: 95,
    color: C.blue, bg: "#0d0d1a",
    title: "/api/crm/signup-notification",
    lines: ["→ Resend: Email an Lead", "→ Resend: Notification"],
    detail:
      "Versendet den Aktivierungs-Link (7 Tage gültig) an den Lead und eine CRM-Notification an das Team.",
    codeRef: "app/api/crm/signup-notification/route.ts",
  },
  {
    id: "lead-click",
    x: 30, y: 485, w: 280, h: 70,
    color: C.amber, bg: "#1a140a",
    title: "Lead klickt Aktivierungs-Link",
    detail:
      "Der Lead öffnet den Magic-Link in der E-Mail. Supabase Auth verarbeitet den Token und leitet weiter.",
  },
  {
    id: "api-activate",
    x: 30, y: 620, w: 280, h: 100,
    color: C.blue, bg: "#0d0d1a",
    title: "/api/auth/activate-trial",
    lines: ["→ profiles.trial_start_at", "→ profiles.trial_end_at (+7 Tage)"],
    detail:
      "Setzt trial_start_at auf now() und trial_end_at auf now()+7 Tage in Supabase profiles. Kein zweiter Trial möglich.",
    codeRef: "app/api/auth/activate-trial/route.ts",
  },
  {
    id: "app-paywall",
    x: 30, y: 785, w: 280, h: 110,
    color: C.amber, bg: "#1a140a",
    title: "App öffnen → Paywall",
    lines: ["resolvePaywallState()", "→ supabase_trial_active", 'CTA: "Abo sichern"'],
    detail:
      "Die App prüft den Paywall-State bei jedem Launch. Bei aktivem Trial: voller Zugang. Nach Ablauf: Paywall ohne zweiten Trial.",
    codeRef: "lib/paywall/resolvePaywallState.ts",
  },
  {
    id: "iap-stripe",
    x: 30, y: 960, w: 280, h: 80,
    color: C.pink, bg: "#1a0d14",
    title: "IAP Kauf (RevenueCat)",
    lines: ["oder Stripe Web"],
    detail:
      "iOS/Android-Käufe über RevenueCat In-App-Purchase. Web-Käufe über Stripe Checkout. Beide Webhook-basierten Flows enden im selben Supabase-Update.",
  },
  {
    id: "sub-tier",
    x: 30, y: 1105, w: 280, h: 80,
    color: C.teal, bg: "#0a1a16",
    title: "Supabase: profiles",
    lines: ['subscription_tier =', '"smart" / "pro" / "plus"'],
    detail:
      "RC- oder Stripe-Webhook setzt subscription_tier auf den gekauften Plan. Ab jetzt unbegrenzt Zugang je nach Tier.",
    codeRef: "app/api/webhooks/revenuecat/route.ts",
  },
  // ── side detail nodes ─────────────────────────────────────────────────────
  {
    id: "supabase-insert",
    x: 345, y: 163, w: 225, h: 48,
    color: C.teal, bg: "#0a1a16",
    title: "Supabase: leads",
    lines: ["INSERT neu"],
    detail:
      "Lead-Datensatz (email, name, phone, meta_lead_id) in die leads-Tabelle schreiben.",
    codeRef: "supabase/schema → leads",
  },
  {
    id: "provision",
    x: 345, y: 217, w: 225, h: 48,
    color: C.purple, bg: "#140d1a",
    title: "provisionMetaLead()",
    lines: ["→ signup-notification"],
    detail:
      "Orchestriert die nächste Stufe: ruft /api/crm/signup-notification auf, um den Aktivierungs-Link zu versenden.",
    codeRef: "lib/leads/provisionMetaLead.ts",
  },
  {
    id: "resend-email",
    x: 345, y: 325, w: 225, h: 60,
    color: C.purple, bg: "#140d1a",
    title: "Resend: Email an Lead",
    lines: ["Aktivierungs-Link, 7 Tage"],
    detail:
      "E-Mail mit personalisierten Magic-Link an den Lead. Link läuft nach 7 Tagen ab.",
  },
  {
    id: "resend-notif",
    x: 345, y: 393, w: 225, h: 42,
    color: C.purple, bg: "#140d1a",
    title: "Resend: Notification",
    lines: ["crm@glev.app + glev@beauty-flow.de"],
    detail:
      "CRM-Notification an das Team: neuer Meta-Lead eingetroffen, mit Name und E-Mail-Adresse.",
  },
  {
    id: "rc-webhook",
    x: 345, y: 962, w: 225, h: 60,
    color: C.pink, bg: "#1a0d14",
    title: "RC Webhook / Stripe Webhook",
    detail:
      "Webhook von RevenueCat oder Stripe triggert das subscription_tier-Update in Supabase profiles.",
    codeRef: "app/api/webhooks/revenuecat/route.ts",
  },
  // ── error branch ──────────────────────────────────────────────────────────
  {
    id: "link-expired",
    x: 345, y: 485, w: 225, h: 65,
    color: C.red, bg: "#1a0a0a",
    title: "Link abgelaufen",
    lines: ["7 Tage überschritten"],
    detail:
      "Der Magic-Link ist nicht mehr gültig. Supabase Auth gibt einen Fehler zurück und leitet zur Confirm-Seite weiter.",
  },
  {
    id: "auth-confirm",
    x: 345, y: 585, w: 225, h: 70,
    color: C.red, bg: "#1a0a0a",
    title: "/auth/confirm?email=X",
    lines: ['⟶ "Neuen Link anfordern"'],
    detail:
      "Die Confirm-Seite erkennt den abgelaufenen Link und zeigt einen Button. Per Klick wird ein neuer Link angefordert.",
    codeRef: "app/auth/confirm/page.tsx",
  },
  {
    id: "reactivate",
    x: 345, y: 690, w: 225, h: 52,
    color: C.red, bg: "#1a0a0a",
    title: "/api/auth/reactivate-trial",
    detail:
      "Versendet einen neuen Aktivierungs-Link. Das 7-Tage-Trial-Fenster startet erst beim erneuten Klick (→ zurück zu Schritt 4).",
    codeRef: "app/api/auth/reactivate-trial/route.ts",
  },
  // ── info box ──────────────────────────────────────────────────────────────
  {
    id: "webhook-404",
    x: 620, y: 30, w: 255, h: 165,
    color: C.indigo, bg: "#0d0d1a",
    title: "ℹ Webhook 404 (historisch)",
    lines: [
      "22.06.–25.06.2026:",
      "Meta-Webhooks schlugen fehl.",
      "Leads nicht erfasst,",
      "kein Trial-E-Mail versendet.",
      "Behoben 25.06.",
      "Tarn-Worker live 23.06",
      "→ mealpatterns.app",
      "Meta-dunkel: PR #76 (22.06)",
    ],
    detail:
      "Historischer Bug: /api/meta/leads antwortete mit 404. Meta-Webhooks schlugen fehl. Leads aus diesem Zeitraum wurden nicht erfasst. Behoben durch Route-Fix am 25.06.2026. Tarn-Worker live seit 23.06 auf mealpatterns.app. glev.app Meta-dunkel-Pattern seit PR #76 (22.06).",
  },
  // ── outbound conversion nodes ───────────────────────────────────────────────
  {
    id: "signup-trigger",
    x: 30, y: 1310, w: 280, h: 70,
    color: C.green, bg: "#0d1a0d",
    title: "User Signup / Onboarding Complete",
    lines: ["Trigger — nach Trial-Aktivierung"],
    detail:
      "Wird nach erfolgreichem Onboarding / Trial-Aktivierung gefeuert. Startet den Outbound-Conversion-Signal-Layer für Meta CAPI und GA4.",
  },
  {
    id: "signup-conversion",
    x: 30, y: 1430, w: 280, h: 80,
    color: C.amber, bg: "#1a1000",
    title: "app/api/internal/signup-conversion",
    lines: ["→ Tarn-Worker (Bearer-Auth)", "→ glev.app Meta-dunkel"],
    detail:
      "Interner API-Endpoint. Weiterleitung des Conversion-Events an den Tarn-Worker auf mealpatterns.app via Bearer-Token (META_TARN_CAPI_SECRET).",
    codeRef: "app/api/internal/signup-conversion/route.ts",
  },
  {
    id: "tarn-worker",
    x: 30, y: 1565, w: 280, h: 105,
    color: C.purple, bg: "#140d1a",
    title: "Tarn-Worker: mealpatterns.app/api/conversion",
    lines: ["glev.app Meta-dunkel", "Live seit 23.06.2026"],
    detail:
      "Externer Proxy-Service auf mealpatterns.app. Sendet Conversion-Events an Meta CAPI und GA4 ohne direkten Bezug zu glev.app (Meta-Darkening-Pattern). Live seit 23.06.2026.",
  },
  {
    id: "meta-capi-outbound",
    x: 345, y: 1570, w: 215, h: 60,
    color: C.blue, bg: "#0d0d1a",
    title: "Meta CAPI",
    lines: ["Signup-Event · Conversion-Attribution"],
    detail:
      "Facebook Conversion API empfängt das Signup-Event vom Tarn-Worker. Conversion-Attribution ohne Browser-Pixel.",
  },
  {
    id: "ga4-conversion",
    x: 345, y: 1645, w: 215, h: 60,
    color: C.red, bg: "#1a0a0a",
    title: "GA4: ads_conversion_SIGNUP_1",
    lines: ["Google Analytics — Conversion-Event"],
    detail:
      "Google Analytics 4 Conversion-Event via Tarn-Worker. Tracking-Event: ads_conversion_SIGNUP_1.",
  },
  {
    id: "backfill-gap",
    x: 620, y: 1310, w: 255, h: 100,
    color: C.amber, bg: "#1a1000",
    title: "⚠️ Backfill Endpoint",
    lines: ["kein CAPI-Signal", "Fix in PR #92 (pending)"],
    detail:
      "Backfill-Endpoint für Leads aus der 404-Periode (22.06–25.06) sendet kein CAPI-Signal. Diese Leads haben kein Conversion-Tracking. Fix folgt in PR #92.",
  },
];

// ── component ─────────────────────────────────────────────────────────────────
export default function LeadFlowDiagram() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = NODES.find((n) => n.id === selectedId) ?? null;

  function handleNodeClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        padding: "24px 24px 64px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#fff",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>
          Lead Flow
        </h1>
        <p style={{ fontSize: 12, color: "#555", margin: "4px 0 0" }}>
          Meta Lead → Trial → Conversion · Stand 25.06.2026 · Klicke einen Node für Details
        </p>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          [C.green, "Externer Trigger"],
          [C.blue, "API Endpoint"],
          [C.teal, "Datenbank"],
          [C.purple, "Service / Funktion"],
          [C.amber, "UI / App"],
          [C.pink, "Payment"],
          [C.red, "Fehler-Pfad"],
          [C.indigo, "Info"],
        ].map(([color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: "#888" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div
        style={{
          minHeight: 56,
          marginBottom: 20,
          maxWidth: 660,
          transition: "opacity 0.15s",
          opacity: selectedNode ? 1 : 0,
        }}
      >
        {selectedNode && (
          <div
            style={{
              background: "#111",
              border: `1px solid ${selectedNode.color}`,
              borderRadius: 8,
              padding: "12px 16px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: selectedNode.color,
                marginBottom: 4,
              }}
            >
              {selectedNode.title}
            </div>
            {selectedNode.detail && (
              <div
                style={{
                  fontSize: 12,
                  color: "#ccc",
                  lineHeight: 1.5,
                  marginBottom: selectedNode.codeRef ? 8 : 0,
                }}
              >
                {selectedNode.detail}
              </div>
            )}
            {selectedNode.codeRef && (
              <code
                style={{
                  fontSize: 11,
                  color: "#666",
                  background: "#0a0a0a",
                  padding: "2px 6px",
                  borderRadius: 3,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {selectedNode.codeRef}
              </code>
            )}
          </div>
        )}
      </div>

      {/* SVG Diagram */}
      <div style={{ overflowX: "auto", overflowY: "visible" }}>
        <svg
          width={900}
          height={1800}
          style={{ display: "block" }}
          aria-label="Glev Lead Flow Diagramm"
        >
          <style>{`
            .fnode { cursor: pointer; }
            .fnode rect.bg { transition: opacity 0.12s; opacity: 0.88; }
            .fnode:hover rect.bg { opacity: 1; }
            .fnode.sel rect.bg { opacity: 1; }
            .fnode.sel rect.glow { opacity: 0.25; }
            .fnode rect.glow { opacity: 0; }
          `}</style>

          <defs>
            {(Object.entries(C) as [ArrowColor, string][]).map(([id, color]) => (
              <marker
                key={id}
                id={`arr-${id}`}
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill={color} />
              </marker>
            ))}
          </defs>

          {/* ── main flow vertical arrows ─────────────────────────────────── */}
          <VArrow x={170} y1={100} y2={160} c="blue" label="Webhook POST" />
          <VArrow x={170} y1={260} y2={325} c="blue" />
          <VArrow x={170} y1={420} y2={485} c="blue" label="Lead erhält E-Mail" />
          <VArrow x={170} y1={555} y2={620} c="blue" />
          <VArrow x={170} y1={720} y2={785} c="blue" />
          <VArrow x={170} y1={895} y2={960} c="blue" label="User kauft Abo" />
          <VArrow x={170} y1={1040} y2={1105} c="blue" />

          {/* ── side detail arrows ────────────────────────────────────────── */}
          <HArrow x1={310} x2={345} y={187} c="teal" dashed />
          <HArrow x1={310} x2={345} y={241} c="purple" dashed />
          <HArrow x1={310} x2={345} y={355} c="purple" dashed />
          <HArrow x1={310} x2={345} y={414} c="purple" dashed />
          <HArrow x1={310} x2={345} y={992} c="pink" dashed />

          {/* ── error branch horizontal arrow ─────────────────────────────── */}
          <HArrow x1={310} x2={345} y={517} c="red" label="Link abgelaufen" />

          {/* ── error branch vertical arrows ──────────────────────────────── */}
          <VArrow x={457} y1={550} y2={585} c="red" />
          <VArrow x={457} y1={655} y2={690} c="red" />

          {/* ── return note below error branch ────────────────────────────── */}
          <text
            x={350}
            y={758}
            fill={C.red}
            fontSize={9.5}
            opacity={0.6}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            ↩ neuer Link → zurück zu Schritt 4
          </text>

          {/* ── outbound section separator ───────────────────────────────── */}
          <line x1={30} y1={1272} x2={875} y2={1272} stroke="#2a2a2a" strokeWidth={1.5} strokeDasharray="6 4" />
          <text
            x={30}
            y={1294}
            fill="#444"
            fontSize={10}
            fontWeight={700}
            letterSpacing={1.2}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            OUTBOUND CONVERSION SIGNALS
          </text>

          {/* ── outbound conversion arrows ────────────────────────────────── */}
          <VArrow x={170} y1={1380} y2={1430} c="green" />
          <VArrow x={170} y1={1510} y2={1565} c="amber" label="Bearer META_TARN_CAPI_SECRET" />
          <HArrow x1={310} x2={345} y={1600} c="blue" dashed />
          <HArrow x1={310} x2={345} y={1675} c="red" dashed />

          {/* ── all nodes ────────────────────────────────────────────────── */}
          {NODES.map((n) => (
            <NodeRect
              key={n.id}
              node={n}
              selected={selectedId === n.id}
              onClick={() => handleNodeClick(n.id)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ── SVG sub-components ────────────────────────────────────────────────────────

function NodeRect({
  node,
  selected,
  onClick,
}: {
  node: FlowNode;
  selected: boolean;
  onClick: () => void;
}) {
  const px = 12;
  const lines = node.lines ?? [];
  const titleY = lines.length === 0 ? node.y + node.h / 2 + 4 : node.y + 20;

  return (
    <g
      className={`fnode${selected ? " sel" : ""}`}
      onClick={onClick}
      role="button"
      aria-label={node.title}
      aria-pressed={selected}
    >
      {/* glow ring (visible when selected via CSS) */}
      <rect
        className="glow"
        x={node.x - 3}
        y={node.y - 3}
        width={node.w + 6}
        height={node.h + 6}
        rx={11}
        fill="none"
        stroke={node.color}
        strokeWidth={3}
      />
      {/* main background */}
      <rect
        className="bg"
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={8}
        fill={node.bg}
        stroke={node.color}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {/* title */}
      <text
        x={node.x + px}
        y={titleY}
        fill={node.color}
        fontSize={12}
        fontWeight={700}
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing={0.2}
        style={{ pointerEvents: "none" }}
      >
        {node.title}
      </text>
      {/* content lines */}
      {lines.map((line, i) => (
        <text
          key={i}
          x={node.x + px}
          y={titleY + 17 + i * 16}
          fill="#888"
          fontSize={10.5}
          fontFamily="system-ui, -apple-system, sans-serif"
          style={{ pointerEvents: "none" }}
        >
          {line}
        </text>
      ))}
      {/* click indicator */}
      <text
        x={node.x + node.w - 8}
        y={node.y + 13}
        fill={node.color}
        fontSize={8}
        textAnchor="end"
        opacity={0.5}
        fontFamily="system-ui, -apple-system, sans-serif"
        style={{ pointerEvents: "none" }}
      >
        ↗
      </text>
    </g>
  );
}

function VArrow({
  x,
  y1,
  y2,
  c,
  label,
}: {
  x: number;
  y1: number;
  y2: number;
  c: ArrowColor;
  label?: string;
}) {
  const color = C[c];
  const mid = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={y2 - 7}
        stroke={color}
        strokeWidth={1.5}
        markerEnd={`url(#arr-${c})`}
      />
      {label && (
        <text
          x={x + 7}
          y={mid + 4}
          fill={color}
          fontSize={10}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function HArrow({
  x1,
  x2,
  y,
  c,
  label,
  dashed,
}: {
  x1: number;
  x2: number;
  y: number;
  c: ArrowColor;
  label?: string;
  dashed?: boolean;
}) {
  const color = C[c];
  const mid = (x1 + x2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y}
        x2={x2 - 7}
        y2={y}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd={`url(#arr-${c})`}
      />
      {label && (
        <text
          x={mid}
          y={y - 6}
          fill={color}
          fontSize={10}
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {label}
        </text>
      )}
    </g>
  );
}
