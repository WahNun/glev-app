"use client";

import React, { useState, useRef, useEffect } from "react";

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

interface PushTemplate {
  push_title: string;
  push_body: string;
}

type AlertType = "hypo" | "hyper" | "elevated";

interface AlarmBlock {
  key: AlertType;
  label: string;
  emoji: string;
  color: string;
  defaultTitle: string;
  defaultBody: string;
}

const ALARM_BLOCKS: AlarmBlock[] = [
  {
    key: "hypo",
    label: "Hypo",
    emoji: "🔴",
    color: RED,
    defaultTitle: "🔴 Hypo-Alarm · {{value}} mg/dL",
    defaultBody: "Dein BZ liegt bei {{value}} mg/dL — prüf dich jetzt.",
  },
  {
    key: "hyper",
    label: "Hyper",
    emoji: "🟠",
    color: AMBER,
    defaultTitle: "🟠 Hyper-Alarm · {{value}} mg/dL",
    defaultBody: "Dein BZ liegt bei {{value}} mg/dL — prüf Korrektur und Mahlzeiten.",
  },
  {
    key: "elevated",
    label: "Erhöht",
    emoji: "🟡",
    color: "#eab308",
    defaultTitle: "🟡 Erhöhter BZ · {{value}} mg/dL",
    defaultBody: "Dein BZ liegt bei {{value}} mg/dL — behalte ihn im Auge.",
  },
];

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
// getAdminToken helper
// ---------------------------------------------------------------------------

function getAdminToken(): string {
  const cookiePair = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("glev_ops_token="));
  return cookiePair ? cookiePair.trim().split("=").slice(1).join("=") : "";
}

// ---------------------------------------------------------------------------
// PushTemplateBlock — one collapsible block per alarm type
// ---------------------------------------------------------------------------

