"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { hapticLight, hapticSelection, hapticSuccess } from "@/lib/haptics";

/* ──────────────────────────────────────────────────────────────────
   Math helpers — exported for unit tests (tests/unit/mealNodeMath.test.ts)
   so the X↔time conversion and clamping rules are pinned independently
   of the React component / DOM layer.
   ──────────────────────────────────────────────────────────────── */

export const PRE_MIN_OFFSET_MIN = -60;
export const PRE_MAX_OFFSET_MIN = -1;
export const POST_MIN_OFFSET_MIN = 1;
export const POST_MAX_OFFSET_MIN = 180;
export const DEFAULT_PRE_OFFSET_MIN = -15;
export const DEFAULT_POST_OFFSET_MIN = 90;
/** Y-stagger applied to clusters whose centerX is within
 *  CLUSTER_OVERLAP_PX of an earlier cluster (see RollingChart). */
export const CLUSTER_STAGGER_Y_PX = 14;
export const CLUSTER_OVERLAP_PX = 60;

export type CheckKind = "pre" | "post";

/** Returns the kind based on `check_type` string. */
export function kindOf(checkType: string): CheckKind {
  return checkType === "pre" ? "pre" : "post";
}

/** Clamp an offset (in minutes) to the allowed band for its kind. */
export function clampOffsetMin(kind: CheckKind, minutes: number): number {
  const rounded = Math.round(minutes);
  if (kind === "pre") {
    return Math.max(PRE_MIN_OFFSET_MIN, Math.min(PRE_MAX_OFFSET_MIN, rounded));
  }
  return Math.max(POST_MIN_OFFSET_MIN, Math.min(POST_MAX_OFFSET_MIN, rounded));
}

/** Convert a delta in pixels to a delta in minutes given the chart's
 *  ms-per-pixel scale (positive px → positive minutes). */
export function pxDeltaToOffsetMin(deltaPx: number, msPerPx: number): number {
  const deltaMs = deltaPx * msPerPx;
  return Math.round(deltaMs / 60_000);
}

/**
 * Pick the `check_type` for a freshly added post-arm. Highest existing
 * `post_n` + 1; starts at `post_1` if none exist. Defensive against
 * non-numeric suffixes (treated as 0).
 */
