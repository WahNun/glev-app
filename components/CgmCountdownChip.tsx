"use client";

/**
 * Visual countdown chip pair for the automatic CGM post-fetch jobs that
 * fire after meal / bolus / basal / exercise log entries.
 *
 * Three states per chip:
 *   - PENDING — fetch_time still in the future (or in the past but the
 *     worker hasn't picked it up yet AND the job is still 'pending'):
 *     animated SVG progress ring + "in 43 min" countdown.
 *   - FETCHED — value is stored on the log row: large mg/dL number
 *     coloured by in-range thresholds + Δ vs the baseline + fetched-at.
 *   - MISSING — fetch_time has passed, no value, and either no job row
 *     exists or the job is failed/skipped: "Kein Wert" placeholder.
 *
 * Data flow:
 *   - Parent passes `windowStartIso` + `expectedFetchAtIso` so we can
 *     render the ring immediately without waiting for the job RPC.
 *   - We then call fetchJobsForLog() once on mount; if the job row has
 *     a more precise fetch_time / status / fetched_at we use those.
 *
 * The component re-renders every 30s while any slot is pending — enough
 * for "in Xm" precision without thrashing.
 */

import { useEffect, useState } from "react";
import { fetchJobsForLog, type CgmFetchJob, type FetchType } from "@/lib/cgmJobs";

const BORDER = "rgba(255,255,255,0.08)";
const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";

export interface CgmCountdownSlot {
  label: string;                // "1h Post", "2h Post", "At End", "12h Post"
  fetchType: FetchType;         // matches cgm_fetch_jobs.fetch_type
  fetchedValue: number | null;  // value from the log row (e.g. m.bg_1h)
  fetchedAtIso?: string | null; // optional precise stamp (e.g. m.bg_1h_at)
  windowStartIso: string;       // log entry timestamp — ring start
  expectedFetchAtIso: string;   // when the fetch should fire — ring end
}

export interface CgmCountdownPairProps {
  logId: string;
  /** Baseline glucose for Δ display (cgm_glucose_at_log or glucose_before). */
  baseline: number | null;
  /** Tint for the progress ring + pending text. */
  themeColor?: string;
  slots: [CgmCountdownSlot, CgmCountdownSlot];
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function CgmCountdownPair({ logId, baseline, themeColor = ACCENT, slots }: CgmCountdownPairProps) {
  const [jobs, setJobs] = useState<CgmFetchJob[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJobsForLog(logId).then(j => { if (!cancelled) setJobs(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, [logId]);

  const anyPending = slots.some(s => s.fetchedValue == null);
  const now = useNow(anyPending);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {slots.map((slot, idx) => {
        const job = jobs?.find(j => j.fetch_type === slot.fetchType) ?? null;
        // Prefer the job's precise fetch_time over the parent's estimate.
        const expectedAtMs = job?.fetch_time
          ? new Date(job.fetch_time).getTime()
          : new Date(slot.expectedFetchAtIso).getTime();
        const startAtMs = new Date(slot.windowStartIso).getTime();
        return (
          <CgmCountdownChip
            key={idx}
            label={slot.label}
            value={slot.fetchedValue}
            fetchedAtIso={slot.fetchedAtIso ?? job?.fetched_at ?? null}
            startAtMs={startAtMs}
            expectedAtMs={expectedAtMs}
            jobStatus={job?.status ?? null}
            baseline={baseline}
            now={now}
            themeColor={themeColor}
          />
        );
      })}
    </div>
  );
}

interface ChipProps {
  label: string;
  value: number | null;
  fetchedAtIso: string | null;
  startAtMs: number;
  expectedAtMs: number;
  jobStatus: "pending" | "fetched" | "failed" | "skipped" | null;
  baseline: number | null;
  now: number;
  themeColor: string;
}

function CgmCountdownChip({
  label, value, fetchedAtIso, startAtMs, expectedAtMs, jobStatus, baseline, now, themeColor,
}: ChipProps) {
  const past = now >= expectedAtMs;
  // Resolution: a stored value always beats job state. Otherwise pending
  // unless the wait window has elapsed or the job has failed/skipped.
  const kind: "fetched" | "pending" | "missing" =
    value != null ? "fetched"
      : (!past && jobStatus !== "failed" && jobStatus !== "skipped") ? "pending"
      : "missing";

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6,
      minHeight: 84,
    }}>
      <div style={{
        fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em",
        fontWeight: 600, textTransform: "uppercase",
      }}>
        {label}
      </div>
      {kind === "fetched" && (
        <FetchedDisplay value={value!} baseline={baseline} fetchedAtIso={fetchedAtIso} />
      )}
      {kind === "pending" && (
        <PendingDisplay startAtMs={startAtMs} expectedAtMs={expectedAtMs} now={now} themeColor={themeColor} />
      )}
      {kind === "missing" && (
        <MissingDisplay expectedAtMs={expectedAtMs} />
      )}
    </div>
  );
}

