"use client";

// Snapping numeric slider with a large tap-to-edit read-out and a
// light haptic tick at each snap stop. Used across all log forms.
//
// The drag track uses a custom Pointer-Event implementation instead of
// a native <input type="range"> because WKWebView (iOS / Capacitor /
// TestFlight) intercepts touch events with its own scroll gesture
// recognizer even when `touchAction: "none"` is set, making the native
// range completely unusable with a finger.  setPointerCapture ensures
// drags are tracked even when the finger moves outside the track.
//
// Keyboard accessibility is preserved via an invisible <input
// type="range"> overlay that is reachable only by keyboard (opacity:0,
// position:absolute, no pointer-events).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { hapticLight } from "@/lib/haptics";

const BORDER = "var(--border)";

interface SnapSliderProps {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  /** Optional unit suffix shown next to the read-out ("IE", "mg/dL", "g"). */
  unit?: string;
  /** Theme accent for the active track + read-out (hex). */
  accent: string;
  /** Number of decimals shown — defaults to 0 unless step < 1. */
  decimals?: number;
  /** aria-label for the range input. */
  ariaLabel?: string;
}

export default function SnapSlider({
  value, onChange, min, max, step, unit, accent, decimals, ariaLabel,
}: SnapSliderProps) {
  const lastValueRef = useRef<number>(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");

  const dec = decimals ?? (step < 1 ? Math.min(2, String(step).split(".")[1]?.length ?? 1) : 0);
  const pct = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) * 100 : 0;

  // 400 ms ease-out count-up on the read-out for non-drag changes
  // (skipped when delta ≤ 1 step so drag remains instant).
  const [displayed, setDisplayed] = useState<number>(value);
  const fromRef = useRef<number>(value);
  const startTsRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const delta = Math.abs(target - displayed);
    if (delta <= step * 1.01) {
      setDisplayed(target);
      return;
    }
    fromRef.current = displayed;
    startTsRef.current = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTsRef.current) / 400);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = fromRef.current + (target - fromRef.current) * eased;
      setDisplayed(t >= 1 ? target : v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, step]);

  const display = Number.isFinite(displayed) ? displayed.toFixed(dec).replace(".", ",") : "—";

  function snap(n: number): number {
    if (!Number.isFinite(n)) return min;
    const clamped = Math.max(min, Math.min(max, n));
    const snapped = Math.round((clamped - min) / step) * step + min;
    return Number(snapped.toFixed(6));
  }

  function commit(next: number) {
    const snapped = snap(next);
    if (snapped !== lastValueRef.current) {
      hapticLight();
      lastValueRef.current = snapped;
    }
    onChange(snapped);
  }

  function commitDraft() {
    const parsed = Number((draft ?? "").replace(",", "."));
    if (Number.isFinite(parsed)) {
      // Tap-to-edit: keep the user's exact typed value (clamped + rounded
      // to the slider's decimals). Snapping the typed input to the step
      // grid would silently rewrite "127" → "130" for a step=10 slider,
      // which is exactly the surprise we want to avoid for fingerstick
      // entries. The drag track still snaps via commit().
      const clamped = Math.max(min, Math.min(max, parsed));
      const rounded = Number(clamped.toFixed(dec));
      if (rounded !== lastValueRef.current) {
        hapticLight();
        lastValueRef.current = rounded;
      }
      onChange(rounded);
    }
    setEditing(false);
    setDraft("");
  }

  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  // ── Custom drag implementation ────────────────────────────────────────
  // We use pointer events + setPointerCapture so the drag continues even
  // when the finger moves outside the track bounds. This is the only
  // approach that works reliably in both WKWebView (Capacitor/iOS) and
  // regular browsers, because WKWebView's scroll gesture recognizer
  // intercepts native <input type="range"> touch events.
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const valueFromPointer = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return min + ratio * (max - min);
  }, [value, min, max]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary pointer (left mouse button / first touch finger).
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    isDraggingRef.current = true;
    // Capture so pointermove/pointerup fire on this element even when the
    // finger leaves it — critical for fast swipes on iOS.
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    commit(valueFromPointer(e.clientX));
  }, [valueFromPointer]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    commit(valueFromPointer(e.clientX));
  }, [valueFromPointer]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    isDraggingRef.current = false;
    commit(valueFromPointer(e.clientX));
  }, [valueFromPointer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard handler on the drag div ─────────────────────────────────
  // Arrow keys adjust by one step so keyboard users don't rely solely on
  // the invisible <input type="range"> below (belt-and-suspenders).
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      commit(snap(value + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      commit(snap(value - step));
    }
  }, [value, step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      background: "var(--input-bg)",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
      }}>
        {editing ? (
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            value={draft}
            onChange={e => {
              const v = e.target.value;
              setDraft(v);
              // Live-commit on every keystroke so the parent's state is
              // always in sync with what the user sees. Fixes an iOS
              // WKWebView race where tapping Save fires before the
              // input's onBlur → commitDraft path runs, causing the
              // PATCH to send the stale (unedited) value. User-report
              // 2026-05-18 ("Dauer ändern klappt manchmal nicht").
              const parsed = Number((v ?? "").replace(",", "."));
              if (Number.isFinite(parsed)) {
                const clamped = Math.max(min, Math.min(max, parsed));
                const rounded = Number(clamped.toFixed(dec));
                if (rounded !== lastValueRef.current) {
                  lastValueRef.current = rounded;
                  onChange(rounded);
                }
              }
            }}
            onBlur={commitDraft}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
              if (e.key === "Escape") { setEditing(false); setDraft(""); }
            }}
            style={{
              flex: 1, minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: accent,
              fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em",
              fontFamily: "var(--font-mono)",
              padding: 0,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(String(value)); setEditing(true); }}
            style={{
              background: "transparent", border: "none", padding: 0, cursor: "text",
              color: accent, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em",
              fontFamily: "var(--font-mono)", lineHeight: 1,
            }}
            aria-label={ariaLabel ?? "Edit value"}
          >
            {display}
          </button>
        )}
        {unit && (
          <span style={{
            fontSize: 13, fontWeight: 700, color: "var(--text-muted)",
            letterSpacing: "0.02em", textTransform: "uppercase",
          }}>{unit}</span>
        )}
      </div>

      {/* 36 px tall touch target — custom pointer-event drag area.
          overflow:visible keeps the thumb visually outside the track
          bounds when at min/max without clipping. */}
      <div style={{ position: "relative", height: 36 }}>
        {/* Track background — non-interactive, purely decorative */}
        <div style={{
          position: "absolute", left: 0, right: 0, top: "50%",
          height: 6, transform: "translateY(-50%)",
          borderRadius: 999, background: "var(--surface-soft)",
          pointerEvents: "none",
        }} />
        {/* Filled (active) portion of the track */}
        <div style={{
          position: "absolute", left: 0, top: "50%",
          width: `${pct}%`, height: 6, transform: "translateY(-50%)",
          borderRadius: 999, background: accent, opacity: 0.85,
          transition: "width 60ms linear",
          pointerEvents: "none",
        }} />
        {/* Thumb — positioned at the current value percentage */}
        <div style={{
          position: "absolute",
          left: `${pct}%`,
          top: "50%",
          width: 22,
          height: 22,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: accent,
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          pointerEvents: "none",
          transition: "left 60ms linear",
        }} />
        {/* Drag surface — covers the full 36px hit area.
            touch-action:none tells the browser (and WKWebView) NOT to
            claim this area for scroll, handing all pointer events to us.
            tabIndex allows keyboard focus; arrow keys are handled via
            onKeyDown.  role="slider" exposes the semantics to a11y
            tools without needing the native range element to be
            interactive. */}
        <div
          ref={trackRef}
          role="slider"
          aria-label={ariaLabel ?? "Value slider"}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          style={{
            position: "absolute", left: 0, right: 0, top: 0,
            width: "100%", height: 36,
            background: "transparent",
            cursor: "pointer",
            touchAction: "none",
            // Prevent iOS callout / text selection during drag
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        />
        {/* Invisible <input type="range"> for extra keyboard compat —
            reachable only via Tab (no pointer-events, opacity:0).
            This is belt-and-suspenders: the div above already handles
            Arrow keys, but some AT tools specifically look for a native
            range role. */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => commit(Number(e.target.value))}
          aria-hidden
          tabIndex={-1}
          style={{
            position: "absolute", left: 0, top: 0,
            width: "100%", height: "100%",
            opacity: 0,
            pointerEvents: "none",
            margin: 0,
          }}
        />
      </div>
    </div>
  );
}
