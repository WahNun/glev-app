"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { hapticLight, hapticSelection } from "@/lib/haptics";

const ACCENT = "#4F6EF7";
const SHEET_BG = "var(--surface-alt)";
const TEXT = "var(--text-strong)";
const TEXT_DIM = "var(--text-muted)";
const BORDER = "var(--border)";

const MEAL = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
);

const DROPLET = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
);

const RUN = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 2 13 9 19 9" />
    <polyline points="11 22 11 15 5 15" />
    <path d="M21 13a9 9 0 0 1-15 6.7" />
    <path d="M3 11a9 9 0 0 1 15-6.7" />
  </svg>
);

// Engine-Tab (Glev AI / Sprache-Eingabe). Vier-Punkt-Sternchen, das
// dem Glev-Logo nachempfunden ist — visuelle Brücke zur Engine.
const ENGINE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="3" r="1.5" />
    <circle cx="12" cy="21" r="1.5" />
    <circle cx="3" cy="12" r="1.5" />
    <circle cx="21" cy="12" r="1.5" />
    <line x1="12" y1="5" x2="12" y2="10" />
    <line x1="12" y1="14" x2="12" y2="19" />
    <line x1="5" y1="12" x2="10" y2="12" />
    <line x1="14" y1="12" x2="19" y2="12" />
  </svg>
);

// Insulin/Bolus — Spritze-Glyph
const SYRINGE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2l4 4" />
    <path d="M17 3l4 4-7 7-4-4z" />
    <path d="M14 7l-7 7" />
    <path d="M9 12l3 3" />
    <path d="M7 14l-4 4 2 2 4-4" />
  </svg>
);

// The dropdown now mirrors the three options that used to live in the
// bottom-of-screen Glev action sheet (which was deleted with the same
// change that made the bottom-nav Glev tap route directly to the meal
// voice screen). Keeping all three reachable from the header keeps a
// single global affordance for "log something" — Mahlzeit appears
// here AND under the Glev tab on purpose, so power users can reach
// the meal flow from any screen via the always-visible header "+"
// without first jumping to Glev.
const CYCLE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18" />
  </svg>
);

const SYMPTOM_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.39 6.96H22l-6.18 4.49L18.18 22 12 17.27 5.82 22l2.36-8.55L2 8.96h7.61L12 2z" />
  </svg>
);

type ItemDef = {
  key:
    | "open_engine"
    | "log_meal"
    | "log_insulin"
    | "measure_glucose"
    | "log_activity"
    | "log_cycle"
    | "log_symptoms";
  href: string;
  icon: React.ReactNode;
};
// Reihenfolge spiegelt die alte Engine-Pille (Engine, Insulin,
// Exercise, Glucose) plus die bereits im "+" vorhandenen Logging-
// Shortcuts (Mahlzeit, Zyklus, Symptome). Damit hat der User EINE
// Stelle für alle Engine-Tabs + alle Schnell-Eingaben.
const ITEM_DEFS: ItemDef[] = [
  { key: "open_engine",      href: "/engine?tab=engine",      icon: ENGINE_ICON  },
  { key: "log_meal",         href: "/engine?tab=log",         icon: MEAL         },
  { key: "log_insulin",      href: "/engine?tab=bolus",       icon: SYRINGE_ICON },
  { key: "measure_glucose",  href: "/engine?tab=fingerstick", icon: DROPLET      },
  { key: "log_activity",     href: "/engine?tab=exercise",    icon: RUN          },
  { key: "log_cycle",        href: "/engine?tab=cycle",       icon: CYCLE_ICON   },
  { key: "log_symptoms",     href: "/engine?tab=symptoms",    icon: SYMPTOM_ICON },
];

/**
 * Compact "+" header button that pops a small dropdown of the three
 * primary logging shortcuts (Mahlzeit / Glukose / Aktivität). This is
 * the only home for the Glukose + Aktivität flows on mobile now that
 * the Glev bottom-nav tap routes straight to the meal voice screen
 * — see Layout.tsx for the matching tap handler. Mahlzeit also lives
 * here so the header "+" stays a complete, self-sufficient menu.
 */
export default function QuickAddMenu() {
  const t = useTranslations("quickAdd");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // pointerdown (not click) so the menu collapses before the next
  // tap target receives focus.
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
    hapticLight();
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
        onClick={() => {
          hapticSelection();
          setOpen(o => !o);
        }}
        aria-label={open ? t("close_aria") : t("open_aria")}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 32, height: 32, borderRadius: 99, padding: 0,
          background: open ? `${ACCENT}25` : "var(--surface-soft)",
          border: `1px solid ${open ? ACCENT : "var(--border-strong)"}`,
          color: open ? ACCENT : "var(--text-body)",
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
          {ITEM_DEFS.map(it => (
            <button
              key={it.key}
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
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: "var(--surface-soft)",
                color: TEXT_DIM,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {it.icon}
              </span>
              <span>{t(it.key)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
