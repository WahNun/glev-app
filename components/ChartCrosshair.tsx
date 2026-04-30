"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type CrosshairPoint = {
  x: number;
  y: number;
  color: string;
  tooltip: string[];
};

const SURFACE = "var(--surface)";

export function useCrosshair(points: CrosshairPoint[]) {
  const [active, setActive] = useState<CrosshairPoint | null>(null);
  const lastSnappedX = useRef<number | null>(null);

  const findNearest = useCallback(
    (px: number): CrosshairPoint | null => {
      if (points.length === 0) return null;
      let best = points[0];
      let bestDist = Math.abs(points[0].x - px);
      for (let i = 1; i < points.length; i++) {
        const d = Math.abs(points[i].x - px);
        if (d < bestDist) {
          bestDist = d;
          best = points[i];
        }
      }
      return best;
    },
    [points]
  );

  const update = useCallback(
    (clientX: number, target: HTMLElement, isTouch: boolean) => {
      const rect = target.getBoundingClientRect();
      const px = clientX - rect.left;
      const next = findNearest(px);
      if (!next) return;
      if (lastSnappedX.current !== next.x) {
        lastSnappedX.current = next.x;
        if (isTouch && typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(4);
          } catch {
            /* ignore */
          }
        }
      }
      setActive((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
    },
    [findNearest]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      update(e.clientX, e.currentTarget, e.pointerType === "touch");
    },
    [update]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Mouse: track on hover (no buttons required). Touch/pen: track always.
      update(e.clientX, e.currentTarget, e.pointerType === "touch");
    },
    [update]
  );

  const clear = useCallback(() => {
    lastSnappedX.current = null;
    setActive(null);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // Touch users want the crosshair to disappear on release;
      // mouse users get it on hover so we leave it shown until pointerleave.
      if (e.pointerType === "touch") clear();
    },
    [clear]
  );

  const onPointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") clear();
    },
    [clear]
  );

  const handlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerLeave]
  );

  return { active, handlers, clear };
}

/**
 * SVG-space overlay: dashed crosshair lines + highlighted point.
 * Drop this inside the same <svg> as the chart, after all other content
 * so it draws on top.
 */
export function CrosshairOverlay({
  active,
  top,
  bottom,
  left,
  right,
}: {
  active: CrosshairPoint | null;
  top: number;
  bottom: number;
  left: number;
  right: number;
}) {
  if (!active) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      <line
        x1={active.x}
        y1={top}
        x2={active.x}
        y2={bottom}
        stroke={active.color}
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <line
        x1={left}
        y1={active.y}
        x2={right}
        y2={active.y}
        stroke={active.color}
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx={active.x} cy={active.y} r="9" fill={active.color} fillOpacity="0.15" />
      <circle cx={active.x} cy={active.y} r="4.5" fill={active.color} stroke={SURFACE} strokeWidth="1.5" />
    </g>
  );
}

/**
 * HTML-space tooltip: positioned absolutely inside the chart container.
 * The chart container should be position:relative.
 */
export function CrosshairTooltip({
  active,
  containerWidth,
  containerHeight,
}: {
  active: CrosshairPoint | null;
  containerWidth: number;
  containerHeight: number;
}) {
  if (!active) return null;
  const TIP_W = 96;
  const TIP_H = 46;
  const offset = 12;

  let left = active.x + offset;
  if (left + TIP_W > containerWidth) left = active.x - TIP_W - offset;
  if (left < 0) left = Math.max(0, Math.min(containerWidth - TIP_W, active.x - TIP_W / 2));

  let top = active.y - TIP_H - offset;
  if (top < 0) top = active.y + offset;
  if (top + TIP_H > containerHeight) top = Math.max(0, containerHeight - TIP_H);

  const style: CSSProperties = {
    position: "absolute",
    left,
    top,
    minWidth: TIP_W,
    padding: "6px 10px",
    background: "var(--surface)",
    border: `1px solid ${active.color}55`,
    borderRadius: 8,
    pointerEvents: "none",
    boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
    whiteSpace: "nowrap",
    zIndex: 5,
    transition: "left 80ms linear, top 80ms linear",
  };

  return (
    <div style={style}>
      {active.tooltip.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: i === 0 ? 10 : 13,
            fontWeight: i === 0 ? 500 : 800,
            color: i === 0 ? "var(--text-dim)" : active.color,
            letterSpacing: i === 0 ? "0.04em" : "-0.01em",
            lineHeight: 1.15,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
