"use client";

import { useState } from "react";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";

export type CgmFetchResult =
  | { ok: true; value: number; timestamp: string | null }
  | { ok: false; status: number; message: string };

export async function fetchLatestCgm(): Promise<CgmFetchResult> {
  try {
    const res = await fetch("/api/cgm/latest", { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      const msg =
        (body && typeof body.error === "string" && body.error) ||
        (res.status === 404 ? "No CGM credentials configured. Connect LibreLinkUp in Settings." :
         res.status === 502 ? "CGM service unavailable. Try again in a moment." :
         "Could not load CGM reading.");
      return { ok: false, status: res.status, message: msg };
    }
    const data = (await res.json()) as { current?: { value?: number; unit?: string; timestamp?: string | null; trend?: number } | null };
        const val = data?.current?.value;
        if (typeof val !== "number") {
          return { ok: false, status: 502, message: "CGM returned no recent reading." };
        }
        return { ok: true, value: val, timestamp: data.current?.timestamp ?? null };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Could not load CGM reading." };
  }
}

export default function CgmFetchButton({
  onResult,
  size = "md",
  label = "CGM",
  title = "Refresh latest CGM reading",
}: {
  onResult: (r: CgmFetchResult) => void;
  size?: "sm" | "md";
  label?: string;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  // `errMsg` is null whenever the last fetch succeeded — even if the value
  // didn't change. The dot only turns red when we *actually* failed to
  // contact the CGM (network drop, 4xx/5xx response, missing credentials).
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);

  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    const r = await fetchLatestCgm();
    setLoading(false);
    if (r.ok) {
      // Successful fetch — clear any prior error and let the parent decide
      // whether to update the displayed glucose. We never overwrite the
      // displayed value here; the parent compares against its own state.
      setErrMsg(null);
    } else {
      setErrMsg(r.message || "Could not reach the CGM service.");
    }
    onResult(r);
  }

  const small = size === "sm";
  const hasErr = errMsg != null;
  const dotColor = hasErr ? PINK : GREEN;

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start", maxWidth: "100%" }}>
      <button
        onClick={run}
        disabled={loading}
        title={hasErr ? errMsg! : title}
        aria-label={hasErr ? `Retry CGM fetch — last error: ${errMsg}` : title}
        style={{
          padding: small ? "0 10px" : "0 14px",
          height: small ? 28 : 36,
          borderRadius: small ? 8 : 10,
          border: `1px solid ${hasErr ? `${PINK}55` : `${ACCENT}44`}`,
          background: loading ? "rgba(255,255,255,0.04)" : hasErr ? `${PINK}14` : `${ACCENT}18`,
          color: hasErr ? PINK : ACCENT,
          cursor: loading ? "default" : "pointer",
          fontSize: small ? 10 : 11,
          fontWeight: 700,
          whiteSpace: "nowrap",
          letterSpacing: "0.04em",
          display: "inline-flex",
          alignItems: "center",
          gap: small ? 5 : 6,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: small ? 6 : 8,
            height: small ? 6 : 8,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 5px ${dotColor}88`,
            flexShrink: 0,
          }}
        />
        {loading ? (
          <div
            style={{
              width: small ? 10 : 12,
              height: small ? 10 : 12,
              border: `1.5px solid ${(hasErr ? PINK : ACCENT)}44`,
              borderTopColor: hasErr ? PINK : ACCENT,
              borderRadius: "50%",
              animation: "cgmspin 0.7s linear infinite",
            }}
          />
        ) : (
          <svg
            width={small ? 10 : 12}
            height={small ? 10 : 12}
            viewBox="0 0 24 24"
            fill="none"
            stroke={hasErr ? PINK : ACCENT}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-3.1-6.8" />
            <polyline points="21 4 21 10 15 10" />
          </svg>
        )}
        {label}
        <style>{`@keyframes cgmspin{to{transform:rotate(360deg)}}`}</style>
      </button>
      {hasErr && (
        <div
          role="alert"
          style={{
            fontSize: small ? 10 : 11,
            color: PINK,
            lineHeight: 1.35,
            maxWidth: 260,
          }}
        >
          {errMsg}
        </div>
      )}
        {!hasErr && lastTimestamp && (
          <div
            style={{
              fontSize: small ? 9 : 10,
              color: "#6B7280",
              marginTop: 3,
              letterSpacing: "0.02em",
            }}
          >
            {"Letzter Wert: "}
            {new Date(lastTimestamp).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
    </div>
  );
}
