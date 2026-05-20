"use client";

// Snapping numeric slider with a large tap-to-edit read-out and a
// light haptic tick at each snap stop. Used across all log forms.

import React, { useEffect, useRef, useState } from "react";
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

      {/* 36 px tall so the iOS touch target is large enough.
          The native thumb can extend beyond the custom track; keeping
          overflow visible prevents iOS WKWebView from clipping it. */}
      <div style={{ position: "relative", height: 36 }}>
        {/* Track background + filled track — vertically centred */}
        <div style={{
          position: "absolute", left: 0, right: 0, top: "50%",
          height: 6, transform: "translateY(-50%)",
          borderRadius: 999, background: "var(--surface-soft)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", left: 0, top: "50%",
          width: `${pct}%`, height: 6, transform: "translateY(-50%)",
          borderRadius: 999, background: accent, opacity: 0.85,
          transition: "width 60ms linear",
          pointerEvents: "none",
        }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => commit(Number(e.target.value))}
          aria-label={ariaLabel ?? "Value slider"}
          style={{
            position: "absolute", left: 0, right: 0, top: 0,
            width: "100%", height: 36, margin: 0,
            background: "transparent",
            accentColor: accent,
            cursor: "pointer",
            touchAction: "none",
          }}
        />
      </div>
    </div>
  );
}