function inRangeColor(mgdl: number): string {
  if (mgdl < 70 || mgdl > 180) return PINK;
  if (mgdl > 140) return ORANGE;
  return GREEN;
}

function deltaColor(d: number): string {
  if (Math.abs(d) < 25) return "rgba(255,255,255,0.55)";
  if (d > 0) return ORANGE;
  return PINK;
}

function FetchedDisplay({ value, baseline, fetchedAtIso }: {
  value: number; baseline: number | null; fetchedAtIso: string | null;
}) {
  const v = Math.round(value);
  const delta = baseline != null ? Math.round(value - baseline) : null;
  const c = inRangeColor(v);
  const fetchedAt = fetchedAtIso ? new Date(fetchedAtIso) : null;
  return (
    <>
      <div style={{
        fontSize: 18, fontWeight: 800, color: c,
        fontFamily: "var(--font-mono)", letterSpacing: "-0.02em",
        lineHeight: 1.1,
      }}>
        {v} <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>mg/dL</span>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {delta != null && (
          <span style={{ color: deltaColor(delta), fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
        {fetchedAt && (
          <span>{fetchedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
        )}
      </div>
    </>
  );
}

function PendingDisplay({ startAtMs, expectedAtMs, now, themeColor }: {
  startAtMs: number; expectedAtMs: number; now: number; themeColor: string;
}) {
  const totalMs = Math.max(1, expectedAtMs - startAtMs);
  const elapsedMs = Math.max(0, Math.min(totalMs, now - startAtMs));
  const pct = elapsedMs / totalMs;
  const remainMs = Math.max(0, expectedAtMs - now);
  const totalSec = Math.ceil(remainMs / 1_000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const text = `${mm}:${ss}`;
  const expectedDate = new Date(expectedAtMs);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <CountdownRing pct={pct} color={themeColor} />
        <div style={{
          fontSize: 14, fontWeight: 700, color: themeColor,
          fontFamily: "var(--font-mono)", letterSpacing: "-0.01em",
        }}>
          {text}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
        Erwartet {expectedDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </>
  );
}

function MissingDisplay({ expectedAtMs }: { expectedAtMs: number }) {
  const expectedDate = new Date(expectedAtMs);
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, color: PINK }}>
        Überfällig
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
        Erwartet {expectedDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </>
  );
}

/** SVG circular progress ring — full sweep at 100% (= fetch due now). */
function CountdownRing({ pct, color, size = 28 }: { pct: number; color: string; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * Math.max(0, Math.min(1, pct));
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, animation: "glev-cgm-spin-pulse 2.4s ease-in-out infinite" }}
    >
      <style>{`@keyframes glev-cgm-spin-pulse {
        0%,100% { opacity: 1; }
        50% { opacity: 0.55; }
      }`}</style>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`${color}22`} strokeWidth={stroke}/>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
