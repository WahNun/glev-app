"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { hapticLight, hapticSelection } from "@/lib/haptics";
import GlevLogo from "@/components/GlevLogo";
import {
  fetchCycleLoggingEnabled,
  CYCLE_LOGGING_CHANGED_EVENT,
} from "@/lib/cyclePrefs";
import {
  fetchUserProfile,
  cycleSurfacesAvailable,
  USER_PROFILE_CHANGED_EVENT,
  type Sex,
} from "@/lib/userProfile";

const ACCENT = "#4F6EF7";
const SHEET_BG = "var(--surface-alt)";
const TEXT = "var(--text-strong)";
const TEXT_DIM = "var(--text-muted)";
const BORDER = "var(--border)";

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

// Engine-Tab (Glev AI / Sprache-Eingabe). Verwendet das echte Glev-
// Knoten-Logo wie der Glev-Tab in der Bottom-Nav, damit Header-"+"-
// und Footer-Tab visuell als derselbe Einstiegspunkt erkennbar sind.
const ENGINE_ICON = (
  <GlevLogo size={18} color={TEXT_DIM} bg="transparent" />
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
// Shortcuts (Zyklus, Symptome). "Mahlzeit loggen" ist absichtlich
// NICHT mehr drin — der "Glev"-Eintrag oben routet bereits auf
// /engine?tab=engine (den Mahlzeit-Voice/Text-Flow), ein zweiter
// Eintrag wäre redundant.
const ITEM_DEFS: ItemDef[] = [
  { key: "open_engine",      href: "/engine?tab=engine",      icon: ENGINE_ICON  },
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

  // "Zyklus loggen" gating is two-stage:
  //   1. Sex must NOT be 'male' (collected at onboarding). Male users
  //      never see the cycle row anywhere — Settings or here.
  //   2. The user must have flipped the opt-in toggle in Settings.
  // Both fetched once on mount + re-synced when the menu opens, plus
  // window-event listeners so a change in another part of the UI is
  // reflected immediately without a reload.
  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [sex, setSex] = useState<Sex | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchCycleLoggingEnabled()
      .then((v) => { if (!cancelled) setCycleEnabled(v); })
      .catch(() => {});
    fetchUserProfile()
      .then((p) => { if (!cancelled) setSex(p.sex); })
      .catch(() => {});
    function onCycleChange(e: Event) {
      const ce = e as CustomEvent<boolean>;
      if (typeof ce.detail === "boolean") setCycleEnabled(ce.detail);
    }
    function onProfileChange() {
      fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
    }
    if (typeof window !== "undefined") {
      window.addEventListener(CYCLE_LOGGING_CHANGED_EVENT, onCycleChange);
      window.addEventListener(USER_PROFILE_CHANGED_EVENT, onProfileChange);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(CYCLE_LOGGING_CHANGED_EVENT, onCycleChange);
        window.removeEventListener(USER_PROFILE_CHANGED_EVENT, onProfileChange);
      }
    };
  }, []);

  // Re-sync when the menu is opened so changes made in another tab/
  // device since first mount are reflected the next time the user
  // pops the menu.
  useEffect(() => {
    if (!open) return;
    fetchCycleLoggingEnabled().then(setCycleEnabled).catch(() => {});
    fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
  }, [open]);

  const cycleVisible = cycleSurfacesAvailable(sex) && cycleEnabled;
  const visibleItems = ITEM_DEFS.filter(
    (it) => it.key !== "log_cycle" || cycleVisible,
  );

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
          {visibleItems.map(it => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => go(it.href)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "10px 12px",
                background: "transparent", border: "none",
                color: TEXT, fontSize: 14.5, fontWeight: 500,
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
