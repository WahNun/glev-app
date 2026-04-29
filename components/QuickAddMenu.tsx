"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ACCENT = "#4F6EF7";
const SHEET_BG = "#1A1A24";
const TEXT = "rgba(255,255,255,0.92)";
const TEXT_DIM = "rgba(255,255,255,0.55)";
const BORDER = "rgba(255,255,255,0.08)";

type Item = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const DROPLET = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
);

const SYRINGE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2l4 4" />
    <path d="M16 4l4 4" />
    <path d="M19 7l-9 9" />
    <path d="M11 15l-2 2-3 3-3-3 3-3 2-2" />
    <path d="M14 10l3 3" />
  </svg>
);

const RUN = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13" cy="4" r="2" />
    <path d="M4 22l4-9 5 3v6" />
    <path d="M13 13l-2-4-3 1-2 5" />
    <path d="M15 8l3 1 2 4" />
  </svg>
);

const ITEMS: Item[] = [
  { label: "Glukose messen", href: "/engine?tab=fingerstick", icon: DROPLET },
  { label: "Insulin loggen", href: "/engine?tab=bolus",       icon: SYRINGE },
  { label: "Sport loggen",   href: "/engine?tab=exercise",    icon: RUN },
];

/**
 * Compact "+" header button that pops a small dropdown of secondary
 * logging shortcuts (Glukose / Insulin / Sport). Replaces the old
 * full-width slide-up GlevActionSheet for those three options. The
 * primary "Mahlzeit loggen" lives directly on the bottom-nav Glev
 * tap, so this menu is intentionally lightweight.
 */
export default function QuickAddMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside pointerdown / Escape. We use pointerdown (not
  // click) so the menu collapses before the underlying tap target
  // receives focus — matches iOS context-menu feel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <style>{`
        @keyframes glevQuickAddIn {
          from { transform: scale(0.94) translateY(-4px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Quick-Add schließen" : "Schnell loggen"}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 32, height: 32, borderRadius: 99, padding: 0,
          background: open ? `${ACCENT}25` : "rgba(255,255,255,0.05)",
          border: `1px solid ${open ? ACCENT : "rgba(255,255,255,0.1)"}`,
          color: open ? ACCENT : "rgba(255,255,255,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          aria-hidden
          style={{
            transition: "transform 0.18s cubic-bezier(0.32, 0.72, 0, 1)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 220,
            background: SHEET_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: 6,
            zIndex: 60,
            transformOrigin: "top right",
            animation: "glevQuickAddIn 0.18s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          {ITEMS.map(it => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => go(it.href)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "10px 12px",
                background: "transparent", border: "none",
                color: TEXT, fontSize: 13.5, fontWeight: 500,
                cursor: "pointer", textAlign: "left",
                borderRadius: 10,
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
                color: TEXT_DIM,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {it.icon}
              </span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
