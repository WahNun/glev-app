"use client";

// Disclosure wrapper for rarely-used inputs (e.g. "+ Notiz") with a
// soft height + opacity transition. Auto-opens when `hasValue` flips
// to true so a populated draft is never hidden.

import React, { useState, useEffect, useId, useRef } from "react";
import { hapticLight } from "@/lib/haptics";

interface CollapsibleFieldProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  hasValue?: boolean;
  accent?: string;
}

export default function CollapsibleField({
  label, children, defaultOpen, hasValue, accent,
}: CollapsibleFieldProps) {
  const [open, setOpen] = useState<boolean>(!!defaultOpen || !!hasValue);
  const panelId = useId();
  const innerRef = useRef<HTMLDivElement>(null);
  const [innerH, setInnerH] = useState<number>(0);

  useEffect(() => {
    if (hasValue && !open) setOpen(true);
  }, [hasValue, open]);

  // Track inner content height so the wrapper can animate
  // max-height: 0 → contentHeight (and back) without snapping.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setInnerH(el.scrollHeight);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [children, open]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          hapticLight();
          setOpen(o => !o);
        }}
        style={{
          background: "transparent",
          border: "none",
          padding: "4px 0",
          color: accent ?? "var(--text-muted)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{
          display: "inline-block",
          width: 14, textAlign: "center",
          transform: open ? "rotate(45deg)" : "none",
          transition: "transform 0.15s",
        }}>+</span>
        {label}
      </button>
      <div
        id={panelId}
        aria-hidden={!open}
        style={{
          overflow: "hidden",
          maxHeight: open ? innerH : 0,
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(-4px)",
          transition: "max-height 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, transform 180ms ease",
        }}
      >
        <div ref={innerRef} style={{ paddingTop: 8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
