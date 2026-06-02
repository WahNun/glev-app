"use client";
import { fetchCgmHistory, invalidateCgmCache } from "@/lib/cgm/clientCache";
import { useTranslations } from "next-intl";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CgmFetchButton, { type CgmFetchResult } from "@/components/CgmFetchButton";
import TrendArrow, { type TrendDirection } from "@/components/TrendArrowIcon";

// Maps the adapter-provided 5-category trend string to the TrendDirection
// enum used by TrendArrowIcon. Unknown or undefined values default to "flat".
function trendStringToDirection(trend: string): TrendDirection {
  switch (trend) {
    case "risingQuickly": return "up-fast";
    case "rising":        return "up";
    case "falling":       return "down";
    case "fallingQuickly":return "down-fast";
    default:              return "flat";
  }
}
import { useCrosshair, CrosshairOverlay, CrosshairTooltip, type CrosshairPoint } from "@/components/ChartCrosshair";
import { parseLluTs as _parseLluTs } from "@/lib/time";
import {
  fetchRecentFingersticks,
  FS_OVERRIDE_WINDOW_MS,
  type FingerstickReading,
} from "@/lib/fingerstick";
import { getTargetRange, fetchTargetRange, DEFAULT_TARGET_RANGE, type TargetRange } from "@/lib/userSettings";
import { fetchMeals, type Meal } from "@/lib/meals";
import { fetchRecentInsulinLogs } from "@/lib/insulin";
import {
  listChecksForMeals,
  upsertCheck,
  type ChecksByMeal,
} from "@/lib/mealTimelineChecks";
import { scheduleCheckReminder } from "@/lib/mealCheckReminders";
import { usePlan } from "@/hooks/usePlan";
import MealNodeCluster, {
  CLUSTER_OVERLAP_PX,
  CLUSTER_STAGGER_Y_PX,
  DEFAULT_PRE_OFFSET_MIN,
  DEFAULT_POST_OFFSET_MIN,
  kindOf,
  type ArmState,
} from "@/components/MealNodeCluster";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

// Defaults match `DEFAULT_TARGET_RANGE` (lib/userSettings.ts) — used
// as the initial sync band before each component's `getTargetRange()`
// call resolves the user's saved value. Every consumer (HeroFront big
// value color, RollingChart in-range band, BackStats TIR/TAR/TBR
// tiles) reads its own range so we don't have to prop-drill it.
const DEFAULT_RANGE_LOW  = DEFAULT_TARGET_RANGE.low;
const DEFAULT_RANGE_HIGH = DEFAULT_TARGET_RANGE.high;

type Reading = { value: number | null; unit: string; timestamp: string | null; trend: string };

/** A single chart point with its source — used by RollingChart to render
    CGM points as a connected line (circle marker on last value) and
    fingerstick points as standalone squares with a white outline. */
export type ChartPoint = { t: number; v: number; source: "cgm" | "fingerstick" };

type State =
  | { kind: "loading" }
  | { kind: "no-cgm" }
  | { kind: "error"; msg: string }
  | {
      kind: "ok";
      cgm: Array<{ t: number; v: number }>;
      fingersticks: Array<{ t: number; v: number }>;
      /** trend: adapter-provided 5-category string
       *  (risingQuickly / rising / stable / falling / fallingQuickly).
       *  Undefined when the CGM source doesn't supply a per-reading trend. */
      cgmCurrent: { v: number; t: number; trend?: string } | null;
    };

// The chart fills the remaining space inside the card via the DayChart's
// own ResizeObserver, so the card height directly controls how much room
// the trace gets. Numbers chosen to give a generous chart area on both
// viewports without crowding the dashboard grid.
const CARD_STYLE_TAG = `
  .glev-today-card { height: 240px; }
  @media (max-width: 768px) {
    .glev-today-card { height: 220px; }
  }
  @media (max-width: 430px) {
    /* iPhone 13 mini and similar: pull the live-glucose card down
       so glucose + macros + control + plus-button all fit in one
       viewport without scrolling. The chart still gets enough room
       because the header is unchanged.
       2026-05-17 (user request): card bumped 178→210 so the chart
       claims the visible empty space below the trace; the y-axis tick
       reduction (4→3 ticks, removed 110) prevents label overlap that
       came from cramming four labels into the previous short chart. */
    .glev-today-card { height: 210px; }
  }
`;