export function nextPostCheckType(existing: Record<string, unknown>): `post_${number}` {
  let max = 0;
  for (const key of Object.keys(existing)) {
    if (!key.startsWith("post_")) continue;
    const n = parseInt(key.slice("post_".length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `post_${max + 1}`;
}

/** Default offset (minutes) for a freshly added post-arm. Highest
 *  existing post offset + 60, clamped to POST_MAX_OFFSET_MIN. Falls
 *  back to DEFAULT_POST_OFFSET_MIN if no posts exist. */
export function defaultOffsetForNewPost(
  posts: Array<{ offsetMin: number }>,
): number {
  if (posts.length === 0) return DEFAULT_POST_OFFSET_MIN;
  const lastMax = posts.reduce((a, p) => (p.offsetMin > a ? p.offsetMin : a), 0);
  return Math.min(POST_MAX_OFFSET_MIN, lastMax + 60);
}

/* ──────────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────────── */

const ACCENT = "#4F6EF7";
const LINE_COLOR = "rgba(79,110,247,0.4)";
const CENTER_R = 12;   // 24px diameter
const KNOB_R = 6;      // 12px diameter
const PLUS_R = 8;      // 16px diameter
const PLUS_DY = 22;    // vertical offset of "+" below center

/** Color for a glucose badge — 5-zone clinical model:
 *  < 70 mg/dL   → red   (#EF4444) — hypoglycemia
 *  70–80 mg/dL  → amber (#F59E0B) — borderline low
 *  80–160 mg/dL → green (#22C55E) — ideal post-meal range
 *  160–180 mg/dL → amber (#F59E0B) — borderline high
 *  > 180 mg/dL  → red   (#EF4444) — hyperglycemia
 *
 * Both hypo and hyper use red so users immediately recognise values
 * outside the safe range; amber marks the borderline edges.
 *
 * Exported for unit tests (`tests/unit/mealNodeMath.test.ts`). */
export function bgCheckColor(mgdl: number): string {
  if (mgdl < 70)  return "#EF4444"; // hypo
  if (mgdl <= 80) return "#F59E0B"; // borderline low
  if (mgdl <= 160) return "#22C55E"; // ideal
  if (mgdl <= 180) return "#F59E0B"; // borderline high
  return "#EF4444"; // hyper
}

export interface ArmState {
  /** stable key (matches check_type, e.g. "pre", "post_1") */
  checkType: string;
  /** offset from meal_time, in minutes (signed) */
  offsetMin: number;
  /** persisted: this arm reflects a row in meal_timeline_checks; false
   *  means it's a client-side stub (e.g. just-added post arm or default
   *  pre/post). Rendered with a dashed outline. */
  persisted: boolean;
  /** existing row id if persisted (used by upsertCheck for the
   *  select-then-update path — informational only at the UI level). */
  rowId?: string;
  /** Glucose value recorded at this check (mg/dL), or null if not yet
   *  filled. Set automatically by fillNearbyChecks when a fingerstick or
   *  CGM reading falls within ±15 min of the planned check. Visualization
   *  only — no write paths in this component. */
  bgAtCheck: number | null;
  /** ISO timestamp of when bg_at_check was recorded (mirrors
   *  confirmed_at from meal_timeline_checks). Used by the tap-to-reveal
   *  tooltip to show the measurement time. Null when not filled. */
  confirmedAt: string | null;
  /** Data source that produced bg_at_check. Optional — not yet stored in
   *  the DB; callers that know the source may pass it here. */
  bgSource?: "cgm" | "fingerstick" | null;
}

export interface MealNodeClusterProps {
  mealId: string;
  /** Wall-clock timestamp of the meal (anchor) in ms. */
  mealAtMs: number;
  /** Pixel coordinate of the center node along the chart's X axis. */
  centerX: number;
  /** Pixel coordinate of the center node along the chart's Y axis. */
  centerY: number;
  /** ms per pixel of the chart's X axis (positive). */
  msPerPx: number;
  /** Horizontal clip bounds in pixels (chart's drawable area). */
  leftBoundPx: number;
  rightBoundPx: number;
  /** Initial arm state, derived from `meal_timeline_checks` rows. */
  initialArms: ArmState[];
  /** Persistence callback. Caller awaits the upsert; the component
   *  flips the arm to `persisted: true` on resolve. */
  onConfirm: (
    checkType: string,
    plannedAtMs: number,
    prev: ArmState,
  ) => Promise<{ rowId?: string } | void>;
}

interface DragState {
  checkType: string;
  startPointerX: number;
  startOffsetMin: number;
  currentOffsetMin: number;
}

interface ConfirmState {
  arm: ArmState;
  newOffsetMin: number;
}

interface TooltipState {
  arm: ArmState;
  /** Knob pixel position on the chart's X axis (used to anchor the sheet). */
  knobX: number;
}

export default function MealNodeCluster(props: MealNodeClusterProps) {
  const t = useTranslations("meal_timeline");
  const [arms, setArms] = useState<ArmState[]>(props.initialArms);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [saving, setSaving] = useState(false);
  // Track the SVG element so pointer coords from setPointerCapture
  // come from the same coordinate system as `centerX`.
  const groupRef = useRef<SVGGElement>(null);

  // Re-sync if parent reloads checks (e.g. after the page hydrates and
  // listChecksForMeals resolves). Only when the meal id changes or the
  // initial set actually changes — never while a drag is in flight.
  useEffect(() => {
    if (drag) return;
    setArms(props.initialArms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mealId, props.initialArms.length]);

  const msPerPx = props.msPerPx;
  const cx = props.centerX;
  const cy = props.centerY;

  function armOffsetForRender(a: ArmState): number {
    if (drag && drag.checkType === a.checkType) return drag.currentOffsetMin;
    return a.offsetMin;
  }

  function knobX(offsetMin: number): number {
    const px = cx + (offsetMin * 60_000) / msPerPx;
    return Math.max(props.leftBoundPx, Math.min(props.rightBoundPx, px));
  }

  function handlePointerDown(e: React.PointerEvent<SVGElement>, arm: ArmState) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({
      checkType: arm.checkType,
      startPointerX: e.clientX,
      startOffsetMin: arm.offsetMin,
      currentOffsetMin: arm.offsetMin,
    });
    hapticSelection();
  }

  function handlePointerMove(e: React.PointerEvent<SVGElement>) {
    if (!drag) return;
    e.stopPropagation();
    const deltaPx = e.clientX - drag.startPointerX;
    const deltaMin = pxDeltaToOffsetMin(deltaPx, msPerPx);
    const raw = drag.startOffsetMin + deltaMin;
    const next = clampOffsetMin(kindOf(drag.checkType), raw);
    if (next !== drag.currentOffsetMin) {
      setDrag({ ...drag, currentOffsetMin: next });
    }
  }

  function handlePointerUp(e: React.PointerEvent<SVGElement>, arm: ArmState) {
    if (!drag) return;
    e.stopPropagation();
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const finalOffset = drag.currentOffsetMin;
    setDrag(null);
    if (finalOffset === arm.offsetMin) {
      // Short tap (no drag delta). If the knob has a filled bg value,
      // open the context tooltip instead of doing nothing.
      if (arm.bgAtCheck !== null && arm.bgAtCheck !== undefined) {
        hapticLight();
        setTooltip({ arm, knobX: knobX(arm.offsetMin) });
      }
      return;
    }
    hapticLight();
    setConfirm({ arm, newOffsetMin: finalOffset });
  }

  async function onConfirmAccept() {
    if (!confirm) return;
    setSaving(true);
    try {
      const plannedAtMs = props.mealAtMs + confirm.newOffsetMin * 60_000;
      const res = await props.onConfirm(confirm.arm.checkType, plannedAtMs, confirm.arm);
      setArms((cur) => cur.map((a) =>
        a.checkType === confirm.arm.checkType
          ? { ...a, offsetMin: confirm.newOffsetMin, persisted: true, rowId: res?.rowId ?? a.rowId }
          : a,
      ));
      hapticSuccess();
    } catch {
      // On failure, just close the dialog and let the arm spring back
      // to its prior offsetMin (state never advanced). A toast layer
      // is intentionally out of scope for this iteration — the
      // dashed-outline state already communicates "not saved".
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  function onConfirmCancel() {
    setConfirm(null);
  }

  function onAddPost() {
    const posts = arms.filter((a) => a.checkType.startsWith("post_"));
    const existingMap: Record<string, true> = {};
    for (const a of arms) existingMap[a.checkType] = true;
    const newType = nextPostCheckType(existingMap);
    const newOffset = defaultOffsetForNewPost(posts.map((p) => ({ offsetMin: p.offsetMin })));
    setArms((cur) => [...cur, { checkType: newType, offsetMin: newOffset, persisted: false, bgAtCheck: null, confirmedAt: null }]);
    hapticSelection();
  }

  return (
    <>
      <g ref={groupRef} data-testid={`meal-node-cluster-${props.mealId}`}>
        {/* Connection lines — drawn first so they sit under the knobs. */}
        {arms.map((a) => {
          const off = armOffsetForRender(a);
          const x2 = knobX(off);
          return (
            <line
              key={`line-${a.checkType}`}
              x1={cx} y1={cy} x2={x2} y2={cy}
              stroke={LINE_COLOR} strokeWidth="1.5"
            />
          );
        })}
        {/* "+"-to-center connector */}
        <line x1={cx} y1={cy} x2={cx} y2={cy + PLUS_DY} stroke={LINE_COLOR} strokeWidth="1.5" />

        {/* Center node — visual anchor only, no interaction in this iteration. */}
        <circle
          cx={cx} cy={cy} r={CENTER_R}
          fill={ACCENT}
          stroke="white" strokeWidth="2"
          style={{ pointerEvents: "none" }}
        />

        {/* Arm knobs */}
        {arms.map((a) => {
          const off = armOffsetForRender(a);
          const x = knobX(off);
          const isDragging = drag?.checkType === a.checkType;
          const labelMin = Math.abs(off);
          const isPre = kindOf(a.checkType) === "pre";
          const label = isPre
            ? t("offset_minutes_before", { n: labelMin })
            : t("offset_minutes_after", { n: labelMin });
          const hasBg = a.bgAtCheck !== null && a.bgAtCheck !== undefined;
          const bgColor = hasBg ? bgCheckColor(a.bgAtCheck!) : null;
          // Title tooltip: include bg value when available
          const titleText = hasBg
            ? `${label} · ${a.bgAtCheck} mg/dL`
            : label;
          return (
            <g key={`knob-${a.checkType}`}>
              {/* bg_at_check value badge — always visible when filled */}
              {hasBg && !isDragging && (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={x - 28} y={cy - KNOB_R - 20}
                    width={56} height={14} rx={4}
                    fill={bgColor!} opacity={0.92}
                  />
                  <text
                    x={x} y={cy - KNOB_R - 10}
                    fontSize={8} fontWeight={700}
                    textAnchor="middle" fill="white"
                  >
                    {a.bgAtCheck} mg/dL
                  </text>
                  <title>{t("bg_at_check_badge_title", { value: a.bgAtCheck! })}</title>
                </g>
              )}
              <circle
                cx={x} cy={cy} r={KNOB_R}
                fill={a.persisted ? ACCENT : "transparent"}
                stroke={ACCENT}
                strokeWidth={a.persisted ? 1.5 : 2}
                strokeDasharray={a.persisted ? undefined : "3 2"}
                style={{
                  cursor: "ew-resize",
                  pointerEvents: "auto",
                  touchAction: "none",
                  // Smooth transition when positions recalculate after rotation
                  // or window resize. Disabled while dragging so the knob
                  // tracks the finger without lag.
                  transition: isDragging ? "none" : "cx 0.2s ease",
                }}
                onPointerDown={(e) => handlePointerDown(e, a)}
                onPointerMove={handlePointerMove}
                onPointerUp={(e) => handlePointerUp(e, a)}
                onPointerCancel={(e) => handlePointerUp(e, a)}
                data-testid={`meal-node-arm-${props.mealId}-${a.checkType}`}
                data-persisted={a.persisted ? "true" : "false"}
                data-offset-min={off}
                data-bg-at-check={a.bgAtCheck ?? undefined}
              >
                <title>{titleText}</title>
              </circle>
              {/* Sensor indicator dot — shown when bg_at_check was auto-filled.
                  Positioned at the top-right corner of the knob to signal
                  "this value came from a sensor/fingerstick reading". */}
              {hasBg && (
                <g style={{ pointerEvents: "none" }}>
                  <circle
                    cx={x + KNOB_R - 1} cy={cy - KNOB_R + 1}
                    r={4}
                    fill={bgColor!}
                    stroke="white" strokeWidth={1.2}
                  />
                  <circle
                    cx={x + KNOB_R - 1} cy={cy - KNOB_R + 1}
                    r={1.4}
                    fill="white"
                  />
                  <title>{t("bg_sensor_auto_fill_title")}</title>
                </g>
              )}
              {isDragging && (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={x - 22} y={cy - 26}
                    width={44} height={16} rx={4}
                    fill={ACCENT} opacity={0.95}
                  />
                  <text
                    x={x} y={cy - 14}
                    fontSize={10} fontWeight={700}
                    textAnchor="middle" fill="white"
                  >
                    {label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* "+" button to add a new post-arm */}
        <g
          transform={`translate(${cx}, ${cy + PLUS_DY})`}
          style={{ cursor: "pointer", pointerEvents: "auto" }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onAddPost(); }}
          data-testid={`meal-node-add-post-${props.mealId}`}
        >
          <circle r={PLUS_R} fill={ACCENT} stroke="white" strokeWidth={1.5} />
          <line x1={-4} y1={0} x2={4} y2={0} stroke="white" strokeWidth={1.5} />
          <line x1={0} y1={-4} x2={0} y2={4} stroke="white" strokeWidth={1.5} />
          <title>{t("add_post_arm_title")}</title>
        </g>
      </g>

      {confirm && (
        <ConfirmDialog
          plannedAtMs={props.mealAtMs + confirm.newOffsetMin * 60_000}
          checkType={confirm.arm.checkType}
          saving={saving}
          onAccept={onConfirmAccept}
          onCancel={onConfirmCancel}
        />
      )}
      {tooltip && (
        <BgContextTooltip
          arm={tooltip.arm}
          onDismiss={() => setTooltip(null)}
        />
      )}
    </>
  );
}

/** Clinical range label and color for a glucose reading. */
function bgRangeInfo(mgdl: number): { label: string; color: string } {
  if (mgdl < 70) return { label: "low", color: "#EF4444" };
  if (mgdl > 180) return { label: "high", color: "#F59E0B" };
  return { label: "in_range", color: "#22C55E" };
}

/**
 * Tap-to-reveal bottom sheet showing the glucose context for a filled
 * checkpoint knob. Dismisses on backdrop tap or after 3 seconds.
 * Visualization only — no write paths.
 */
function BgContextTooltip({
  arm,
  onDismiss,
}: {
  arm: ArmState;
  onDismiss: () => void;
}) {
  const t = useTranslations("meal_timeline");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Auto-dismiss after 3 seconds.
  useEffect(() => {
    const id = setTimeout(onDismiss, 3000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  if (!mounted || typeof document === "undefined") return null;
  if (arm.bgAtCheck === null || arm.bgAtCheck === undefined) return null;

  const value = arm.bgAtCheck;
  const range = bgRangeInfo(value);

  const timeStr = arm.confirmedAt
    ? new Date(arm.confirmedAt).toLocaleTimeString(undefined, {
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const sourceKey: string =
    arm.bgSource === "cgm"
      ? "bg_tooltip_source_cgm"
      : arm.bgSource === "fingerstick"
        ? "bg_tooltip_source_fingerstick"
        : "bg_tooltip_source_unknown";

  return createPortal(
    (
      <div
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.25)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        data-testid="bg-context-tooltip-overlay"
      >
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "16px 16px 0 0",
            padding: "20px 20px 28px",
            width: "100%",
            maxWidth: 420,
            boxShadow: "0 -4px 24px rgba(0,0,0,0.18)",
          }}
          onClick={(e) => e.stopPropagation()}
          data-testid="bg-context-tooltip-sheet"
        >
          {/* Value + range badge row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 28, fontWeight: 800,
                color: range.color,
                lineHeight: 1,
              }}
              data-testid="bg-context-value"
            >
              {value}
            </span>
            <span
              style={{
                fontSize: 13, fontWeight: 600,
                color: "var(--text-dim)",
                alignSelf: "flex-end",
                marginBottom: 2,
              }}
            >
              mg/dL
            </span>
            <span
              style={{
                marginLeft: "auto",
                padding: "3px 10px",
                borderRadius: 20,
                background: range.color + "22",
                color: range.color,
                fontSize: 12, fontWeight: 700,
                border: `1px solid ${range.color}44`,
              }}
              data-testid="bg-context-range-label"
            >
              {t(`bg_tooltip_range_${range.label}` as Parameters<typeof t>[0])}
            </span>
          </div>

          {/* Time row */}
          {timeStr && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, color: "var(--text-dim)",
                marginBottom: 6,
              }}
              data-testid="bg-context-time"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("bg_tooltip_measured_at", { time: timeStr })}
            </div>
          )}

          {/* Source row */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, color: "var(--text-dim)",
            }}
            data-testid="bg-context-source"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M20.188 10.934c.2.646.312 1.329.312 2.066 0 4.418-3.582 8-8 8s-8-3.582-8-8 3.582-8 8-8c1.83 0 3.52.617 4.865 1.645" />
            </svg>
            {t(sourceKey as Parameters<typeof t>[0])}
          </div>
        </div>
      </div>
    ),
    document.body,
  );
}

function ConfirmDialog({
  plannedAtMs,
  checkType,
  saving,
  onAccept,
  onCancel,
}: {
  plannedAtMs: number;
  checkType: string;
  saving: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("meal_timeline");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const time = new Date(plannedAtMs).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit",
  });
  const kindLabel = kindOf(checkType) === "pre" ? t("pre_label") : t("post_label");
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    (
      <div
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        data-testid="meal-node-confirm-overlay"
      >
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "16px 18px",
            minWidth: 240,
            maxWidth: 320,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", marginBottom: 4 }}>
            {t("confirm_title", { kind: kindLabel, time })}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
            {t("confirm_subtitle")}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-strong)",
                fontSize: 13, fontWeight: 600,
                cursor: saving ? "default" : "pointer",
              }}
              data-testid="meal-node-confirm-cancel"
            >
              {t("cancel_button")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={saving}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${ACCENT}`,
                background: ACCENT,
                color: "white",
                fontSize: 13, fontWeight: 700,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
              data-testid="meal-node-confirm-accept"
            >
              {saving ? "…" : t("confirm_button")}
            </button>
          </div>
        </div>
      </div>
    ),
    document.body,
  );
}
