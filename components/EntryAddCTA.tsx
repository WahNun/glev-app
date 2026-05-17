"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { hapticLight, hapticSelection } from "@/lib/haptics";
import {
  useQuickAddVisibleItems,
  QA_ICONS,
  decorateQuickAddHref,
} from "@/components/quickAddShared";

const ACCENT = "#4F6EF7";
const SHEET_BG = "var(--surface-alt)";
const TEXT = "var(--text-strong)";
const TEXT_DIM = "var(--text-muted)";
const BORDER = "var(--border)";

type Props = {
  /** Optional callback for the "manual meal entry" item — preserves the
   *  old "+ Mahlzeit" sheet trigger that used to live on the Entries
   *  page. When omitted, the manual-entry row is hidden. */
  onManualMeal?: () => void;
};

/**
 * Full-width "+ Eintrag" CTA on the Entries page that pops a menu
 * mirroring the header "+" dropdown (via `useQuickAddVisibleItems`).
 * Replaces the previous "+ Mahlzeit" button which only opened the
 * manual-entry sheet — manual entry is preserved as the first item
 * inside the popup so nothing is lost.
 */
export default function EntryAddCTA({ onManualMeal }: Props) {
  const t = useTranslations("quickAdd");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const visibleItems = useQuickAddVisibleItems(open);

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

  function handleManual() {
    hapticLight();
    setOpen(false);
    onManualMeal?.();
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative", marginBottom: 14 }}>
      <style>{`
        @keyframes glevEntryAddIn {
          from { transform: scale(0.98) translateY(-4px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
      `}</style>

      <button
        type="button"
        onClick={() => { hapticSelection(); setOpen(o => !o); }}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 12,
          border: `1px dashed ${ACCENT}55`,
          background: open ? `${ACCENT}1f` : `${ACCENT}10`,
          color: ACCENT,
          fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          transition: "all 0.15s",
        }}
      >
        <span
          style={{
            fontSize: 18, lineHeight: 1, marginTop: -1,
            display: "inline-block",
            transition: "transform 0.18s cubic-bezier(0.32, 0.72, 0, 1)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
          aria-hidden
        >+</span>
        {t("cta_add_entry")}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0,
            background: SHEET_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: 6,
            zIndex: 60,
            transformOrigin: "top center",
            animation: "glevEntryAddIn 0.18s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          {onManualMeal && (
            <button
              type="button"
              role="menuitem"
              onClick={handleManual}
              style={menuItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={iconWrap}>{QA_ICONS.meal}</span>
              <span>{t("add_meal_manual")}</span>
            </button>
          )}
          {visibleItems.map(it => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => go(decorateQuickAddHref(it.href))}
              style={menuItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={iconWrap}>{it.icon}</span>
              <span>{t(it.key)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  width: "100%", padding: "10px 12px",
  background: "transparent", border: "none",
  color: TEXT, fontSize: 14.5, fontWeight: 500,
  cursor: "pointer", textAlign: "left",
  borderRadius: 10,
  transition: "background 0.12s",
};

const iconWrap: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8,
  background: "var(--surface-soft)",
  color: TEXT_DIM,
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};
