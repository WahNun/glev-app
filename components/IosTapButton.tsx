"use client";

/**
 * iOS-WKWebView-safe button.
 *
 * Background: on iOS WKWebView, the synthesised `click` event that
 * follows pointerdown → pointerup is unreliable when the click
 * handler synchronously re-renders or unmounts the button's DOM
 * subtree (e.g. `setEditing(true)` swaps the row body, `onClose()`
 * unmounts the sheet, `setOpen(false)` removes the dropdown). After
 * the re-render WebKit's hit-test resolves the click on a STALE node
 * or RETARGETS it to a parent element — which on collapsible rows
 * means the row collapses instead of opening the editor, and on
 * modal close buttons means a "ghost click" lands on whatever's now
 * underneath the dismissed sheet.
 *
 * Fix: fire the user's action on `pointerup` (which precedes the
 * click in the event sequence). Stop propagation + preventDefault so
 * no ancestor handler reacts to the same gesture and no trailing
 * synthetic click sneaks through. Keep `onClick` as a keyboard
 * (Enter / Space) fallback, gated by a dedupe ref so touch / mouse
 * taps don't double-fire.
 *
 * Reference implementations: `MobileTab` in `components/Layout.tsx`
 * (footer nav), Round 7 of the 2026-05-17/18 tap-reliability work.
 *
 * Usage:
 *   <IosTapButton onAct={() => setEditing(true)} ariaLabel="Edit">
 *     <PencilIcon /> Edit
 *   </IosTapButton>
 *
 * For buttons in scrollable containers the 10 px movement slop
 * disambiguates a tap from the start of a scroll gesture — moving
 * the finger more than 10 px between pointerdown and pointerup
 * cancels the action.
 */

import React, { useRef } from "react";

export interface IosTapButtonProps {
  /** The actual handler. Fired exactly once per tap on `pointerup`. */
  onAct: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaHasPopup?: React.ButtonHTMLAttributes<HTMLButtonElement>["aria-haspopup"];
  ariaExpanded?: boolean;
  ariaSelected?: boolean;
  ariaCurrent?: React.ButtonHTMLAttributes<HTMLButtonElement>["aria-current"];
  role?: string;
  /**
   * Optional `data-*` attributes (e.g. `data-glev-fab="true"`). Kept as
   * a plain record so the call site can pass through any data attr
   * without us having to enumerate them.
   */
  dataAttrs?: Record<string, string>;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}

const TAP_SLOP_PX = 10;

export default function IosTapButton({
  onAct,
  disabled = false,
  ariaLabel,
  ariaHasPopup,
  ariaExpanded,
  ariaSelected,
  ariaCurrent,
  role,
  dataAttrs,
  style,
  className,
  children,
}: IosTapButtonProps) {
  const pointerHandledRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <button
      type="button"
      role={role}
      aria-label={ariaLabel}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-selected={ariaSelected}
      aria-current={ariaCurrent}
      disabled={disabled}
      className={className}
      {...(dataAttrs ?? {})}
      onPointerDown={(e) => {
        // Mouse: only react to primary button (0). Touch / pen always
        // report button = 0, so this also covers iOS taps.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        pointerHandledRef.current = false;
        startRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const start = startRef.current;
        startRef.current = null;
        if (start) {
          const dx = Math.abs(e.clientX - start.x);
          const dy = Math.abs(e.clientY - start.y);
          if (dx > TAP_SLOP_PX || dy > TAP_SLOP_PX) {
            // Treat as scroll/drag, not tap — don't fire the action.
            // Still flip the dedupe flag so any trailing synthetic
            // click (rare on touch but possible with mouse drag) is
            // swallowed by onClick below instead of running onAct.
            pointerHandledRef.current = true;
            return;
          }
        }
        e.stopPropagation();
        // Suppress any trailing synthetic click that WKWebView might
        // still dispatch — onClick still runs for keyboard via the
        // pointerHandledRef gate below.
        e.preventDefault();
        pointerHandledRef.current = true;
        onAct();
      }}
      onPointerCancel={() => {
        startRef.current = null;
        // Gesture aborted (scroll started, finger left window). Clear
        // the dedupe so a subsequent keyboard activation isn't
        // swallowed by stale state.
        pointerHandledRef.current = false;
      }}
      onPointerLeave={() => { startRef.current = null; }}
      onClick={(e) => {
        // Touch / mouse already handled this gesture on pointerup;
        // swallow the synthetic click so the action doesn't run twice.
        if (pointerHandledRef.current) {
          pointerHandledRef.current = false;
          return;
        }
        if (disabled) return;
        // Keyboard activation (Enter / Space) reaches here directly.
        e.stopPropagation();
        onAct();
      }}
      style={{
        ...style,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
