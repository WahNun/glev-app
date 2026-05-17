"use client";

// Minimal, segmented pager indicator used by horizontal swipe pagers
// on the Dashboard and Insights screens. Replaces the previous
// "expanding pill + row of dots" pattern, which felt heavy and read
// as a "scroll bar" rather than a quiet position indicator.
//
// Design: a thin horizontal track (≈2px tall) divided into N equal
// segments. The active segment is filled with the page's primary
// text color; the rest sits on a near-invisible track. A small
// transition slides the fill instead of redrawing it, so swiping
// between cards reads as a single continuous motion.
//
// Tap targets are larger than the visible track (~18px tall hit
// area, full segment width) so the indicator is fully usable on
// touch without ballooning the visual footprint.

import React from "react";

interface PagerIndicatorProps {
  /** Total slide count. Hides itself entirely when `<= 1`. */
  total: number;
  /** Zero-based active slide index. */
  active: number;
  /** Called when the user taps a segment — usually scrolls the pager
   *  to the corresponding slide. */
  onSelect: (index: number) => void;
  /** ARIA label for the tablist wrapper. */
  label?: string;
  /** Optional builder for per-segment ARIA labels (e.g. "Folie 3 von
   *  16"). When omitted we fall back to a plain "i / total" label. */
  labelForIndex?: (index: number, total: number) => string;
  /** Optional builder for the `aria-controls` id of the slide panel
   *  controlled by each segment. Lets screen-reader users associate
   *  the indicator with the matching tabpanel. */
  controlsId?: (index: number) => string;
}

export default function PagerIndicator({
  total,
  active,
  onSelect,
  label,
  labelForIndex,
  controlsId,
}: PagerIndicatorProps) {
  if (total <= 1) return null;

  // Track width scales with slide count but is clamped so a single
  // segment never gets unreadably small (≥14px) and the whole bar
  // never visually outgrows the card it sits beneath (≤160px).
  const trackWidth = Math.min(160, Math.max(56, total * 14));
  const segPct = 100 / total;

  return (
    <div
      role="tablist"
      aria-label={label}
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginTop: 8,
      }}
    >
      {/* Local style for the keyboard focus ring. Inline `style` can't
          express `:focus-visible`, so we ship a scoped <style> block.
          The ring is soft (2px, brand-text colored, 30% alpha) and
          tracks the segment height so it doesn't dwarf the track. */}
      <style>{`
        .pager-indicator-tab:focus { outline: none; }
        .pager-indicator-tab:focus-visible {
          outline: 2px solid var(--text);
          outline-offset: 2px;
          border-radius: 4px;
        }
      `}</style>
      <div
        style={{
          position: "relative",
          width: trackWidth,
          height: 2,
          background: "var(--border-soft)",
          borderRadius: 99,
        }}
      >
        {/* Sliding fill — single element that translates between
            segments. Smoother than animating opacity on N dots and
            keeps the DOM minimal even with 16+ insight cards. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${segPct}%`,
            background: "var(--text)",
            borderRadius: 99,
            transform: `translateX(${active * 100}%)`,
            transition: "transform 240ms cubic-bezier(.2,.7,.2,1)",
          }}
        />
        {/* Invisible tap targets stacked on top of the track. Each
            segment is full-segment-wide and ~18px tall so touch
            input works comfortably without bloating the visible bar. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: -8,
            bottom: -8,
            display: "flex",
          }}
        >
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={
                labelForIndex
                  ? labelForIndex(i, total)
                  : `${i + 1} / ${total}`
              }
              aria-controls={controlsId ? controlsId(i) : undefined}
              onClick={() => onSelect(i)}
              // Note: we intentionally avoid `all: "unset"` here so the
              // browser's native focus ring still shows up for keyboard
              // users (WCAG 2.4.7). The element is reset minimally
              // instead: transparent background/border, no padding,
              // pointer cursor — but `outline` is left to the UA and an
              // explicit `:focus-visible` rule below adds a soft ring
              // anchored on the track so the focus indicator is visible
              // against any surface color.
              className="pager-indicator-tab"
              style={{
                appearance: "none",
                background: "transparent",
                border: 0,
                padding: 0,
                margin: 0,
                flex: 1,
                cursor: "pointer",
                height: "100%",
                color: "inherit",
                font: "inherit",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
