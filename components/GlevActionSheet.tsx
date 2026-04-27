"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ACCENT = "#4F6EF7";
const SHEET_BG = "#1A1A24";
const TEXT = "#FFFFFF";
const TEXT_DIM = "rgba(255,255,255,0.55)";
const BORDER = "rgba(255,255,255,0.08)";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Sub = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const FORK_KNIFE = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3v6a2 2 0 0 0 2 2v10" />
    <path d="M8 3v6a2 2 0 0 1-2 2" />
    <path d="M6 11v0" />
    <path d="M18 21V3a4 4 0 0 0-4 4v6h4" />
  </svg>
);

const CHEVRON = (expanded: boolean) => (
  <svg
    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    style={{ transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const PLUS = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const DROPLET = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
);

const SYRINGE = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2l4 4" />
    <path d="M16 4l4 4" />
    <path d="M19 7l-9 9" />
    <path d="M11 15l-2 2-3 3-3-3 3-3 2-2" />
    <path d="M14 10l3 3" />
  </svg>
);

const RUN = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13" cy="4" r="2" />
    <path d="M4 22l4-9 5 3v6" />
    <path d="M13 13l-2-4-3 1-2 5" />
    <path d="M15 8l3 1 2 4" />
  </svg>
);

const SUB_OPTIONS: Sub[] = [
  { label: "Glukose messen", href: "/engine", icon: DROPLET },
  { label: "Insulin loggen", href: "/log", icon: SYRINGE },
  { label: "Exercise loggen", href: "/log", icon: RUN },
];

export default function GlevActionSheet({ open, onClose }: Props) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  // Reset the inline expansion whenever the sheet closes so it always
  // starts in its compact 2-row state on the next open.
  useEffect(() => {
    if (!open) setMoreOpen(false);
  }, [open]);

  // Lock body scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <>
      <style>{`
        @keyframes glevSheetSlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes glevSheetFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Overlay + sheet are mounted only when open so focus order and
          aria semantics stay clean. The wrapper covers the viewport so
          tapping anywhere outside the sheet closes it. */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Glev Aktionen"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.55)",
            animation: "glevSheetFadeIn 0.18s ease-out",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
          onClick={onClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 560,
              background: SHEET_BG,
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: `24px 24px calc(24px + env(safe-area-inset-bottom)) 24px`,
              animation: "glevSheetSlideUp 0.22s ease-out",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.15)", margin: "0 auto" }} aria-hidden />
              <button
                type="button"
                onClick={onClose}
                aria-label="Schließen"
                style={{
                  position: "absolute", top: 14, right: 14,
                  width: 36, height: 36, borderRadius: 99,
                  background: "rgba(255,255,255,0.06)", border: "none",
                  color: TEXT_DIM, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={() => go("/log")}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                width: "100%", padding: "18px 16px",
                background: `${ACCENT}14`,
                border: `1px solid ${ACCENT}44`,
                borderRadius: 14,
                color: TEXT, fontSize: 16, fontWeight: 600,
                cursor: "pointer", textAlign: "left",
                marginBottom: 10,
              }}
            >
              <span style={{
                width: 40, height: 40, borderRadius: 10,
                background: ACCENT, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {FORK_KNIFE}
              </span>
              <span style={{ flex: 1 }}>Mahlzeit loggen</span>
            </button>

            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="glev-sheet-more"
              style={{
                display: "flex", alignItems: "center", gap: 14,
                width: "100%", padding: "18px 16px",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
                color: TEXT, fontSize: 16, fontWeight: 600,
                cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{
                width: 40, height: 40, borderRadius: 10,
                background: "rgba(255,255,255,0.08)", color: TEXT,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {PLUS}
              </span>
              <span style={{ flex: 1 }}>Weiteres</span>
              <span style={{ color: TEXT_DIM }}>{CHEVRON(moreOpen)}</span>
            </button>

            {moreOpen && (
              <div
                id="glev-sheet-more"
                style={{
                  marginTop: 8, padding: "6px 4px 0",
                  display: "flex", flexDirection: "column", gap: 4,
                }}
              >
                {SUB_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => go(opt.href)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      width: "100%", padding: "14px 12px",
                      background: "transparent", border: "none",
                      color: TEXT, fontSize: 14, fontWeight: 500,
                      cursor: "pointer", textAlign: "left",
                      borderRadius: 10,
                    }}
                  >
                    <span style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: "rgba(255,255,255,0.05)",
                      color: TEXT_DIM,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {opt.icon}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
