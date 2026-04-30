"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Footer node rendered sticky at the bottom of the sheet (e.g. Save / Close button row). */
  footer?: React.ReactNode;
  /** Sheet body. Scrollable area between header and footer. */
  children: React.ReactNode;
  /** Optional max-width override for desktop. Default 520. */
  maxWidth?: number;
}

/**
 * iOS-style bottom sheet. Slides up from the bottom on mobile; centered card
 * on desktop (≥768px). Closes on backdrop tap, ESC, or when the user drags
 * the handle/header down past ~120px. Body scroll is locked while open.
 *
 * Pattern intentionally avoids React.createPortal — the existing About modal
 * does the same and renders fine as a top-level sibling because zIndex 999
 * sits above every layout shell.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  footer,
  children,
  maxWidth = 520,
}: BottomSheetProps) {
  // dragOffset: how many px the user has pulled the sheet down from its
  // resting position. We translate the sheet by this amount during the
  // gesture so it feels physical, then either snap back (offset reset to 0)
  // or commit a close (onClose) on release depending on the threshold.
  const [dragOffset, setDragOffset] = useState(0);
  const startYRef = useRef<number | null>(null);

  // ESC closes — same affordance as the About modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock so the page underneath doesn't scroll while the sheet
  // is up. Restore the prior overflow value (not just "") so we don't clobber
  // a parent that had its own override.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset any in-flight drag whenever the sheet re-opens, otherwise a
  // previously-half-dragged sheet would mount mid-translate.
  useEffect(() => {
    if (open) setDragOffset(0);
  }, [open]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    // Only allow downward drag — upward drag is a no-op (sheet is already
    // at its top resting position).
    if (dy > 0) setDragOffset(dy);
  }, []);
  const onTouchEnd = useCallback(() => {
    startYRef.current = null;
    if (dragOffset > 120) {
      onClose();
    } else {
      setDragOffset(0);
    }
  }, [dragOffset, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--overlay)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes glevSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (min-width: 768px) {
          .glev-bottom-sheet { align-self: center !important; border-radius: 20px !important; max-height: 80vh !important; }
        }
      `}</style>
      <div
        className="glev-bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth,
          background: SURFACE,
          borderTop: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderRadius: "20px 20px 0 0",
          // Animate from off-screen on first paint; once mounted, the
          // dragOffset transform takes over for the close gesture.
          animation: dragOffset === 0 ? "glevSheetUp 0.28s cubic-bezier(0.32,0.72,0,1)" : undefined,
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset === 0 ? "transform 0.18s ease-out" : undefined,
          maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drag-handle + (optional) title bar. The handle is the touch
            target for the drag-to-close gesture; the header strip below
            it shares the same touch handlers so users can grab anywhere
            in the top region. */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            padding: "10px 18px 6px",
            cursor: "grab",
            flexShrink: 0,
            background: SURFACE,
          }}
        >
          <div style={{
            width: 38, height: 4, borderRadius: 99,
            background: "var(--border-strong)",
            margin: "0 auto 12px",
          }} />
          {title && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, paddingBottom: 4,
            }}>
              <h2 style={{
                fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em",
                color: "var(--text-strong)", margin: 0,
              }}>{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: 28, height: 28, borderRadius: 99,
                  background: "var(--surface-soft)",
                  border: `1px solid ${BORDER}`,
                  color: "var(--text-dim)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18"/>
                  <line x1="18" y1="6" x2="6" y2="18"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Scrollable body. Padding-bottom honours the iOS home-indicator
            safe-area when there is no footer — when there IS a footer, the
            footer itself adds the safe-area padding instead. */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: footer ? "8px 20px 20px" : "8px 20px calc(env(safe-area-inset-bottom) + 24px)",
          WebkitOverflowScrolling: "touch",
        }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: "12px 20px calc(env(safe-area-inset-bottom) + 14px)",
            borderTop: `1px solid ${BORDER}`,
            background: SURFACE,
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
