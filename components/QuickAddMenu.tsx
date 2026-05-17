"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { hapticLight, hapticSelection } from "@/lib/haptics";
import { useQuickAddVisibleItems, decorateQuickAddHref } from "@/components/quickAddShared";

const ACCENT = "#4F6EF7";
const SHEET_BG = "var(--surface-alt)";
const TEXT = "var(--text-strong)";
const TEXT_DIM = "var(--text-muted)";
const BORDER = "var(--border)";

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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The dashboard now ships its own large "+ Neuer Eintrag" CTA
  // glued to the bottom of the glucose cluster (see
  // app/(protected)/dashboard/page.tsx → DashboardQuickAddCTA), so
  // the duplicate "+" in the global header is intentionally hidden
  // on that route only. Every other page keeps the header menu
  // since it's still the only quick-log entry point there.
  // Pathname can be prefixed with a locale segment ("/de/dashboard"),
  // so we match by suffix instead of exact equality. The early-return
  // happens *after* every hook is called so we don't violate the
  // rules of hooks when the route changes.
  const onDashboard = !!pathname && /(^|\/)dashboard\/?$/.test(pathname);

  // Items + cycle gating live in a shared module so the Entries-page
  // "+ Eintrag" CTA mirrors this menu automatically.
  const visibleItems = useQuickAddVisibleItems(open);

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

  // Suppress render on /dashboard — all hooks above ran first, so the
  // rules of hooks stay intact across route changes.
  if (onDashboard) return null;

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
              onClick={() => go(decorateQuickAddHref(it.href))}
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
