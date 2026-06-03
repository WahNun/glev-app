"use client";

import React, { useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Brand tokens (matching the ops-panel dark theme)
// ---------------------------------------------------------------------------
const BG = "#0a0a0f";
const SURFACE = "#111118";
const SURFACE2 = "#16161e";
const BORDER = "#1e1e2e";
const ACCENT = "#4F6EF7";
const TEXT = "#e2e2ef";
const TEXT_MUTED = "#8888a8";
const TEXT_FAINT = "#55556a";
const GREEN = "#22D3A0";
const RED = "#ef4444";
const AMBER = "#f59e0b";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetDef {
  name: string;
  purpose: string;
  urgency: "high" | "medium" | "low";
  url: string | null;
}

// ---------------------------------------------------------------------------
// UploadButton (per-asset)
// ---------------------------------------------------------------------------

function UploadButton({ assetName, onSuccess }: { assetName: string; onSuccess: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFile(file: File) {
    setState("uploading");
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("asset_name", assetName);
      const res = await fetch("/api/glev-ops/sound-assets/upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      setState("ok");
      onSuccess(json.url as string);
      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      setErrorMsg(String(err));
      setState("error");
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={state === "uploading"}
        style={{
          padding: "6px 14px",
          borderRadius: 7,
          background: state === "ok" ? GREEN : SURFACE2,
          border: `1px solid ${state === "error" ? RED : state === "ok" ? GREEN : BORDER}`,
          color: state === "ok" ? "#0a0a0f" : TEXT,
          fontSize: 12,
          fontWeight: 600,
          cursor: state === "uploading" ? "wait" : "pointer",
          whiteSpace: "nowrap",
          transition: "background 0.2s",
        }}
      >
        {state === "uploading" ? "Lädt…" : state === "ok" ? "✓ Hochgeladen" : "Upload WAV"}
      </button>
      {state === "error" && (
        <p style={{ fontSize: 11, color: RED, margin: "4px 0 0" }}>{errorMsg}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlayButton
// ---------------------------------------------------------------------------

function PlayButton({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    if (playing) {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => setPlaying(false);
      a.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  }

  return (
    <button
      onClick={toggle}
      style={{
        padding: "6px 14px",
        borderRadius: 7,
        background: playing ? `${ACCENT}22` : SURFACE2,
        border: `1px solid ${playing ? ACCENT : BORDER}`,
        color: playing ? ACCENT : TEXT_MUTED,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {playing ? "⏹ Stop" : "▶ Play"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DownloadButton
// ---------------------------------------------------------------------------

function DownloadButton({ url, name }: { url: string; name: string }) {
  return (
    <a
      href={url}
      download={name}
      style={{
        display: "inline-block",
        padding: "6px 14px",
        borderRadius: 7,
        background: SURFACE2,
        border: `1px solid ${BORDER}`,
        color: TEXT_MUTED,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      ↓ Download
    </a>
  );
}

// ---------------------------------------------------------------------------
// Asset row
// ---------------------------------------------------------------------------

function UrgencyBadge({ urgency }: { urgency: AssetDef["urgency"] }) {
  const cfg = {
    high: { label: "Hoch", color: RED },
    medium: { label: "Mittel", color: AMBER },
    low: { label: "Niedrig", color: TEXT_FAINT },
  }[urgency];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 20,
        background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}44`,
        color: cfg.color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {cfg.label}
    </span>
  );
}

function StatusBadge({ uploaded }: { uploaded: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 20,
        background: uploaded ? `${GREEN}18` : `${AMBER}18`,
        border: `1px solid ${uploaded ? GREEN : AMBER}44`,
        color: uploaded ? GREEN : AMBER,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 8 }}>{uploaded ? "●" : "○"}</span>
      {uploaded ? "Hochgeladen" : "Fehlt noch"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export default function SoundAssetsClient({ initialAssets }: { initialAssets: AssetDef[] }) {
  const [assets, setAssets] = useState<AssetDef[]>(initialAssets);

  function handleUploadSuccess(assetName: string, url: string) {
    setAssets((prev) =>
      prev.map((a) => (a.name === assetName ? { ...a, url } : a)),
    );
  }

  const uploaded = assets.filter((a) => a.url !== null).length;
  const total = assets.length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
            color: TEXT,
          }}
        >
          Sound Assets
        </h1>
        <p style={{ fontSize: 13, color: TEXT_MUTED, margin: 0 }}>
          WAV-Dateien für native App-Benachrichtigungen.{" "}
          {uploaded}/{total} hochgeladen. Vor jedem nativen Build{" "}
          <code
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              background: SURFACE2,
              padding: "1px 5px",
              borderRadius: 4,
              color: ACCENT,
            }}
          >
            node scripts/pull-sound-assets.mjs
          </code>{" "}
          ausführen.
        </p>
      </div>

      {/* Asset list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {assets.map((asset) => (
          <div
            key={asset.name}
            style={{
              background: SURFACE,
              border: `1px solid ${asset.url ? BORDER : `${AMBER}44`}`,
              borderRadius: 12,
              padding: "16px 20px",
            }}
          >
            {/* Top row: name + badges */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: 13,
                  fontWeight: 700,
                  color: TEXT,
                  flex: "1 1 auto",
                }}
              >
                {asset.name}
              </code>
              <UrgencyBadge urgency={asset.urgency} />
              <StatusBadge uploaded={asset.url !== null} />
            </div>

            {/* Purpose */}
            <p style={{ fontSize: 12, color: TEXT_MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              {asset.purpose}
            </p>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <UploadButton
                assetName={asset.name}
                onSuccess={(url) => handleUploadSuccess(asset.name, url)}
              />
              {asset.url && <PlayButton url={asset.url} />}
              {asset.url && <DownloadButton url={asset.url} name={asset.name} />}
            </div>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div
        style={{
          marginTop: 28,
          background: SURFACE2,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <p style={{ fontSize: 12, color: TEXT_MUTED, margin: "0 0 6px", fontWeight: 600 }}>
          Pre-Build-Checkliste
        </p>
        <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            "Alle Sound-Assets hochladen (Upload-Button oben)",
            "node scripts/pull-sound-assets.mjs  (schreibt Dateien nach android/…/res/raw/ und ios/App/App/)",
            "Android: nativen Build (Gradle) erstellen",
            "iOS: glev_low_alarm.wav manuell in Xcode → Copy Bundle Resources aufnehmen, dann Build",
          ].map((step, i) => (
            <li key={i} style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.5 }}>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