function PushTemplateBlock({ block }: { block: AlarmBlock }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(block.defaultTitle);
  const [body, setBody] = useState(block.defaultBody);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [testEmail, setTestEmail] = useState("lucas@wahnon-connect.com");
  const [testSandbox, setTestSandbox] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    const token = getAdminToken();
    fetch("/api/admin/push-templates", {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const tpl = data.templates?.[`push_${block.key}`];
        if (tpl?.push_title) setTitle(tpl.push_title as string);
        if (tpl?.push_body) setBody(tpl.push_body as string);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, block.key]);

  async function save() {
    if (saveState === "saving") return;
    setSaveState("saving");
    setSaveMsg("");
    try {
      const token = getAdminToken();
      const res = await fetch("/api/admin/push-templates", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: `push_${block.key}`, push_title: title, push_body: body }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaveState("ok");
        setSaveMsg("Gespeichert");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        setSaveState("error");
        setSaveMsg(json.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setSaveState("error");
      setSaveMsg(String(err));
    }
  }

  async function sendTest() {
    if (testState === "sending") return;
    setTestState("sending");
    setTestMsg("");
    try {
      const token = getAdminToken();
      const res = await fetch("/api/admin/push-test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: testEmail,
          sandbox: testSandbox,
          alertType: block.key,
        }),
      });
      const rawText = await res.text();
      let json: { ok?: boolean; error?: string; platform?: string; detail?: string; [k: string]: unknown } | null = null;
      try { json = JSON.parse(rawText); } catch { /* not JSON */ }

      if (json?.ok) {
        setTestState("ok");
        setTestMsg(`✅ Gesendet (${json.platform ?? "?"}, sandbox=${testSandbox})`);
      } else if (json) {
        const detail = typeof json.error === "string"
          ? json.error + (typeof json.detail === "string" && json.detail ? ` → ${json.detail}` : "")
          : JSON.stringify(json).slice(0, 300);
        setTestState("error");
        setTestMsg(`❌ HTTP ${res.status} — ${detail}`);
      } else {
        setTestState("error");
        setTestMsg(`❌ HTTP ${res.status} — Server-Antwort kein JSON:\n${rawText.slice(0, 300)}`);
      }
    } catch (err) {
      setTestState("error");
      setTestMsg(`❌ Netzwerkfehler: ${String(err)}`);
    }
  }

  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${open ? block.color + "44" : BORDER}`,
        borderRadius: 10,
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "14px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 16 }}>{block.emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: TEXT, flex: 1 }}>{block.label}</span>
        <span style={{ fontSize: 12, color: TEXT_MUTED }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${BORDER}` }}>
          {/* Titel */}
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, color: TEXT_MUTED, display: "block", marginBottom: 4 }}>
              Titel <span style={{ color: TEXT_FAINT }}>({"{{value}}"} = mg/dL-Wert)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: SURFACE2,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                color: TEXT,
                fontSize: 13,
                fontFamily: "system-ui, sans-serif",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Body */}
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, color: TEXT_MUTED, display: "block", marginBottom: 4 }}>
              Text <span style={{ color: TEXT_FAINT }}>({"{{value}}"} = mg/dL-Wert)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: SURFACE2,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                color: TEXT,
                fontSize: 13,
                fontFamily: "system-ui, sans-serif",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Save button */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={save}
              disabled={saveState === "saving"}
              style={{
                padding: "8px 16px",
                borderRadius: 7,
                background: saveState === "ok" ? GREEN : saveState === "error" ? `${RED}22` : ACCENT,
                border: `1px solid ${saveState === "ok" ? GREEN : saveState === "error" ? RED : ACCENT}`,
                color: saveState === "ok" ? "#0a0a0f" : TEXT,
                fontSize: 13,
                fontWeight: 600,
                cursor: saveState === "saving" ? "wait" : "pointer",
              }}
            >
              {saveState === "saving" ? "Speichert…" : saveState === "ok" ? "✓ Gespeichert" : "Speichern"}
            </button>
            {saveMsg && (
              <span style={{ fontSize: 12, color: saveState === "error" ? RED : GREEN }}>{saveMsg}</span>
            )}
          </div>

          {/* Divider */}
          <div style={{ margin: "16px 0", height: 1, background: BORDER }} />

          {/* Test section */}
          <p style={{ fontSize: 12, color: TEXT_MUTED, margin: "0 0 10px", fontWeight: 600 }}>
            Test-Push senden
          </p>

          <label style={{ fontSize: 12, color: TEXT_MUTED, display: "block", marginBottom: 4 }}>
            E-Mail des Users
          </label>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            style={{
              padding: "7px 10px",
              background: SURFACE2,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              color: TEXT,
              fontSize: 13,
              width: "100%",
              maxWidth: 300,
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />

          <label style={{ fontSize: 12, color: TEXT_MUTED, display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={testSandbox}
              onChange={(e) => setTestSandbox(e.target.checked)}
            />
            Sandbox (nur Xcode-Direkt-Builds; TestFlight = unchecked)
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={sendTest}
              disabled={testState === "sending" || !testEmail.trim()}
              style={{
                padding: "8px 14px",
                borderRadius: 7,
                background: testState === "sending" ? SURFACE2 : SURFACE2,
                border: `1px solid ${testState === "ok" ? GREEN : testState === "error" ? RED : block.color + "66"}`,
                color: testState === "ok" ? GREEN : testState === "error" ? RED : TEXT,
                fontSize: 12,
                fontWeight: 600,
                cursor: testState === "sending" || !testEmail.trim() ? "not-allowed" : "pointer",
              }}
            >
              {testState === "sending" ? "Sende…" : `${block.emoji} Test senden`}
            </button>
          </div>

          {testMsg && (
            <p style={{
              fontSize: 12,
              margin: "8px 0 0",
              padding: "7px 10px",
              borderRadius: 6,
              background: testState === "ok" ? `${GREEN}18` : `${RED}18`,
              color: testState === "ok" ? GREEN : RED,
              border: `1px solid ${testState === "ok" ? GREEN : RED}44`,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {testMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PushTemplatesCard
// ---------------------------------------------------------------------------

function PushTemplatesCard() {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
            color: TEXT,
          }}
        >
          Push-Texte
        </h2>
        <p style={{ fontSize: 13, color: TEXT_MUTED, margin: 0, lineHeight: 1.5 }}>
          Titel und Text der Push-Benachrichtigungen für Alarm-Typen bearbeiten.
          Änderungen greifen sofort in den Edge Functions.{" "}
          <code
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              background: SURFACE2,
              padding: "1px 5px",
              borderRadius: 4,
              color: TEXT_FAINT,
            }}
          >
            {"{{value}}"}
          </code>{" "}
          wird zur Laufzeit durch den aktuellen CGM-Wert ersetzt.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ALARM_BLOCKS.map((block) => (
          <PushTemplateBlock key={block.key} block={block} />
        ))}
      </div>
    </div>
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

      {/* Push-Texte card */}
      <PushTemplatesCard />

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
