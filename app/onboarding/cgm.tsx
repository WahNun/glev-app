"use client";

/**
 * Onboarding flow — Step 5 of 5: CGM Setup.
 *
 * Two-stage picker:
 *   Stage A — vendor: Dexcom, FreeStyle Libre, Medtronic, Andere
 *   Stage B — method per vendor: Apple Health, LibreLinkUp,
 *             Nightscout (subset varies per vendor)
 *
 * Cards in the body ARE the primary actions (no duplicate footer
 * button — see Shell `hidePrimary`). The top-right Skip and the
 * "Später, in den Einstellungen einrichten" link below the cards
 * both complete onboarding without a CGM connection and drop the
 * user on /dashboard. Replay is available later from Settings →
 * "Onboarding wiederholen".
 *
 * Method-card click — we don't duplicate the LLU / Nightscout / AH
 * forms here. Instead we mark onboarding complete (so the protected
 * gate stops triggering) and deep-link into /settings?cgmSetup=<m>.
 * The settings page reads the param and auto-opens the matching
 * sheet, where the existing CgmSettingsCard does the real work.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Shell,
  ACCENT,
  GREEN,
  PINK,
  ORANGE,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
} from "./_shared";

type Vendor = "dexcom" | "libre" | "medtronic" | "other";
type Method = "apple_health" | "librelinkup" | "nightscout";

const VENDOR_METHODS: Record<Vendor, Method[]> = {
  dexcom:    ["apple_health", "nightscout"],
  libre:     ["librelinkup", "apple_health", "nightscout"],
  medtronic: ["apple_health", "nightscout"],
  other:     ["apple_health", "nightscout"],
};

const VENDOR_COLOR: Record<Vendor, string> = {
  dexcom:    GREEN,
  libre:     ORANGE,
  medtronic: ACCENT,
  other:     PINK,
};

// Map onboarding-method → settings-sheet key. Apple Health lives
// inside the libre2 sheet (CgmSettingsCard renders the AH section
// at the bottom of that card on iOS).
const METHOD_TO_SHEET: Record<Method, "libre2" | "nightscout"> = {
  librelinkup:  "libre2",
  apple_health: "libre2",
  nightscout:   "nightscout",
};

export default function CgmStep({
  onSkip,
  onBack,
  primaryDisabled,
}: {
  onSkip: () => void;
  onBack: () => void;
  primaryDisabled?: boolean;
}) {
  const t = useTranslations("onboarding.cgm");
  const router = useRouter();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [busy, setBusy] = useState(false);

  // Method click — complete onboarding first (so the gate stops
  // bouncing the user back here), THEN deep-link to settings with
  // the right sheet pre-opened. Best-effort: if the POST fails we
  // still navigate, the worst outcome is the user sees onboarding
  // once more on next sign-in.
  async function pickMethod(method: Method) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
    } catch {
      /* swallow */
    }
    if (typeof window !== "undefined") {
      window.location.href = `/settings?cgmSetup=${method}`;
    }
  }

  // Stage-internal back: from method-picker, going back returns to
  // the vendor-picker rather than to the previous onboarding step.
  function back() {
    if (vendor != null) setVendor(null);
    else onBack();
  }

  return (
    <Shell
      step={4}
      onNext={onSkip}
      onBack={back}
      onSkip={onSkip}
      primaryDisabled={primaryDisabled || busy}
      hidePrimary
    >
      <div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "-0.02em",
            marginBottom: 6,
            lineHeight: 1.2,
          }}
        >
          {vendor == null ? t("headline") : t(`vendor_${vendor}_headline`)}
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {vendor == null ? t("sub") : t("method_sub")}
        </p>
      </div>

      {vendor == null ? (
        <VendorList onPick={setVendor} t={t} />
      ) : (
        <MethodList
          vendor={vendor}
          methods={VENDOR_METHODS[vendor]}
          onPick={pickMethod}
          busy={busy}
          t={t}
        />
      )}

      {/* "Skip — set up later" link, mirrored as the top-right Skip.
          Two surfaces because mobile users tend to look for the
          escape hatch at the bottom of the body, not the top-right
          corner. Both call the same `onSkip`. */}
      <button
        onClick={onSkip}
        disabled={busy}
        style={{
          background: "transparent",
          border: "none",
          color: TEXT_DIM,
          fontSize: 13,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          textAlign: "center",
          padding: "10px 14px",
          fontFamily: "inherit",
          textDecoration: "underline",
          textUnderlineOffset: 3,
          opacity: busy ? 0.5 : 1,
        }}
      >
        {t("skip_later")}
      </button>
    </Shell>
  );
}

// ─── Vendor picker ──────────────────────────────────────────────
function VendorList({
  onPick,
  t,
}: {
  onPick: (v: Vendor) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const vendors: Vendor[] = ["dexcom", "libre", "medtronic", "other"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {vendors.map((v) => (
        <Card
          key={v}
          color={VENDOR_COLOR[v]}
          title={t(`vendor_${v}_title`)}
          body={t(`vendor_${v}_devices`)}
          onClick={() => onPick(v)}
          chevron
        />
      ))}
    </div>
  );
}

// ─── Method picker ──────────────────────────────────────────────
function MethodList({
  vendor,
  methods,
  onPick,
  busy,
  t,
}: {
  vendor: Vendor;
  methods: Method[];
  onPick: (m: Method) => void;
  busy: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {methods.map((m, i) => {
        const recommended = i === 0;
        const titleKey = `method_${m}_title`;
        const bodyKey  = `method_${vendor}_${m}_body`;
        return (
          <Card
            key={m}
            color={recommended ? ACCENT : "rgba(255,255,255,0.18)"}
            title={t(titleKey)}
            body={t(bodyKey)}
            badge={recommended ? t("recommended") : undefined}
            onClick={() => onPick(m)}
            disabled={busy}
            chevron
          />
        );
      })}
    </div>
  );
}

// ─── Card primitive ─────────────────────────────────────────────
function Card({
  color,
  title,
  body,
  badge,
  chevron = false,
  disabled = false,
  onClick,
}: {
  color: string;
  title: string;
  body: string;
  badge?: string;
  chevron?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        gap: 12,
        alignItems: "center",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: TEXT,
        fontFamily: "inherit",
        width: "100%",
        transition: "transform 0.08s, background 0.15s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 3,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
          {badge && (
            <span
              style={{
                background: `${ACCENT}22`,
                color: ACCENT,
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 99,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
      {chevron && (
        <span style={{ color: TEXT_DIM, fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
          ›
        </span>
      )}
    </button>
  );
}