export default function CurrentDayGlucoseCard({ showMealNodes = false }: { showMealNodes?: boolean }) {
  // E2E test escape hatch: Playwright sets this localStorage key via
  // `page.addInitScript` so the cluster overlay renders in a fresh browser
  // context without needing to visit /engine first (which normally triggers
  // engineHdr.setVisible(true)). The key is never set in production.
  const forceMealNodes =
    typeof window !== "undefined" &&
    window.localStorage.getItem("glev_test_show_meal_nodes") === "1";
  const effectiveShowMealNodes = showMealNodes || forceMealNodes;

  const { canAccess } = usePlan();
  const hasCgmAccess = canAccess("cgm_sync");

  const [s, setS] = useState<State>({ kind: "loading" });
  const [flipped, setFlipped] = useState(false);

  const loadHistory = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      // Free plan (or simulator set to Free): skip CGM fetch entirely —
      // show fingersticks only, just like a real Free user would see.
      if (!hasCgmAccess) {
        const fsResult = await fetchRecentFingersticks(24).catch(() => [] as FingerstickReading[]);
        const now = Date.now();
        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
        const fingersticks = fsResult
          .map((r) => ({ t: new Date(r.measured_at).getTime(), v: Number(r.value_mg_dl) }))
          .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v) && r.t >= twentyFourHoursAgo && r.t <= now)
          .sort((a, b) => a.t - b.t);
        if (!signal?.cancelled) setS({ kind: "ok", cgm: [], fingersticks, cgmCurrent: null });
        return;
      }

      // Fetch CGM history and recent fingersticks in parallel. FS failure
      // is non-fatal — we degrade to CGM-only rather than block the card.
      const [data, fsResult] = await Promise.all([
        fetchCgmHistory(),
        fetchRecentFingersticks(24).catch(() => [] as FingerstickReading[]),
      ]);
      if (!data) throw new Error("CGM unavailable");
      // Rolling 12h window so the live chart never has a "hole" at
      // midnight when the day-axis would otherwise reset to 00:00.
      // The back-card "Today's summary" filters this set down to
      // today-only itself, so we keep the wider window in state.
      const now = Date.now();
      // 24h fetch-side window (was 12h). Lucas 2026-05-12: with the
      // newest CGM point landing exactly at -12h, the previous filter
      // dropped EVERYTHING and the chart rendered as a black box (the
      // stale overlay couldn't fire either, because it requires
      // allCgm.length > 0). 24h gives the chart's adaptive 4-14h
      // window plenty of headroom and matches the back-card "today's
      // summary" filter scope. parseLluTs may return NaN for malformed
      // strings — exclude those explicitly.
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      const cgm = (data.history || [])
        .filter((r) => r.value != null && r.timestamp)
        .map((r) => ({ t: parseLluTs(r.timestamp!), v: r.value! }))
        .filter((r) => Number.isFinite(r.t) && r.t >= twentyFourHoursAgo && r.t <= now)
        .sort((a, b) => a.t - b.t);

      const fingersticks = fsResult
        .map((r) => ({ t: new Date(r.measured_at).getTime(), v: Number(r.value_mg_dl) }))
        .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v) && r.t >= twentyFourHoursAgo && r.t <= now)
        .sort((a, b) => a.t - b.t);

      // Prefer the newest CGM history point if it's newer than the
      // official `connection.glucoseMeasurement` value. LLU's official
      // current can lag the graphData stream by hours on some sensors
      // (Lucas reported "9h ago" 2026-05-12 while LLU app showed live
      // data — graphData was fresh, glucoseMeasurement was stale).
      const officialCurrent = data.current && data.current.value != null && data.current.timestamp
        ? { v: data.current.value, t: parseLluTs(data.current.timestamp) }
        : null;
      const newestHistory = cgm.length ? { v: cgm[cgm.length - 1].v, t: cgm[cgm.length - 1].t } : null;
      const cgmCurrentBase =
        officialCurrent && newestHistory
          ? (newestHistory.t > officialCurrent.t ? newestHistory : officialCurrent)
          : (officialCurrent ?? newestHistory);
      // Thread the adapter-provided trend string (5-category: risingQuickly /
      // rising / stable / falling / fallingQuickly) through so HeroFront can
      // display a more precise arrow than the 3-state computeDelta15m result.
      const cgmCurrent = cgmCurrentBase
        ? { ...cgmCurrentBase, trend: data.current?.trend ?? undefined }
        : null;

      if (!signal?.cancelled) setS({ kind: "ok", cgm, fingersticks, cgmCurrent });
    } catch (e) {
      if (!signal?.cancelled) setS({ kind: "error", msg: e instanceof Error ? e.message : "fetch failed" });
    }
  }, [hasCgmAccess]);

  useEffect(() => {
    const signal = { cancelled: false };
    loadHistory(signal);
    return () => { signal.cancelled = true; };
  }, [loadHistory]);

  // Auto-refresh while the card is on screen so the live tile actually
  // stays live without the user having to pull or remount. 60-second
  // cadence matches what Libre 2 Plus / Libre 3 push to LinkUp (~5 min
  // sensor updates, but LLU's graph endpoint can land new points
  // earlier). Pauses while the tab is hidden so we don't drain battery
  // when the app is backgrounded; resumes immediately on visibility
  // change with one extra fetch so the user sees the freshest value
  // the moment they return. The 30s client-side cache in
  // lib/cgm/clientCache.ts coalesces this with anything else mounting.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const REFRESH_MS = 60_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") loadHistory();
      }, REFRESH_MS);
    };
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadHistory();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadHistory]);

  // Refresh full daily history after the user pulls a new latest reading
  // (CGM) or saves a new fingerstick. Both data streams need to re-merge.
  // We MUST invalidate the 30s clientCache first — otherwise loadHistory()
  // returns the stale cached payload and the user's tap on the refresh
  // button silently does nothing for up to 30 seconds (Lucas reported
  // 2026-05-12 the chart staying empty even after multiple refreshes).
  const onCgmRefresh = useCallback((r: CgmFetchResult) => {
    if (r.ok) {
      invalidateCgmCache();
      loadHistory();
    }
  }, [loadHistory]);

  return (
    <div
      onClick={() => s.kind === "ok" && setFlipped((f) => !f)}
      className="glev-today-card"
      style={{
        position: "relative",
        cursor: s.kind === "ok" ? "pointer" : "default",
        perspective: 1200,
      }}
    >
      <style>{CARD_STYLE_TAG}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT — hero glucose tile, mirroring the landing-page mockup
            (`AppMockupPhone.tsx` ~line 282 "Live glucose hero") 1:1:
            "GLUCOSE · LIVE" pill (GREEN, uppercase) + "Xm ago" timestamp,
            big mono value + mg/dL + trend arrow with 15-min delta,
            rolling 2-hour sparkline filling the remaining height. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            background: `linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`,
            border: `1px solid ${ACCENT}30`,
            borderRadius: 16,
            padding: "16px 18px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflow: "hidden",
          }}
        >
          <HeroFront
            state={s}
            onCgmRefresh={onCgmRefresh}
            flippable={s.kind === "ok"}
            showMealNodes={effectiveShowMealNodes}
          />
        </div>

        {/* BACK */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: `linear-gradient(145deg, ${ACCENT}10, ${SURFACE} 65%)`,
            border: `1px solid ${ACCENT}33`,
            borderRadius: 16,
            padding: "18px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "hidden",
          }}
        >
          {s.kind === "ok" && <BackStats readings={s.cgm} />}
        </div>
      </div>

    </div>
  );
}

