"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { signOut, getCurrentUser } from "@/lib/auth";
import GlevLockup from "@/components/GlevLockup";

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.4.0";

export default function AboutGlevModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("about");
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!cancelled) setEmail(u?.email ?? null);
      } catch {
        if (!cancelled) setEmail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      onClose();
      router.push("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "var(--overlay)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: 0,
      }}
    >
      <style>{`@keyframes aboutSlideDown{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: SURFACE,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderRadius: "0 0 20px 20px",
          padding: "max(20px, calc(env(safe-area-inset-top) + 14px)) 22px 24px",
          animation: "aboutSlideDown 0.25s cubic-bezier(0.4,0,0.2,1)",
          display: "flex", flexDirection: "column", gap: 18,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <GlevLockup size={40} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label={t("row_version")} value={`v${APP_VERSION}`} />
          <Row label={t("row_account")} value={email ?? "—"} mono />
        </div>

        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
          {t("description")}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12,
              border: `1px solid ${BORDER}`, background: "transparent",
              color: "var(--text-strong)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("close_btn")}
          </button>
          <button
            onClick={handleSignOut}
            disabled={busy}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12,
              border: `1px solid ${PINK}40`, background: `${PINK}15`,
              color: PINK, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? t("signout_busy") : t("signout_idle")}
          </button>
        </div>

        <button
          onClick={() => { onClose(); router.push("/settings"); }}
          style={{
            background: "transparent", border: "none",
            color: ACCENT, fontSize: 12, fontWeight: 600,
            padding: "4px 0", cursor: "pointer", textAlign: "center",
          }}
        >
          {t("open_settings")}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        padding: "10px 14px", borderRadius: 10,
        background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
      }}
    >
      <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 12, fontWeight: 600, color: "var(--text-strong)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}
