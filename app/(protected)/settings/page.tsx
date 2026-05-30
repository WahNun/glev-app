"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import PlanSimulator from "@/components/PlanSimulator";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PURPLE = "#A78BFA";

const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

interface NavRowProps {
  iconColor: string;
  icon: React.ReactNode;
  label: string;
  path: string;
  router: ReturnType<typeof useRouter>;
}

function NavRow({ iconColor, icon, label, path, router }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={() => router.push(path)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "12px 14px", background: "transparent", border: "none",
        cursor: "pointer", textAlign: "left", color: "inherit",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span aria-hidden style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${iconColor}18`, color: iconColor,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
        {label}
      </span>
      <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>›</span>
    </button>
  );
}

function NavSection({ children }: { children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
      }}>
        {children}
      </div>
    </section>
  );
}

function FirstNavRow({ iconColor, icon, label, path, router }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={() => router.push(path)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "12px 14px", background: "transparent", border: "none",
        cursor: "pointer", textAlign: "left", color: "inherit",
      }}
    >
      <span aria-hidden style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${iconColor}18`, color: iconColor,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
        {label}
      </span>
      <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>›</span>
    </button>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [referralSharing, setReferralSharing] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);

  const handleShareReferral = useCallback(async () => {
    if (referralSharing) return;
    setReferralSharing(true);
    try {
      const res = await fetch("/api/me/referral", { credentials: "include" });
      if (!res.ok) throw new Error("api_error");
      const { shareUrl } = await res.json() as { shareUrl: string };

      const title = t("referral_share_title");
      const text = t("referral_share_text", { url: shareUrl });

      try {
        const { Share } = await import("@capacitor/share");
        const { value: canShare } = await Share.canShare();
        if (canShare) { await Share.share({ title, text, url: shareUrl, dialogTitle: title }); return; }
      } catch { /* fallthrough */ }

      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text, url: shareUrl }); return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2500);
    } catch { /* ignore */ } finally {
      setReferralSharing(false);
    }
  }, [referralSharing, t]);

  const row = (iconColor: string, icon: React.ReactNode, label: string, path: string, first = false) => {
    const Comp = first ? FirstNavRow : NavRow;
    return <Comp key={path} iconColor={iconColor} icon={icon} label={label} path={path} router={router} />;
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
          {t("page_title")}
        </h1>
        <p style={{ color: "var(--text-faint)", fontSize: 14 }}>{t("page_subtitle")}</p>
      </div>

      <NavSection>
        {row(ACCENT,
          <svg {...ip}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>,
          t("section_account"), "/settings/konto", true)}
        <button
          type="button"
          onClick={handleShareReferral}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 14,
            padding: "12px 14px", background: "transparent", border: "none",
            cursor: referralSharing ? "wait" : "pointer", textAlign: "left", color: "inherit",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span aria-hidden style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: `${GREEN}18`, color: GREEN,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg {...ip}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
            {referralCopied ? t("referral_share_copy_success") : t("row_referral")}
          </span>
          <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>
            {referralSharing ? "…" : "›"}
          </span>
        </button>
        {row(GREEN,
          <svg {...ip}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>,
          t("section_glucose"), "/settings/glukose")}
        {row(ACCENT,
          <svg {...ip}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
          t("section_appointments"), "/settings/termine")}
        {row(ACCENT,
          <svg {...ip}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>,
          t("section_insulin"), "/settings/insulin")}
        {row(ACCENT,
          <svg {...ip}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>,
          "CGM", "/settings/cgm")}
        {row(PURPLE,
          <svg {...ip}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
          t("section_app"), "/settings/app")}
        {row(GREEN,
          <svg {...ip}><path d="M12 21V9" /><path d="M6 13l6-6 6 6" /><path d="M4 3h16" /></svg>,
          t("section_data"), "/settings/daten")}
        {row(GREEN,
          <svg {...ip}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>,
          t("section_integrations"), "/settings/integrationen")}
      </NavSection>

      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, marginTop: 4 }}>
        Featurewünsche und Hilfe
      </p>
      <NavSection>
        <button
          type="button"
          onClick={() => window.open("https://glev.featurebase.app/", "_blank", "noopener,noreferrer")}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit" }}
        >
          <span aria-hidden style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${PURPLE}18`, color: PURPLE, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg {...ip}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
            {t("row_feature_requests")}
          </span>
          <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>›</span>
        </button>
        <button
          type="button"
          onClick={() => router.push("/settings/help/cgm-quellen")}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit", borderTop: "1px solid var(--border)" }}
        >
          <span aria-hidden style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${ACCENT}18`, color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg {...ip}><path d="M21 12a9 9 0 1 1-3.5-7.1L21 3v6h-6" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
            {t("row_help_cgm_sources")}
          </span>
          <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>›</span>
        </button>
      </NavSection>

      <div style={{ marginTop: 32, marginBottom: 8 }}>
        <PlanSimulator />
      </div>

      <p style={{
        marginTop: 16, marginBottom: 8,
        marginLeft: "auto", marginRight: "auto",
        maxWidth: 560, fontSize: 13, lineHeight: 1.55,
        color: "var(--text-faint)", textAlign: "center",
      }}>
        {t("footer_disclaimer")}
      </p>
    </div>
  );
}