/* HeroFront — replaces the old Header. Renders the entire FRONT card
   contents for every state of `s` (loading / no-cgm / error / ok).
   Visual reference: `AppMockupPhone.tsx` "Live glucose hero" tile.

   Layout (ok state):
     ┌──────────────────────────────────────────────┐
     │ GLUCOSE · LIVE          1m ago [Refresh] ↺  │
     │ 142  mg/dL                       ↗ +8 / 15m │
     │ ┌──────────────────────────────────────────┐ │
     │ │  rolling 2h sparkline (RollingChart)      │ │
     │ └──────────────────────────────────────────┘ │
     │ −2h          −1h                  now        │
     └──────────────────────────────────────────────┘ */
function HeroFront({
  state, onCgmRefresh, flippable, showMealNodes,
}: {
  state: State;
  onCgmRefresh: (r: CgmFetchResult) => void;
  flippable: boolean;
  showMealNodes: boolean;
}) {
  const ok  = state.kind === "ok";
  const cgm = ok ? state.cgm : [];
  const fs  = ok ? state.fingersticks : [];
  const cgmCurrent = ok ? state.cgmCurrent : null;

  // Override rule: a fingerstick measured within FS_OVERRIDE_WINDOW_MS
  // outranks the latest CGM value as the trustworthy "current" reading.
  // After the window expires, we fall back to CGM automatically.
  const now = Date.now();
  const latestFs = fs.length ? fs[fs.length - 1] : null;
  const fsOverride = latestFs && (now - latestFs.t) <= FS_OVERRIDE_WINDOW_MS
    ? latestFs : null;
  const current = fsOverride ?? cgmCurrent;
  // Use the user's saved target band (user_settings.target_min_mgdl /
  // target_max_mgdl, Migration 20260517) so the big-value colour
  // agrees with the rest of the app (Today's Summary tile,
  // Dashboard Trend Breakdown, Insights TIR card, PDF). Sync seed
  // from localStorage mirror avoids first-paint colour flicker.
  const [heroRange, setHeroRange] = useState<TargetRange>(() => getTargetRange());
  useEffect(() => { fetchTargetRange().then(setHeroRange).catch(() => {}); }, []);
  const valueColor = current ? colorFor(current.v, heroRange.low, heroRange.high) : "var(--text-dim)";
  const ageLabel = current ? formatAge(now - current.t) : null;

  // Trend delta is CGM-derived: fingersticks are too sparse to drive a
  // 15-min slope. Skipped while a FS override is active to avoid the
  // confusing combination of "current=FS" + "delta=from CGM".
  const delta = useMemo(
    () => fsOverride ? null : computeDelta15m(cgm, cgmCurrent),
    [cgm, cgmCurrent, fsOverride],
  );

  // 5-category trend direction: prefer the adapter-provided trend string
  // (Apple Health / Nightscout use the same risingQuickly…fallingQuickly
  // vocabulary set in lib/cgm/appleHealth.ts + lib/cgm/nightscout.ts).
  // Falls back to the 3-state computeDelta15m result so LLU readings
  // (which don't carry a per-reading slope) still show an arrow.
  const trendDirection: TrendDirection | null = useMemo(() => {
    if (fsOverride) return null;
    const adapterTrend = cgmCurrent?.trend;
    if (adapterTrend) return trendStringToDirection(adapterTrend);
    if (!delta) return null;
    if (delta.direction === "up") return "up";
    if (delta.direction === "down") return "down";
    return "flat";
  }, [cgmCurrent, delta, fsOverride]);

  // Merged points handed to the chart, sorted chronologically. The chart
  // distinguishes them visually (CGM = connected line + circle on last,
  // fingersticks = standalone squares with white outline).
  const chartPoints: ChartPoint[] = useMemo(() => {
    const merged: ChartPoint[] = [
      ...cgm.map((r) => ({ t: r.t, v: r.v, source: "cgm" as const })),
      ...fs.map((r) => ({ t: r.t, v: r.v, source: "fingerstick" as const })),
    ];
    return merged.sort((a, b) => a.t - b.t);
  }, [cgm, fs]);

  return (
    <>
      {/* Header row — uppercase pill label LEFT, age + refresh + flip RIGHT.
          Manual fingerstick entry pill was removed per user request — the
          card now stays read-only; FS data still flows in from the
          background fetch + appears on the chart and as the "FS"
          override badge next to the value. To log a fingerstick by hand,
          use the dedicated FingerstickLogCard surface instead. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, letterSpacing: "0.12em",
          color: GREEN, textTransform: "uppercase",
        }}>
          GLUCOSE · LIVE
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ageLabel && (
            <span style={{
              fontSize: 12, color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
            }}>
              {ageLabel}
            </span>
          )}
          {(ok || state.kind === "error") && (
            <CgmFetchButton variant="ghost" onResult={onCgmRefresh} title="Refresh CGM" />
          )}
          {flippable && (
            <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>↺</span>
          )}
        </div>
      </div>

      {/* Value + trend row — only when we have a current reading */}
      {ok && current ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{
            fontSize: 48, fontWeight: 800, letterSpacing: "-0.04em",
            color: valueColor, fontFamily: "var(--font-mono)", lineHeight: 1,
          }}>
            {Math.round(current.v)}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>mg/dL</span>
          {fsOverride && (
            <span style={{
              padding: "2px 7px", borderRadius: 99,
              background: "var(--border)",
              border: "1px solid var(--text-ghost)",
              color: "var(--text-strong)",
              fontSize: 14,
            }}>
              🩸
            </span>
          )}
          {trendDirection && (
            <span style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
              color: valueColor, fontSize: 13, fontWeight: 600,
            }}>
              <TrendArrow direction={trendDirection} color={valueColor} />
              {delta?.label}
            </span>
          )}
        </div>
      ) : (
        <div style={{
          minHeight: 48, display: "flex", alignItems: "center",
          color: "var(--text-dim)", fontSize: 13,
        }}>
          {state.kind === "loading" ? "Loading CGM data…"
            : state.kind === "no-cgm" ? "Connect a CGM in Settings to see live glucose."
            : state.kind === "error" ? `CGM error: ${state.msg}`
            : "No readings yet today"}
        </div>
      )}

      {/* Chart fills remaining card height */}
      {ok && chartPoints.length > 0 ? (
        <RollingChart readings={chartPoints} showMealNodes={showMealNodes} />
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </>
  );
}


