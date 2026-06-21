"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useGlucoseUnit, mgdlToMmol } from "@/hooks/useGlucoseUnit";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const BORDER = "var(--border)";

function formatLocalDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatRelativeAge(
  iso: string,
  tAh: ReturnType<typeof useTranslations>,
): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return tAh("age_unknown");
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return tAh("age_just_now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return tAh("age_minutes", { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return tAh("age_hours", { n: diffH });
  const diffD = Math.floor(diffH / 24);
  return tAh("age_days", { n: diffD });
}

export default function AppleHealthSettingsCard() {
  const tAh = useTranslations("cgmSettings.appleHealth");
  const t = useTranslations("cgmSettings");
  const { unit: glucoseUnit } = useGlucoseUnit();

  const [isNativePlatform, setIsNativePlatform] = useState(false);
  const [appleHealthSelected, setAppleHealthSelected] = useState(false);
  const [appleHealthStatus, setAppleHealthStatus] = useState<{
    count: number;
    lastTimestamp: string | null;
    lastValueMgDl: number | null;
    lastTrend: string | null;
    lastBackgroundTimestamp: string | null;
  } | null>(null);
  const [appleHealthPermissionRevoked, setAppleHealthPermissionRevoked] =
    useState(false);
  const [appleHealthSubmitting, setAppleHealthSubmitting] = useState(false);
  const [appleHealthMessage, setAppleHealthMessage] =
    useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [appleHealthPermissionDenied, setAppleHealthPermissionDenied] =
    useState(false);
  const [activitySyncEnabled, setActivitySyncEnabled] = useState(false);
  const [activitySyncSubmitting, setActivitySyncSubmitting] = useState(false);
  const [activitySyncMessage, setActivitySyncMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [workoutsRange, setWorkoutsRange] = useState<{
    oldest: string | null;
    newest: string | null;
    count: number;
  } | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    daysBack: number;
    inserted: number;
    fetched: number;
    chunks: number;
  } | null>(null);
  const [backfillResult, setBackfillResult] = useState<
    | { kind: "success"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);
  const [stepsBackfillRunning, setStepsBackfillRunning] = useState(false);
  const [stepsBackfillProgress, setStepsBackfillProgress] = useState<{
    daysBack: number;
    days: number;
    upserted: number;
    chunks: number;
  } | null>(null);
  const [stepsBackfillResult, setStepsBackfillResult] = useState<
    | { kind: "success"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  const loadAppleHealthState = useCallback(async () => {
    try {
      const [srcRes, statRes, rangeRes, activityRes] = await Promise.all([
        fetch("/api/cgm/source", { cache: "no-store" }),
        fetch("/api/cgm/apple-health/sync", { cache: "no-store" }),
        fetch("/api/health/workouts/range", { cache: "no-store" }),
        fetch("/api/health/activity-sync", { cache: "no-store" }),
      ]);
      if (srcRes.ok) {
        const j = (await srcRes.json()) as { source?: string | null };
        setAppleHealthSelected(j?.source === "apple_health");
      }
      if (statRes.ok) {
        const j = (await statRes.json()) as {
          count?: number;
          lastTimestamp?: string | null;
          lastValueMgDl?: number | null;
          lastTrend?: string | null;
          lastBackgroundTimestamp?: string | null;
        };
        setAppleHealthStatus({
          count: j?.count ?? 0,
          lastTimestamp: j?.lastTimestamp ?? null,
          lastValueMgDl: j?.lastValueMgDl ?? null,
          lastTrend: j?.lastTrend ?? null,
          lastBackgroundTimestamp: j?.lastBackgroundTimestamp ?? null,
        });
      }
      if (rangeRes.ok) {
        const j = (await rangeRes.json()) as {
          oldest?: string | null;
          newest?: string | null;
          count?: number;
        };
        setWorkoutsRange({
          oldest: j?.oldest ?? null,
          newest: j?.newest ?? null,
          count: j?.count ?? 0,
        });
      }
      if (activityRes.ok) {
        const j = (await activityRes.json()) as { enabled?: boolean };
        setActivitySyncEnabled(j?.enabled === true);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = (await import("@capacitor/core")) as unknown as {
          Capacitor?: { isNativePlatform?: () => boolean };
        };
        if (cancelled) return;
        const native = !!mod.Capacitor?.isNativePlatform?.();
        setIsNativePlatform(native);
        if (native) {
          const { isAppleHealthAvailable } = await import(
            "@/lib/cgm/appleHealthClient"
          );
          if (cancelled) return;
          const available = await isAppleHealthAvailable();
          if (!cancelled) setAppleHealthPermissionRevoked(!available);
        }
      } catch {
        if (!cancelled) setIsNativePlatform(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadAppleHealthState();
  }, [loadAppleHealthState]);

  async function handleAppleHealthConnect() {
    setAppleHealthMessage(null);
    if (!isNativePlatform) {
      setAppleHealthMessage({
        kind: "info",
        text: tAh("connect_only_ios"),
      });
      return;
    }
    setAppleHealthSubmitting(true);
    try {
      const { requestAuthorization, syncRecent } = await import(
        "@/lib/cgm/appleHealthClient"
      );
      const auth = await requestAuthorization();
      if (!auth.ok) {
        setAppleHealthPermissionDenied(true);
        setAppleHealthMessage({
          kind: "error",
          text: tAh("permission_denied"),
        });
        return;
      }
      setAppleHealthPermissionDenied(false);
      const patchRes = await fetch("/api/cgm/source", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "apple_health" }),
        cache: "no-store",
      });
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body?.error || tAh("http_error", { status: patchRes.status }));
      }
      setAppleHealthSelected(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("glev:cgm-source-changed", {
            detail: { source: "apple_health" },
          }),
        );
      }
      const sync = await syncRecent();
      await loadAppleHealthState();
      if (sync.ok) {
        setAppleHealthMessage({
          kind: "success",
          text: sync.fetched
            ? tAh("connect_success_with_count", { count: sync.inserted ?? 0 })
            : tAh("connect_success_no_values"),
        });
      } else {
        setAppleHealthMessage({
          kind: "error",
          text: sync.error || tAh("connect_sync_failed"),
        });
      }
    } catch (err) {
      setAppleHealthMessage({
        kind: "error",
        text: err instanceof Error ? err.message : tAh("connect_failed"),
      });
    } finally {
      setAppleHealthSubmitting(false);
    }
  }

  async function handleAppleHealthDisconnect() {
    if (!confirm(tAh("disconnect_confirm"))) return;
    setAppleHealthSubmitting(true);
    try {
      const res = await fetch("/api/cgm/source", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: null }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body?.error || tAh("http_error", { status: res.status }));
      setAppleHealthSelected(false);
      setAppleHealthMessage(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("glev:cgm-source-changed", { detail: { source: null } }),
        );
      }
    } catch (err) {
      setAppleHealthMessage({
        kind: "error",
        text: err instanceof Error ? err.message : tAh("disconnect_failed"),
      });
    } finally {
      setAppleHealthSubmitting(false);
    }
  }

  async function handleBackfillWorkouts() {
    if (!isNativePlatform) {
      setBackfillResult({
        kind: "error",
        text: tAh("backfill_only_ios"),
      });
      return;
    }
    setBackfillResult(null);
    setBackfillProgress({ daysBack: 0, inserted: 0, fetched: 0, chunks: 0 });
    setBackfillRunning(true);
    try {
      const { backfillWorkouts } = await import("@/lib/cgm/appleHealthClient");
      const res = await backfillWorkouts({
        onProgress: (p) => {
          setBackfillProgress({
            daysBack: p.daysBack,
            inserted: p.totalInserted,
            fetched: p.totalFetched,
            chunks: Math.max(1, Math.ceil(p.daysBack / 90)),
          });
        },
      });
      if (!res.ok) {
        setBackfillResult({
          kind: "error",
          text:
            res.error ||
            (res.reason === "no-permission"
              ? tAh("backfill_no_permission")
              : tAh("backfill_failed")),
        });
      } else {
        setBackfillResult({
          kind: "success",
          text:
            res.inserted > 0
              ? tAh("backfill_success_with_count", {
                  inserted: res.inserted,
                  days: Math.round(res.daysCovered),
                })
              : tAh("backfill_success_empty", {
                  days: Math.round(res.daysCovered),
                }),
        });
        await loadAppleHealthState();
      }
    } catch (err) {
      setBackfillResult({
        kind: "error",
        text: err instanceof Error ? err.message : tAh("backfill_failed"),
      });
    } finally {
      setBackfillRunning(false);
    }
  }

  async function handleBackfillSteps() {
    if (!isNativePlatform) {
      setStepsBackfillResult({
        kind: "error",
        text: t("steps.only_ios"),
      });
      return;
    }
    setStepsBackfillResult(null);
    setStepsBackfillProgress({ daysBack: 0, days: 0, upserted: 0, chunks: 0 });
    setStepsBackfillRunning(true);
    try {
      const { backfillSteps } = await import("@/lib/cgm/appleHealthClient");
      const res = await backfillSteps({
        onProgress: (p) => {
          setStepsBackfillProgress({
            daysBack: p.daysBack,
            days: p.totalDays,
            upserted: p.totalUpserted,
            chunks: Math.max(1, Math.ceil(p.daysBack / 30)),
          });
        },
      });
      if (!res.ok) {
        setStepsBackfillResult({
          kind: "error",
          text:
            res.error ||
            (res.reason === "no-permission"
              ? t("steps.no_permission")
              : t("steps.failed")),
        });
      } else {
        setStepsBackfillResult({
          kind: "success",
          text:
            res.days > 0
              ? t("steps.success_with_count", {
                  days: res.days,
                  daysCovered: Math.round(res.daysCovered),
                })
              : t("steps.success_empty", {
                  daysCovered: Math.round(res.daysCovered),
                }),
        });
      }
    } catch (err) {
      setStepsBackfillResult({
        kind: "error",
        text: err instanceof Error ? err.message : t("steps.failed"),
      });
    } finally {
      setStepsBackfillRunning(false);
    }
  }

  async function handleActivitySyncToggle(next: boolean) {
    setActivitySyncMessage(null);
    if (next && !isNativePlatform) {
      setActivitySyncMessage({ kind: "error", text: tAh("connect_only_ios") });
      return;
    }
    setActivitySyncSubmitting(true);
    try {
      if (next) {
        const { requestAuthorization } = await import("@/lib/cgm/appleHealthClient");
        const auth = await requestAuthorization();
        if (!auth.ok) {
          setActivitySyncMessage({ kind: "error", text: tAh("permission_denied") });
          return;
        }
      }
      const res = await fetch("/api/health/activity-sync", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body?.error || tAh("http_error", { status: res.status }));
      setActivitySyncEnabled(next);
      setActivitySyncMessage(null);
    } catch (err) {
      setActivitySyncMessage({
        kind: "error",
        text: err instanceof Error ? err.message : tAh("connect_failed"),
      });
    } finally {
      setActivitySyncSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.6,
          background: "var(--surface-soft)",
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        {tAh("description")}
      </div>

      {!isNativePlatform && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-dim)",
            background: "var(--surface-soft)",
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          {tAh("web_preview_hint")}
        </div>
      )}

      {/* BG source section label */}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>
        {tAh("bg_source_section_label")}
      </div>

      {/* Source toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 14px",
          borderRadius: 10,
          border: `1px solid ${BORDER}`,
          background: "var(--surface-soft)",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>
          {tAh("source_toggle_label")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={appleHealthSelected}
          disabled={appleHealthSubmitting}
          onClick={() =>
            appleHealthSelected
              ? void handleAppleHealthDisconnect()
              : void handleAppleHealthConnect()
          }
          style={{
            position: "relative",
            width: 50,
            height: 28,
            borderRadius: 14,
            border: "none",
            background: appleHealthSelected ? GREEN : "var(--border)",
            cursor: appleHealthSubmitting ? "wait" : "pointer",
            flexShrink: 0,
            transition: "background 0.2s",
            opacity: appleHealthSubmitting ? 0.5 : 1,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: appleHealthSelected ? 25 : 3,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>

      {appleHealthPermissionDenied && isNativePlatform && (
        <div
          style={{
            fontSize: 13,
            color: PINK,
            background: `${PINK}10`,
            border: `1px solid ${PINK}30`,
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span>{tAh("permission_denied")}</span>
          <button
            type="button"
            onClick={() =>
              window.open("App-Prefs:root=Privacy&path=HEALTH", "_system")
            }
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${PINK}50`,
              background: "transparent",
              color: PINK,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {tAh("open_ios_settings")}
          </button>
        </div>
      )}

      {appleHealthSelected && appleHealthPermissionRevoked && (
        <div
          style={{
            fontSize: 13,
            color: "var(--orange, #F5A623)",
            background: "rgba(245,166,35,0.10)",
            border: "1px solid rgba(245,166,35,0.30)",
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          {tAh("permission_revoked")}
        </div>
      )}

      {appleHealthSelected && appleHealthStatus && !appleHealthPermissionRevoked && (() => {
        const { lastTimestamp, lastValueMgDl, lastTrend, count, lastBackgroundTimestamp } = appleHealthStatus;
        const ageMs = lastTimestamp ? Date.now() - Date.parse(lastTimestamp) : null;
        const ageMin = ageMs != null ? Math.floor(ageMs / 60_000) : null;
        const dotColor =
          ageMin == null ? "var(--text-dim)"
          : ageMin < 5  ? "#22D3A0"
          : ageMin < 15 ? "#F5A623"
          : "#FF2D78";
        const TREND_ARROWS: Record<string, string> = {
          stable: "→",
          rising: "↗",
          risingQuickly: "↑",
          falling: "↘",
          fallingQuickly: "↓",
        };
        const arrow = lastTrend ? (TREND_ARROWS[lastTrend] ?? "→") : null;
        const freshnessLabel =
          ageMin == null ? ""
          : ageMin < 5  ? tAh("freshness_fresh")
          : ageMin < 15 ? tAh("freshness_stale", { n: ageMin })
          : tAh("freshness_old");

        const BG_WARN_MS = 6 * 60 * 60 * 1000;
        const bgAgeMs = lastBackgroundTimestamp
          ? Date.now() - Date.parse(lastBackgroundTimestamp)
          : null;
        const bgStale = bgAgeMs == null || bgAgeMs > BG_WARN_MS;
        const bgLabel = lastBackgroundTimestamp
          ? formatRelativeAge(lastBackgroundTimestamp, tAh)
          : tAh("bg_delivery_never");

        return (
          <>
            <div
              style={{
                background: "var(--card-bg, var(--surface))",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              {lastValueMgDl != null ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${dotColor}80`,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 22,
                      fontWeight: 600,
                      letterSpacing: "-0.5px",
                      color: "var(--text)",
                      lineHeight: 1,
                    }}
                  >
                    {glucoseUnit === "mmol/L"
                      ? `${mgdlToMmol(lastValueMgDl)} mmol/L`
                      : `${lastValueMgDl} mg/dL`}
                  </span>
                  {arrow && (
                    <span
                      style={{
                        fontSize: 20,
                        color: "var(--text-dim)",
                        lineHeight: 1,
                      }}
                    >
                      {arrow}
                    </span>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-dim)",
                    marginBottom: 4,
                  }}
                >
                  {tAh("status_connected_no_values")}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>
                {tAh("status_count", { count })}
                {freshnessLabel ? ` · ${tAh("fg_sync_label")} ${freshnessLabel}` : ""}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: bgStale ? "#F5A623" : "var(--text-dim)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span>{bgStale ? "⚠️" : "✓"}</span>
                <span>{tAh("bg_delivery_label")} {bgLabel}</span>
              </div>
            </div>

            {bgStale && (
              <div
                style={{
                  marginTop: 8,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "#F5A62318",
                  border: "1px solid #F5A62350",
                  fontSize: 13,
                  color: "#F5A623",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {tAh("bg_warn_title")}
                </div>
                <div style={{ color: "var(--text-muted, var(--text-dim))" }}>
                  {tAh("bg_warn_body")}
                </div>
                <button
                  type="button"
                  style={{
                    marginTop: 8,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #F5A62370",
                    background: "transparent",
                    color: "#F5A623",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: appleHealthSubmitting ? "wait" : "pointer",
                    opacity: appleHealthSubmitting ? 0.6 : 1,
                  }}
                  disabled={appleHealthSubmitting}
                  onClick={async () => {
                    if (!isNativePlatform) return;
                    setAppleHealthSubmitting(true);
                    try {
                      const { requestAuthorization } = await import(
                        "@/lib/cgm/appleHealthClient"
                      );
                      const auth = await requestAuthorization();
                      if (auth.ok) {
                        setAppleHealthMessage({
                          kind: "success",
                          text: tAh("bg_rearm_success"),
                        });
                      } else {
                        setAppleHealthMessage({
                          kind: "error",
                          text: tAh("permission_denied"),
                        });
                      }
                      await loadAppleHealthState();
                    } catch {
                      /* silent */
                    } finally {
                      setAppleHealthSubmitting(false);
                    }
                  }}
                >
                  {tAh("bg_rearm_btn")}
                </button>
              </div>
            )}
          </>
        );
      })()}

      <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleAppleHealthConnect}
          disabled={!isNativePlatform || appleHealthSubmitting || appleHealthSelected}
          title={!isNativePlatform ? tAh("ios_only_tooltip") : undefined}
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: "none",
            cursor: !isNativePlatform || appleHealthSelected
              ? "not-allowed"
              : appleHealthSubmitting
              ? "wait"
              : "pointer",
            background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 700,
            boxShadow: `0 4px 20px ${ACCENT}40`,
            opacity: !isNativePlatform || appleHealthSubmitting || appleHealthSelected ? 0.5 : 1,
          }}
        >
          {appleHealthSubmitting
            ? tAh("btn_connecting")
            : appleHealthSelected
            ? tAh("btn_sync_now")
            : tAh("btn_connect")}
        </button>
        {appleHealthSelected && (
          <button
            type="button"
            onClick={handleAppleHealthDisconnect}
            disabled={appleHealthSubmitting}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: `1px solid ${PINK}50`,
              background: "transparent",
              color: PINK,
              fontSize: 14,
              fontWeight: 600,
              cursor: appleHealthSubmitting ? "wait" : "pointer",
            }}
          >
            {tAh("btn_disconnect")}
          </button>
        )}
      </div>

      {appleHealthMessage && (
        <div
          style={{
            fontSize: 14,
            color:
              appleHealthMessage.kind === "success"
                ? GREEN
                : appleHealthMessage.kind === "error"
                ? PINK
                : "var(--text-dim)",
            marginTop: 4,
          }}
        >
          {appleHealthMessage.text}
        </div>
      )}

      {/* ── Activity Sync section (independent of glucose source) ── */}
      <div
        style={{
          borderTop: `1px solid ${BORDER}`,
          paddingTop: 16,
          marginTop: 4,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          {tAh("activity_sync_section_label")}
        </div>

        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            lineHeight: 1.6,
            background: "var(--surface-soft)",
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          {tAh("activity_sync_description")}
        </div>

        {/* Activity sync toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: "var(--surface-soft)",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>
            {tAh("activity_sync_toggle_label")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={activitySyncEnabled}
            disabled={activitySyncSubmitting}
            onClick={() => void handleActivitySyncToggle(!activitySyncEnabled)}
            style={{
              position: "relative",
              width: 50,
              height: 28,
              borderRadius: 14,
              border: "none",
              background: activitySyncEnabled ? GREEN : "var(--border)",
              cursor: activitySyncSubmitting ? "wait" : "pointer",
              flexShrink: 0,
              transition: "background 0.2s",
              opacity: activitySyncSubmitting ? 0.5 : 1,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: activitySyncEnabled ? 25 : 3,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                transition: "left 0.2s",
              }}
            />
          </button>
        </div>

        {activitySyncMessage && (
          <div
            style={{
              fontSize: 13,
              color: activitySyncMessage.kind === "success" ? GREEN : PINK,
            }}
          >
            {activitySyncMessage.text}
          </div>
        )}

        {/* Backfill buttons — visible when activity sync is enabled */}
        {activitySyncEnabled && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${BORDER}`,
              background: "var(--surface-soft)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text)" }}>
                {tAh("backfill_heading")}
              </strong>
              <div style={{ marginTop: 4 }}>
                {tAh("backfill_description")}
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={handleBackfillWorkouts}
                disabled={!isNativePlatform || backfillRunning}
                title={!isNativePlatform ? tAh("ios_only_tooltip") : undefined}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: `1px solid ${ACCENT}80`,
                  background: "transparent",
                  color: ACCENT,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: !isNativePlatform
                    ? "not-allowed"
                    : backfillRunning
                    ? "wait"
                    : "pointer",
                  opacity: !isNativePlatform || backfillRunning ? 0.5 : 1,
                }}
              >
                {backfillRunning
                  ? tAh("backfill_btn_running")
                  : tAh("backfill_btn_idle")}
              </button>
            </div>
            {backfillRunning && backfillProgress && (
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {tAh("backfill_progress", {
                  inserted: backfillProgress.inserted,
                  fetched: backfillProgress.fetched,
                  daysBack: backfillProgress.daysBack,
                  chunks: backfillProgress.chunks,
                })}
              </div>
            )}
            {!backfillRunning && backfillResult && (
              <div
                style={{
                  fontSize: 13,
                  color: backfillResult.kind === "success" ? GREEN : PINK,
                }}
              >
                {backfillResult.text}
              </div>
            )}
            {workoutsRange && workoutsRange.count > 0 && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  borderTop: `1px dashed ${BORDER}`,
                  paddingTop: 8,
                  marginTop: 2,
                }}
              >
                {tAh("workouts_range", {
                  oldest: workoutsRange.oldest
                    ? formatLocalDate(workoutsRange.oldest)
                    : "—",
                  newest: workoutsRange.newest
                    ? formatLocalDate(workoutsRange.newest)
                    : "—",
                  count: workoutsRange.count,
                })}
              </div>
            )}
            {workoutsRange && workoutsRange.count === 0 && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  borderTop: `1px dashed ${BORDER}`,
                  paddingTop: 8,
                  marginTop: 2,
                }}
              >
                {tAh("workouts_range_empty")}
              </div>
            )}

            <div
              style={{
                marginTop: 8,
                paddingTop: 12,
                borderTop: `1px solid ${BORDER}`,
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "var(--text)" }}>
                {t("steps.heading")}
              </strong>
              <div style={{ marginTop: 4 }}>
                {t("steps.description")}
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={handleBackfillSteps}
                disabled={!isNativePlatform || stepsBackfillRunning}
                title={!isNativePlatform ? t("steps.ios_only_tooltip") : undefined}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: `1px solid ${ACCENT}80`,
                  background: "transparent",
                  color: ACCENT,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: !isNativePlatform
                    ? "not-allowed"
                    : stepsBackfillRunning
                    ? "wait"
                    : "pointer",
                  opacity: !isNativePlatform || stepsBackfillRunning ? 0.5 : 1,
                }}
              >
                {stepsBackfillRunning
                  ? t("steps.btn_running")
                  : t("steps.btn_idle")}
              </button>
            </div>
            {stepsBackfillRunning && stepsBackfillProgress && (
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {t("steps.progress", {
                  days: stepsBackfillProgress.days,
                  upserted: stepsBackfillProgress.upserted,
                  daysBack: stepsBackfillProgress.daysBack,
                  chunks: stepsBackfillProgress.chunks,
                })}
              </div>
            )}
            {!stepsBackfillRunning && stepsBackfillResult && (
              <div
                style={{
                  fontSize: 13,
                  color: stepsBackfillResult.kind === "success" ? GREEN : PINK,
                }}
              >
                {stepsBackfillResult.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
