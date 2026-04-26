"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, getCurrentUser } from "@/lib/auth";
import GlevLockup from "@/components/GlevLockup";

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.08)";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.4.0";

export default function AboutGlevModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
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
          <Row label="Version" value={`v${APP_VERSION}`} />
          <Row label="Account" value={email ?? "—"} mono />
        </div>

        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.55 }}>
          Glev helps you log meals, track CGM trends, and learn your personal insulin response — turning every meal into better data.
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12,
              border: `1px solid ${BORDER}`, background: "transparent",
              color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Close
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
            {busy ? "Signing out…" : "Sign out"}
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
          Open Settings →
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
        background: "rgba(255,255,255,0.025)", border: `1px solid ${BORDER}`,
      }}
    >
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
      <span
        style={{
          fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}
