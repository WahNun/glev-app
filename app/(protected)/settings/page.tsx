"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import { signOut } from "@/lib/auth";
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
  const [signingOut, setSigningOut] = useState(false);
  const [referralSharing, setReferralSharing] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [referralError, setReferralError] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }, [signingOut, router]);

  const handleShareReferral = useCallback(async () => {
    if (referralSharing) return;
    setReferralSharing(true);
    setReferralError(false);
    try {
      const res = await fetch("/api/me/referral", { credentials: "include" });
      if (!res.ok) throw new Error("api_error");
      const { shareUrl } = await res.json() as { shareUrl: string };

      const title = t("referral_share_title");
      const text = t("referral_share_text", { url: shareUrl });

      let shared = false;
      try {
        const { Share } = await import("@capacitor/share");
        const { value: canShare } = await Share.canShare();
        if (canShare) { await Share.share({ title, text, url: shareUrl, dialogTitle: title }); shared = true; }
      } catch { /* fallthrough */ }

      if (!shared && typeof navigator !== "undefined" && navigator.share) {
        try { await navigator.share({ title, text, url: shareUrl }); shared = true; } catch { /* fallthrough */ }
      }

      if (!shared) {
        await navigator.clipboard.writeText(shareUrl);
        setReferralCopied(true);
        setTimeout(() => setReferralCopied(false), 2500);
      }
    } catch {
      setReferralError(true);
      setTimeout(() => setReferralError(false), 3000);
    } finally {
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
          "Konto", "/settings/konto", true)}
        {row(PURPLE,
          <svg {...ip}><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>,
          "App-Einstellungen", "/settings/app")}
      </NavSection>

      <NavSection>
        <button
          type="button"
          onClick={handleShareReferral}
          disabled={referralSharing}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "transparent", border: "none", cursor: referralSharing ? "wait" : "pointer", textAlign: "left", color: "inherit" }}
        >
          <span aria-hidden style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${GREEN}18`, color: referralError ? "#EF4444" : GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg {...ip}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
          </span>
          <span style={{ flex: 1, lineHeight: 1.25 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: referralError ? "#EF4444" : "var(--text-strong)" }}>
              {referralError ? "Fehler — bitte nochmal versuchen" : referralCopied ? t("referral_share_copy_success") : t("row_referral")}
            </span>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-faint)", marginTop: 1 }}>
              {t("subtitle_referral")}
            </span>
          </span>
          <span aria-hidden style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: 18, lineHeight: 1 }}>
            {referralSharing ? "…" : "›"}
          </span>
        </button>
      </NavSection>

      <NavSection>
        {row(GREEN,
          <svg {...ip}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
          "Für den Arzt", "/settings/fuer-den-arzt", true)}
        {row(ACCENT,
          <svg {...ip}><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12l8-8" /><path d="M18 2h4v4" /></svg>,
          "Glev Engine", "/settings/glev-engine")}
        {row(ACCENT,
          <svg {...ip}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>,
          "Mein Körper", "/settings/mein-koerper")}
        {row(ACCENT,
          <svg {...ip}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>,
          "Insulin", "/settings/insulin")}
        {row(GREEN,
          <svg {...ip}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>,
          "Glukose", "/settings/glukose")}
        {row(ACCENT,
          <svg {...ip}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>,
          "Sensor & Alarme", "/settings/sensor-alarme")}
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

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        style={{
          display: "block",
          width: "100%",
          marginTop: 24,
          marginBottom: 32,
          padding: "14px",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 14,
          fontSize: 15,
          fontWeight: 600,
          color: signingOut ? "rgba(239,68,68,0.45)" : "#ef4444",
          cursor: signingOut ? "wait" : "pointer",
          letterSpacing: "-0.01em",
          opacity: signingOut ? 0.6 : 1,
        }}
      >
        {signingOut ? "Wird abgemeldet…" : "Abmelden"}
      </button>
    </div>
  );
}