function formatAge(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

/* Compute the delta in mg/dL between the current reading and the reading
   closest to (current.t − 15min). Requires ≥5min of separation so a brief
   gap doesn't yield a misleading "±0" trend. Returns null if there is no
   suitable historical reading. */
function computeDelta15m(
  readings: Array<{ t: number; v: number }>,
  current: { v: number; t: number } | null,
): { label: string; direction: "up" | "down" | "flat" } | null {
  if (!current || readings.length < 2) return null;
  const target = current.t - 15 * 60 * 1000;
  let best: { t: number; v: number } | null = null;
  let bestDist = Infinity;
  for (const r of readings) {
    if (r.t > current.t) continue;
    const d = Math.abs(r.t - target);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  if (!best || current.t - best.t < 5 * 60 * 1000) return null;
  const delta = Math.round(current.v - best.v);
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const direction: "up" | "down" | "flat" = delta > 2 ? "up" : delta < -2 ? "down" : "flat";
  return { label: `${sign}${Math.abs(delta)} / 15m`, direction };
}

/* RollingChart — last 12h of readings on a (now − 12h) → now domain so
   the curve never has a midnight "hole" the way a 00:00→now domain
   does right after the day rolls over. Filters the parent's readings
   array client-side. X-axis labels are relative markers (-12h / -8h /
   -4h / now). Touch-revealed grid uses 2-hour vertical intervals for
   fine time orientation. Line + last-point color tracks
   `glucoseLineColor(last.v)`. */
function RollingChart({ readings, showMealNodes }: { readings: ChartPoint[]; showMealNodes: boolean }) {
  const t = useTranslations("insights");
  // User-saved TIR band drives the green "in-range" shaded rectangle
  // overlay and the Y-axis hint at top/bottom of the band so the chart
  // reads in lock-step with the user's Settings choice rather than the
  // 70/180 default.
  const [chartRange, setChartRange] = useState<TargetRange>(() => getTargetRange());
  useEffect(() => { fetchTargetRange().then(setChartRange).catch(() => {}); }, []);
  const RANGE_LOW  = chartRange.low;
  const RANGE_HIGH = chartRange.high;
  // Measure the container so the SVG always renders in true pixel space.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 200 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // ResizeObserver — primary path. Fires for any layout change including
    // device rotation and window resize, without relying on a window event.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(([entry]) => {
        const r = entry.contentRect;
        if (r.width > 0 && r.height > 0) {
          setSize({ w: Math.round(r.width), h: Math.round(r.height) });
        }
      });
      ro.observe(el);
    }

    // window.resize fallback — covers older Capacitor WKWebViews (iOS < 13.4)
    // where ResizeObserver may fire with a one-frame delay after rotation.
    // The resize event is synchronous with the orientation change, so it acts
    // as an early trigger that keeps node X-positions correct immediately.
    function onWindowResize() {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  const W = size.w;
  const H = size.h;
  const padL = 28;
  const padR = 10;
  const padT = 8;
  const padB = 22;

  // Adaptive rolling window (4h–12h). Restored 2026-05-12 after the
  // fixed-4h variant from earlier today (commit 9f17757) caused the
  // chart to render completely empty whenever the newest CGM point
  // was older than 4h — Lucas saw "9h ago" with a blank chart and
  // (correctly) read it as the app being broken, not as "stale data".
  // Adaptive behaviour: pick a window between 4h (minimum) and 12h
  // (maximum) sized to the actual data span (oldest reading → now)
  // plus 30min right-side padding so the latest dot doesn't kiss the
  // right edge. This way, if the most recent reading is 7h old the
  // chart shows ~8h and the trace is visible; if data is fresh the
  // chart stays at the tighter 4h zoom.
  // Stable `now`: only recomputed when `readings` changes (new CGM data),
  // NOT on every render. Putting Date.now() inline would make every useMemo
  // and useEffect that depends on `now` re-run on every render → infinite loop.
  const now = useMemo(() => Date.now(), [readings]);
  const MIN_WIN = 4  * 60 * 60 * 1000;
  // MAX 14h (was 12h). Gives the chart breathing room when the newest
  // CGM point sits right at the 12h boundary — at MAX=12h that point
  // would land on the far-left edge of the chart and be invisible.
  // 14h pulls the trace ~2h inward so it's actually drawable.
  const MAX_WIN = 14 * 60 * 60 * 1000;
  const winSpan = useMemo(() => {
    const all = readings.filter((r) => r.t <= now && r.t >= now - MAX_WIN);
    if (all.length === 0) return MAX_WIN;
    const oldest = Math.min(...all.map((r) => r.t));
    const span   = now - oldest + 30 * 60 * 1000; // +30min padding
    return Math.max(MIN_WIN, Math.min(MAX_WIN, span));
  }, [readings, now]);
  const winStart = useMemo(() => now - winSpan, [now, winSpan]);
  const visible = useMemo(
    () => readings.filter((r) => r.t >= winStart && r.t <= now),
    [readings, winStart, now],
  );

  // Split for rendering: CGM drives the connected trace + last-point dot;
  // fingersticks render as standalone squares with a white outline ON TOP
  // of the trace so they remain visually distinct from CGM circles.
  const visibleCgm = useMemo(() => visible.filter((r) => r.source === "cgm"),         [visible]);
  const visibleFs  = useMemo(() => visible.filter((r) => r.source === "fingerstick"), [visible]);

  const yMin = 40;
  const yMax = 300;
  const toX = (t: number) => padL + ((t - winStart) / (now - winStart)) * (W - padL - padR);
  const toY = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  // 2026-05-17: dropped the 110 tick. On the small (≤430 px) card the
  // four labels overlapped each other and the trace at the typical
  // 70–90 px chart height. 3 ticks (low band, high band, hyper marker)
  // are enough for at-a-glance orientation; the crosshair tooltip
  // still gives the exact value when the user taps.
  const yTicks = [70, 180, 250];
  // Relative markers anchored to "now" on the right edge. Computed
  // from `winSpan` so the labels track the adaptive window width
  // (-12h / -8h / -4h / now when full; -4h / -3h / -1h / now when
  // zoomed to a thin slice of recent data).
  const xLabels: Array<{ t: number; label: string }> = useMemo(() => {
    const spanH = winSpan / 3600 / 1000;
    const h1 = Math.max(1, Math.round(spanH));
    const h2 = Math.max(1, Math.round((spanH * 2) / 3));
    const h3 = Math.max(1, Math.round(spanH / 3));
    return [
      { t: now - h1 * 3600 * 1000, label: `-${h1}h` },
      { t: now - h2 * 3600 * 1000, label: `-${h2}h` },
      { t: now - h3 * 3600 * 1000, label: `-${h3}h` },
      { t: now,                    label: "now"     },
    ];
  }, [winSpan, now]);

  const path = visibleCgm.map((r, i) => `${i === 0 ? "M" : "L"}${toX(r.t).toFixed(1)},${toY(r.v).toFixed(1)}`).join(" ");
  const lastCgm = visibleCgm[visibleCgm.length - 1];
  const lastX = lastCgm ? toX(lastCgm.t) : 0;
  const lastY = lastCgm ? toY(lastCgm.v) : 0;
  const lastC = lastCgm ? glucoseLineColor(lastCgm.v) : ACCENT;

  // Stale-data overlay: CGM data exists but every CGM point is older
  // than the 4h window. Without this the chart area looks broken (only
  // an empty green band). Lucas reported a 9h-stale chart on 2026-05-12.
  // CGM-specific (not merged readings) so a fresh manual fingerstick
  // doesn't mask a dead sensor — the message is literally "Keine
  // aktuellen CGM-Daten", and the FS dot still renders inside the SVG
  // alongside the overlay text.
  const allCgm = useMemo(() => readings.filter((r) => r.source === "cgm"), [readings]);
  const newestCgm = allCgm.length ? allCgm[allCgm.length - 1] : null;
  const isStale = allCgm.length > 0 && visibleCgm.length === 0 && newestCgm != null;
  const staleAge = isStale && newestCgm ? formatAge(now - newestCgm.t) : null;

  // Crosshair-snappable points (pixel space). Includes BOTH CGM and FS so
  // the user can hover/touch either kind of marker.
  const crosshairPoints = useMemo<CrosshairPoint[]>(() => {
    if (W <= 0 || H <= 0) return [];
    return visible.map((r) => {
      const fmtTime = new Date(r.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
      return {
        x: toX(r.t),
        y: toY(r.v),
        color: glucoseLineColor(r.v),
        tooltip: [fmtTime, `${Math.round(r.v)} mg/dL`],
        badge: r.source === "fingerstick" ? "Manuell" : undefined,
      };
    });
    // toX/toY depend on W/H/winStart/now; visible + W + H captures it all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, W, H]);

  const { active, handlers } = useCrosshair(crosshairPoints);

  /* ────────────────────────────────────────────────────────────────
     Meal-Node-Cluster overlay (Task #673)
     Loads bolus-tagged meals in the visible 12h window + any existing
     `meal_timeline_checks` rows, and overlays one MealNodeCluster per
     meal on top of the glucose path. Failures are non-fatal — a CGM
     chart that loses its cluster overlay must still render the trace.
     ──────────────────────────────────────────────────────────────── */
  const [bolusMeals, setBolusMeals] = useState<Meal[]>([]);
  const [checksByMeal, setChecksByMeal] = useState<ChecksByMeal>(new Map());
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (!showMealNodes) {
      setBolusMeals([]);
      setChecksByMeal(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [meals, logs] = await Promise.all([
          fetchMeals({ sinceDays: 1, limit: 50 }).catch(() => [] as Meal[]),
          fetchRecentInsulinLogs(1).catch(() => []),
        ]);
        if (cancelled) return;
        const linkedMealIds = new Set(
          logs
            .filter((l) => l.insulin_type === "bolus" && l.related_entry_id)
            .map((l) => l.related_entry_id as string),
        );
        const cutoff = Date.now() - winSpan;
        const withBolus = meals.filter((m) => {
          const anchor = m.meal_time ?? m.created_at;
          if (!anchor) return false;
          const t = new Date(anchor).getTime();
          if (!Number.isFinite(t) || t < cutoff || t > now) return false;
          return linkedMealIds.has(m.id)
            || (m.insulin_units != null && m.insulin_units > 0);
        });
        setBolusMeals(withBolus);
        if (withBolus.length > 0) {
          const map = await listChecksForMeals(withBolus.map((m) => m.id)).catch(
            () => new Map() as ChecksByMeal,
          );
          if (!cancelled) setChecksByMeal(map);
        } else {
          setChecksByMeal(new Map());
        }
      } catch {
        if (!cancelled) {
          setBolusMeals([]);
          setChecksByMeal(new Map());
        }
      }
    })();
    return () => { cancelled = true; };
    // winSpan changes when the chart window is recalculated;
    // reloadTick is bumped after a confirm-write so the dashed→solid flip
    // is visible without a full page reload. `now` intentionally omitted:
    // Date.now() changes every ms and would cause an infinite render loop.
  }, [showMealNodes, winSpan, reloadTick]);

  // Compute cluster placements (centerX, centerY with Y stagger for
  // overlapping meals). Y is interpolated to the nearest CGM point so
  // the center node sits on the curve rather than floating above it.
  const clusters = useMemo(() => {
    if (W <= 0 || H <= 0 || bolusMeals.length === 0) return [] as Array<{
      meal: Meal; centerX: number; centerY: number; mealAtMs: number;
    }>;
    const sorted = [...bolusMeals].sort((a, b) => {
      const ta = new Date(a.meal_time ?? a.created_at).getTime();
      const tb = new Date(b.meal_time ?? b.created_at).getTime();
      return ta - tb;
    });
    const placed: Array<{ meal: Meal; centerX: number; centerY: number; mealAtMs: number }> = [];
    for (const meal of sorted) {
      const mealAtMs = new Date(meal.meal_time ?? meal.created_at).getTime();
      if (!Number.isFinite(mealAtMs)) continue;
      const cx = toX(mealAtMs);
      // Pick closest CGM point for centerY; fall back to mid-chart.
      let cy: number = padT + (H - padT - padB) / 2;
      if (visibleCgm.length > 0) {
        let best = visibleCgm[0];
        let bestDist = Math.abs(best.t - mealAtMs);
        for (const r of visibleCgm) {
          const d = Math.abs(r.t - mealAtMs);
          if (d < bestDist) { bestDist = d; best = r; }
        }
        cy = toY(best.v);
      }
      // Y stagger when too close to an already-placed cluster.
      let staggerSteps = 0;
      for (const p of placed) {
        if (Math.abs(p.centerX - cx) < CLUSTER_OVERLAP_PX) staggerSteps++;
      }
      cy -= staggerSteps * CLUSTER_STAGGER_Y_PX;
      // Clamp into chart area so the cluster never escapes.
      cy = Math.max(padT + 14, Math.min(H - padB - 14, cy));
      placed.push({ meal, centerX: cx, centerY: cy, mealAtMs });
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolusMeals, W, H, winStart, now]);

  // Build the initial arm-state list for each meal (pre + post_*).
  // Defaults are inserted whenever the corresponding `meal_timeline_checks`
  // row is missing — marked `persisted: false` so the cluster renders
  // them with a dashed outline (= "muss noch bestätigt werden").
  function initialArmsFor(meal: Meal): ArmState[] {
    const mealAtMs = new Date(meal.meal_time ?? meal.created_at).getTime();
    const rows = checksByMeal.get(meal.id) ?? {};
    const out: ArmState[] = [];
    const offsetForRow = (iso: string | null): number | null => {
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      if (!Number.isFinite(ms)) return null;
      return Math.round((ms - mealAtMs) / 60_000);
    };
    // pre
    const preRow = rows["pre"];
    const preOffset = preRow ? offsetForRow(preRow.planned_at) : null;
    out.push({
      checkType: "pre",
      offsetMin: preOffset ?? DEFAULT_PRE_OFFSET_MIN,
      persisted: preOffset !== null,
      rowId: preRow?.id,
      bgAtCheck: preRow?.bg_at_check ?? null,
      confirmedAt: preRow?.confirmed_at ?? null,
    });
    // post_n (collect all present, default to post_1 if none)
    const postKeys = Object.keys(rows).filter((k) => k.startsWith("post_"));
    if (postKeys.length === 0) {
      out.push({
        checkType: "post_1",
        offsetMin: DEFAULT_POST_OFFSET_MIN,
        persisted: false,
        bgAtCheck: null,
        confirmedAt: null,
      });
    } else {
      postKeys.sort((a, b) =>
        parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10),
      );
      for (const k of postKeys) {
        const r = rows[k];
        const off = offsetForRow(r.planned_at);
        out.push({
          checkType: k,
          offsetMin: off ?? DEFAULT_POST_OFFSET_MIN,
          persisted: off !== null,
          rowId: r.id,
          bgAtCheck: r.bg_at_check ?? null,
          confirmedAt: r.confirmed_at ?? null,
        });
      }
    }
    return out;
  }

  // Pixel↔time scale for the cluster math (positive). Falls back to a
  // sane number when the chart hasn't measured yet, since the cluster
  // doesn't render in that case anyway.
  const chartPxWidth = Math.max(1, W - padL - padR);
  const msPerPx = (now - winStart) / chartPxWidth;

  async function handleConfirmCheck(
    meal: Meal,
    checkType: string,
    plannedAtMs: number,
  ): Promise<{ rowId?: string }> {
    const plannedAt = new Date(plannedAtMs).toISOString();
    const row = await upsertCheck({ mealId: meal.id, checkType, plannedAt });
    // Fire-and-forget reminder schedule. Failures are swallowed inside
    // scheduleCheckReminder — must never block the write path.
    scheduleCheckReminder({
      mealId: meal.id,
      checkType,
      plannedAt,
      title: kindOf(checkType) === "pre"
        ? "Pre-Check"
        : "Post-Bolus-Check",
      body: new Date(plannedAtMs).toLocaleTimeString(undefined, {
        hour: "2-digit", minute: "2-digit",
      }),
    }).catch(() => { /* ignore */ });
    setReloadTick((n) => n + 1);
    return { rowId: row.id };
  }

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        // Stop the parent card from flipping while the user is interacting
        // with the crosshair.
        e.stopPropagation();
      }}
      style={{ flex: 1, minHeight: 0, position: "relative", touchAction: "pan-y" }}
      {...handlers}
    >
      {W > 0 && H > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {/* In-range band */}
          <rect
            x={padL} y={toY(RANGE_HIGH)}
            width={W - padL - padR}
            height={toY(RANGE_LOW) - toY(RANGE_HIGH)}
            fill={GREEN} fillOpacity="0.06"
          />
          {/* Y axis tick labels (70 / 180 / 250) — text only,
              no horizontal gridlines unless the user is touching the chart.
              110 dropped 2026-05-17, see yTicks comment above. */}
          {yTicks.map((v) => (
            <text key={`yl${v}`} x={padL - 5} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="var(--text-ghost)">{v}</text>
          ))}
          {/* X axis labels (−2h / −1h / now) — text only at bottom,
              no vertical gridlines unless the user is touching the chart. */}
          {xLabels.map((x) => (
            <text key={`xl${x.label}`} x={toX(x.t)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--text-faint)">{x.label}</text>
          ))}
          {/* Touch-revealed grid — appears only while the crosshair is
              active. 2-hour vertical intervals across the 12h window
              for fine time orientation (1h would crowd the narrow
              card), plus horizontal lines at the Y ticks for value
              reference. */}
          {active && (
            <g style={{ pointerEvents: "none" }}>
              {yTicks.map((v) => (
                <line key={`gh${v}`} x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="var(--border-strong)" strokeDasharray="3 4" />
              ))}
              {Array.from({ length: 7 }, (_, i) => {
                const t = winStart + i * 2 * 3600 * 1000;
                return (
                  <line key={`gv${i}`} x1={toX(t)} y1={padT} x2={toX(t)} y2={H - padB} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 4" />
                );
              })}
            </g>
          )}
          {/* Trace (CGM only — fingersticks are isolated measurements) */}
          <path d={path} fill="none" stroke={lastC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Last CGM point */}
          {lastCgm && <circle cx={lastX} cy={lastY} r="4" fill={lastC} stroke={SURFACE} strokeWidth="1.5" />}
          {/* Fingerstick markers — rendered with the EXACT same shape and
              size as the crosshair-active dot in `ChartCrosshair.tsx`
              (halo r=9 @ 0.15 + inner r=4.5 with surface stroke 1.5) so a
              manually-entered value looks indistinguishable from a hovered
              CGM point. Color is value-derived (`glucoseLineColor`), not
              source-derived: red/orange/green/yellow ramp by mg/dL. */}
          {visibleFs.map((r, i) => {
            const cx = toX(r.t);
            const cy = toY(r.v);
            const c  = glucoseLineColor(r.v);
            return (
              <g key={`fs${i}-${r.t}`}>
                <circle cx={cx} cy={cy} r="9"   fill={c} fillOpacity="0.15" />
                <circle cx={cx} cy={cy} r="4.5" fill={c} stroke={SURFACE} strokeWidth="1.5" />
              </g>
            );
          })}
          {/* Crosshair */}
          <CrosshairOverlay
            active={active}
            top={padT}
            bottom={H - padB}
            left={padL}
            right={W - padR}
          />
        </svg>
      )}
      {/* Meal-Node-Cluster overlay (Task #673). Separate <svg> so the
          base chart can keep pointerEvents:none while the cluster's
          interactive knobs/+button opt back in. */}
      {W > 0 && H > 0 && clusters.length > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
          data-testid="meal-node-cluster-layer"
        >
          {clusters.map((c) => (
            <MealNodeCluster
              key={c.meal.id}
              mealId={c.meal.id}
              mealAtMs={c.mealAtMs}
              centerX={c.centerX}
              centerY={c.centerY}
              msPerPx={msPerPx}
              leftBoundPx={padL}
              rightBoundPx={W - padR}
              initialArms={initialArmsFor(c.meal)}
              onConfirm={(checkType, plannedAtMs) =>
                handleConfirmCheck(c.meal, checkType, plannedAtMs)
              }
            />
          ))}
        </svg>
      )}
      <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
      {isStale && staleAge && (
        <div
          style={{
            position: "absolute",
            inset: `${padT}px ${padR}px ${padB}px ${padL}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: ORANGE, letterSpacing: "0.04em" }}>
            {t("live_chart_stale_title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", maxWidth: 280, lineHeight: 1.35 }}>
            {t("live_chart_stale_desc", { age: staleAge })}
          </div>
        </div>
      )}
    </div>
  );
}

function BackStats({ readings }: { readings: Array<{ t: number; v: number }> }) {
  // Today's-Summary TIR/TAR/TBR tiles use the same user-saved band
  // (user_settings.target_min_mgdl / target_max_mgdl, Migration
  // 20260517) as Insights + the PDF so all three surfaces agree.
  const [statsRange, setStatsRange] = useState<TargetRange>(() => getTargetRange());
  useEffect(() => { fetchTargetRange().then(setStatsRange).catch(() => {}); }, []);
  const RANGE_LOW  = statsRange.low;
  const RANGE_HIGH = statsRange.high;
  // The parent now feeds us a rolling 12h window (so the front-card
  // chart never has a midnight hole). The "Today's summary" tile is
  // semantically still about *today*, so we filter back down here.
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const todayReadings = useMemo(
    () => readings.filter((r) => r.t >= todayStart),
    [readings, todayStart],
  );
  if (todayReadings.length === 0) {
    return <div style={{ color: "var(--text-dim)", fontSize: 14 }}>No readings yet today.</div>;
  }
  const values = todayReadings.map((r) => r.v);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const inRange = values.filter((v) => v >= RANGE_LOW && v <= RANGE_HIGH).length;
  const tir = Math.round((inRange / values.length) * 100);
  const above = values.filter((v) => v > RANGE_HIGH).length;
  const below = values.filter((v) => v < RANGE_LOW).length;
  const tar = Math.round((above / values.length) * 100);
  const tbr = Math.round((below / values.length) * 100);
  const max = todayReadings.reduce((a, b) => (b.v > a.v ? b : a));
  const min = todayReadings.reduce((a, b) => (b.v < a.v ? b : a));
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

  const stats: Array<{ l: string; v: string; c?: string }> = [
    { l: "Daily avg", v: `${avg} mg/dL`, c: colorFor(avg, RANGE_LOW, RANGE_HIGH) },
    { l: "Time in range", v: `${tir}%`, c: tir >= 70 ? GREEN : tir >= 50 ? ORANGE : PINK },
    { l: `Time above ${RANGE_HIGH}`, v: `${tar}%`, c: tar > 25 ? ORANGE : "var(--text-strong)" },
    { l: `Time below ${RANGE_LOW}`,  v: `${tbr}%`, c: tbr > 4 ? PINK : "var(--text-strong)" },
    { l: "Highest", v: `${Math.round(max.v)}`, c: ORANGE },
    { l: "Lowest", v: `${Math.round(min.v)}`, c: PINK },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Today's summary
        </div>
        <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>↺ back</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
        {stats.map((s) => (
          <div key={s.l} style={{ background: "var(--surface-soft)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.c || "var(--text-strong)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function colorFor(v: number, low: number = DEFAULT_RANGE_LOW, high: number = DEFAULT_RANGE_HIGH) {
  if (v < low)  return PINK;
  if (v > high) return ORANGE;
  return GREEN;
}

/**
 * `glucoseLineColor` — smooth color ramp for the trendline / last-point dot
 * in the rolling 2-hour chart. Distinct from `colorFor` (which is a 3-state
 * status color used for the big value text and the daily-avg tile) so the
 * chart can communicate proximity to thresholds via gradient transitions.
 *
 * Palette (Tailwind 500-shade reference, spec'd by product for this chart):
 *   <55 mg/dL     → RED    (#ef4444) — too low
 *   55–70 mg/dL   → RED → BLUE lerp  — approaching low (RED at 55, BLUE at 70)
 *   70–180 mg/dL  → GREEN  (#10b981) — in target range
 *   180–250 mg/dL → YELLOW → ORANGE lerp — going high
 *   >250 mg/dL    → ORANGE (#f97316) — too high (saturates at orange)
 */
function glucoseLineColor(v: number): string {
  const RED    = [0xef, 0x44, 0x44];
  const BLUE   = [0x3b, 0x82, 0xf6];
  const GREEN_ = [0x10, 0xb9, 0x81];
  const YELLOW = [0xea, 0xb3, 0x08];
  const ORANGE_= [0xf9, 0x73, 0x16];
  const lerp = (a: number[], b: number[], t: number) =>
    a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));
  const hex = (rgb: number[]) =>
    `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  if (v < 55) return hex(RED);
  if (v < 70) {
    // 55 → 70 lerps RED → BLUE (closer to 55 is more red, closer to 70 is more blue)
    return hex(lerp(RED, BLUE, (v - 55) / 15));
  }
  if (v <= 180) return hex(GREEN_);
  if (v <= 250) {
    // 180 → 250 lerps YELLOW → ORANGE (closer to 180 is more yellow)
    return hex(lerp(YELLOW, ORANGE_, (v - 180) / 70));
  }
  return hex(ORANGE_);
}

// LibreLinkUp timestamps look like "11/24/2024 4:23:12 PM" (UTC server time).
// Delegate to the shared parser so display times honour the user's device TZ.
function parseLluTs(s: string): number {
  return _parseLluTs(s) ?? Date.now();
}
