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
    const data = (await res.json()) as { value?: number | null; timestamp?: string | null };
    if (typeof data.value !== "number") {
      return { ok: false, status: 502, message: "CGM returned no recent reading." };
    }
    return { ok: true, value: data.value, timestamp: data.timestamp ?? null };
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
  const [err, setErr] = useState(false);

  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    const r = await fetchLatestCgm();
    setErr(!r.ok);
    setLoading(false);
    onResult(r);
  }

  const small = size === "sm";
  return (
    <button
      onClick={run}
      disabled={loading}
      title={title}
      style={{
        padding: small ? "0 10px" : "0 14px",
        height: small ? 28 : 36,
        borderRadius: small ? 8 : 10,
        border: `1px solid ${ACCENT}44`,
        background: loading ? "rgba(255,255,255,0.04)" : `${ACCENT}18`,
        color: ACCENT,
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
          background: err ? PINK : GREEN,
          boxShadow: `0 0 5px ${err ? PINK : GREEN}88`,
          flexShrink: 0,
        }}
      />
      {loading ? (
        <div
          style={{
            width: small ? 10 : 12,
            height: small ? 10 : 12,
            border: `1.5px solid ${ACCENT}44`,
            borderTopColor: ACCENT,
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
          stroke={ACCENT}
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
  );
}
