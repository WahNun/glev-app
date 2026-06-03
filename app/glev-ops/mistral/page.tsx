"use client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  getTtsConfig,
  uploadRefAudio,
  deleteRefAudio,
  getAgentPrompt,
  saveAgentPrompt,
  resetAgentPrompt,
  getPromptVersions,
  getStylePrefix,
  saveStylePrefix,
  resetStylePrefix,
} from "./actions";
import {
  DEFAULT_STYLE_PREFIX,
  type TtsConfig,
  type AgentPromptConfig,
  type PromptVersion,
  type StylePrefixConfig,
} from "./types";

const S = {
  page: { maxWidth: 780, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif", color: "#111" } as React.CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 4 } as React.CSSProperties,
  sub: { fontSize: 13, color: "#666", marginBottom: 32 } as React.CSSProperties,
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px", marginBottom: 24 } as React.CSSProperties,
  cardTitle: { fontSize: 13, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#888", marginBottom: 12 },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const },
  label: { fontSize: 13, color: "#555", minWidth: 100 } as React.CSSProperties,
  val: { fontSize: 13, fontWeight: 600, color: "#111" } as React.CSSProperties,
  badge: (ok: boolean): React.CSSProperties => ({
    display: "inline-block", padding: "2px 10px", borderRadius: 20,
    fontSize: 11, fontWeight: 700,
    background: ok ? "#dcfce7" : "#fee2e2",
    color: ok ? "#166534" : "#991b1b",
  }),
  btn: { padding: "7px 14px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  btnPrimary: { background: "#2563eb", color: "#fff" } as React.CSSProperties,
  btnDanger: { background: "#dc2626", color: "#fff" } as React.CSSProperties,
  btnGhost: { background: "#f3f4f6", color: "#374151" } as React.CSSProperties,
  err: { marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: 12 } as React.CSSProperties,
  ok: { marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontSize: 12 } as React.CSSProperties,
  textarea: { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace", resize: "vertical" as const, boxSizing: "border-box" as const },
  fileInput: { fontSize: 13, padding: "6px 0" } as React.CSSProperties,
};

export default function MistralTTSPage() {
  const [cfg, setCfg] = useState<TtsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testText, setTestText] = useState("Dein Blutzucker liegt bei 104 mg/dL — gut im Zielbereich.");
  const [testAudio, setTestAudio] = useState<string | null>(null);
  const [skipStylePrefix, setSkipStylePrefix] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPending, startTransition] = useTransition();

  // Style-Prefix state
  const [styleCfg, setStyleCfg] = useState<StylePrefixConfig | null>(null);
  const [styleText, setStyleText] = useState(DEFAULT_STYLE_PREFIX);
  const [styleMsg, setStyleMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isStylePending, startStyleTransition] = useTransition();

  // Prompt state
  const [promptCfg, setPromptCfg] = useState<AgentPromptConfig | null>(null);
  const [promptText, setPromptText] = useState("");
  const [promptMsg, setPromptMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isPromptPending, startPromptTransition] = useTransition();

  // Version history state
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    getTtsConfig()
      .then(c => { setCfg(c); })
      .catch((e: unknown) => { setMsg({ type: "err", text: `Fehler: ${String(e)}` }); })
      .finally(() => setLoading(false));
  };

  const reloadStyle = () => {
    getStylePrefix().then(s => {
      if (s) {
        setStyleCfg(s);
        setStyleText(s.text);
      }
    });
  };

  const reloadPrompt = () => {
    getAgentPrompt().then(p => {
      if (p) {
        setPromptCfg(p);
        setPromptText(p.promptText);
      }
    });
    setHistoryPage(0);
    getPromptVersions(0).then(res => {
      if (res) {
        setVersions(res.versions);
        setHistoryHasMore(res.hasMore);
      }
    });
  };

  const loadMoreHistory = () => {
    const nextPage = historyPage + 1;
    setIsHistoryLoading(true);
    getPromptVersions(nextPage).then(res => {
      if (res) {
        setVersions(prev => [...prev, ...res.versions]);
        setHistoryHasMore(res.hasMore);
        setHistoryPage(nextPage);
      }
      setIsHistoryLoading(false);
    });
  };

  useEffect(() => {
    reload();
    reloadStyle();
    reloadPrompt();
  }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const flashStyle = (type: "ok" | "err", text: string) => {
    setStyleMsg({ type, text });
    setTimeout(() => setStyleMsg(null), 5000);
  };

  const handleSaveStyle = () => {
    startStyleTransition(async () => {
      const res = await saveStylePrefix(styleText);
      if (res.ok) {
        flashStyle("ok", "Style-Prefix gespeichert ✓");
        reloadStyle();
      } else {
        flashStyle("err", res.error ?? "Fehler");
      }
    });
  };

  const handleResetStyle = () => {
    if (!confirm("Style-Prefix auf den hardcoded Default zurücksetzen?")) return;
    startStyleTransition(async () => {
      const res = await resetStylePrefix();
      if (res.ok) {
        flashStyle("ok", "Style-Prefix auf Default zurückgesetzt ✓");
        reloadStyle();
      } else {
        flashStyle("err", res.error ?? "Fehler");
      }
    });
  };

  const flashPrompt = (type: "ok" | "err", text: string) => {
    setPromptMsg({ type, text });
    setTimeout(() => setPromptMsg(null), 5000);
  };

  const handleUpload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await uploadRefAudio(fd);
      if (res.ok) { flash("ok", "Referenz-Audio hochgeladen ✓"); reload(); }
      else flash("err", res.error ?? "Fehler");
    });
  };

  const handleDelete = () => {
    if (!confirm("Referenz-Audio wirklich löschen?")) return;
    startTransition(async () => {
      const res = await deleteRefAudio();
      if (res.ok) { flash("ok", "Gelöscht."); reload(); }
      else flash("err", res.error ?? "Fehler");
    });
  };

  const handleTest = () => {
    setTestAudio(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/tts/mistral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: testText, skip_style_prefix: skipStylePrefix }),
          credentials: "include",
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const detail = errJson?.detail ? ` — ${errJson.detail}` : "";
          flash("err", (errJson?.error ?? `TTS-Fehler (${res.status})`) + detail);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setTestAudio(url);
        setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 100);
      } catch (e) {
        flash("err", e instanceof Error ? e.message : "Netzwerkfehler");
      }
    });
  };

  const handleSavePrompt = () => {
    startPromptTransition(async () => {
      const res = await saveAgentPrompt(promptText, "admin");
      if (res.ok) {
        flashPrompt("ok", "Prompt gespeichert ✓");
        reloadPrompt();
      } else {
        flashPrompt("err", res.error ?? "Fehler");
      }
    });
  };

  const handleResetPrompt = () => {
    if (!confirm("Prompt auf den hardcoded Default zurücksetzen?")) return;
    startPromptTransition(async () => {
      const res = await resetAgentPrompt("admin");
      if (res.ok) {
        flashPrompt("ok", "Prompt auf Default zurückgesetzt ✓");
        reloadPrompt();
      } else {
        flashPrompt("err", res.error ?? "Fehler");
      }
    });
  };

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#888", fontFamily: "system-ui" }}>Lade…</div>;
  if (!cfg) return <div style={{ padding: 48, textAlign: "center", color: "#dc2626", fontFamily: "system-ui" }}>Nicht eingeloggt oder Datenbankfehler.</div>;

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Mistral TTS — Referenzstimme</h1>
      <p style={S.sub}>
        Die Referenz-Audio-Datei wird bei jedem TTS-Request als <code>ref_audio</code> an Mistral Voxtral gesendet
        und klont die Stimme des Sprechenden. Kein Upload → Fallback auf <code>voice_id</code> oder Env-Var.
      </p>

      {/* Status */}
      <div style={S.card}>
        <div style={S.cardTitle}>Aktueller Status</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={S.row}>
            <span style={S.label}>Referenz-Audio</span>
            <span style={S.badge(cfg.hasRefAudio)}>{cfg.hasRefAudio ? "Hinterlegt ✓" : "Kein Audio"}</span>
          </div>
          <div style={S.row}>
            <span style={S.label}>Modell</span>
            <span style={S.val}>{cfg.model}</span>
          </div>
          {cfg.voiceId && (
            <div style={S.row}>
              <span style={S.label}>Voice ID</span>
              <span style={S.val}>{cfg.voiceId}</span>
            </div>
          )}
          {cfg.updatedAt && (
            <div style={S.row}>
              <span style={S.label}>Zuletzt geändert</span>
              <span style={{ fontSize: 13, color: "#777" }}>{new Date(cfg.updatedAt).toLocaleString("de-DE")}</span>
            </div>
          )}
        </div>

        {/* Inline preview player if audio is stored */}
        {cfg.hasRefAudio && cfg.refAudioPreviewB64 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Vorschau (hinterlegtes Audio):</div>
            <audio
              controls
              src={`data:audio/mpeg;base64,${cfg.refAudioPreviewB64}`}
              style={{ width: "100%", maxWidth: 420 }}
            />
          </div>
        )}

        {cfg.hasRefAudio && (
          <div style={{ marginTop: 16 }}>
            <button
              style={{ ...S.btn, ...S.btnDanger, opacity: isPending ? 0.6 : 1 }}
              onClick={handleDelete}
              disabled={isPending}
            >
              Referenz-Audio löschen
            </button>
          </div>
        )}
      </div>

      {/* Upload */}
      <div style={S.card}>
        <div style={S.cardTitle}>{cfg.hasRefAudio ? "Referenz-Audio ersetzen" : "Referenz-Audio hochladen"}</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          Erlaubte Formate: <strong>wav, mp3, flac, opus, ogg, pcm</strong> · Max. 5 MB<br />
          Empfehlung: 10–30 s saubere Aufnahme der Stimme, die Glev klingen soll.
        </p>
        <form onSubmit={handleUpload}>
          <input type="file" name="audio" accept=".wav,.mp3,.flac,.opus,.ogg,.pcm,audio/*" required style={S.fileInput} />
          <div style={{ marginTop: 12 }}>
            <button
              type="submit"
              style={{ ...S.btn, ...S.btnPrimary, opacity: isPending ? 0.6 : 1 }}
              disabled={isPending}
            >
              {isPending ? "Wird hochgeladen…" : "Hochladen"}
            </button>
          </div>
        </form>
        {msg && <div style={msg.type === "ok" ? S.ok : S.err}>{msg.text}</div>}
      </div>

      {/* Test Player */}
      <div style={S.card}>
        <div style={S.cardTitle}>Stimme live anhören</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          Ruft <code>/api/tts/mistral</code> auf — exakt wie echte Nutzer es hören.
          {cfg.hasRefAudio
            ? " ✦ ref_audio aktiv → Style-Prefix weiterhin aktiv (verbessert Natürlichkeit auch beim Stimm-Klon)."
            : " Style-Prefix aktiv."}
        </p>
        <textarea
          style={S.textarea}
          rows={3}
          value={testText}
          onChange={e => setTestText(e.target.value)}
          placeholder="Test-Text…"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "#555", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={skipStylePrefix}
            onChange={e => setSkipStylePrefix(e.target.checked)}
          />
          Style-Prefix überspringen (A/B-Vergleich)
        </label>
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: isPending ? 0.6 : 1 }}
            onClick={handleTest}
            disabled={isPending || !testText.trim()}
          >
            {isPending ? "Generiere…" : "▶ Vorschau abspielen"}
          </button>
          {testAudio && (
            <audio ref={audioRef} controls src={testAudio} style={{ flex: 1, minWidth: 200 }} />
          )}
        </div>
      </div>

      {/* Info */}
      <div style={{ ...S.card, background: "#f8fafc" }}>
        <div style={S.cardTitle}>Wie funktioniert es?</div>
        <p style={{ fontSize: 12, color: "#555", lineHeight: 1.6, margin: 0 }}>
          Wenn du eine Audio-Datei hochlädst, wird sie als Base64 in der Datenbank gespeichert
          (Tabelle <code>admin_tts_config</code>, Spalte <code>ref_audio</code>).<br /><br />
          Die TTS-Route <code>/api/tts/mistral</code> lädt diesen Wert bei jedem Request und
          sendet ihn als <code>ref_audio</code> an Mistral Voxtral — dadurch klingt die App
          immer mit der gleichen Stimme, egal welcher Nutzer fragt.<br /><br />
          <strong>Priorität:</strong> ref_audio (diese Seite) → voice_id (DB) → Env-Var MISTRAL_TTS_VOICE_ID → Mistral-Standard.
        </p>
      </div>

      {/* ── Style-Prefix ─────────────────────────────────────────────── */}
      <div style={{ ...S.card, marginTop: 40 }}>
        <div style={S.cardTitle}>TTS Style-Prefix</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
          Dieser Text wird vor jede TTS-Anfrage gesetzt und steuert den Sprechstil (Voxtral ist LLM-basiert und reagiert auf solche Anweisungen).
          Änderungen wirken sofort ohne Redeploy — der TTS-Endpunkt lädt den Wert zur Laufzeit aus der Datenbank.
        </p>

        {styleCfg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <div style={S.row}>
              <span style={S.label}>Status</span>
              <span style={S.badge(!styleCfg.isDefault)}>
                {styleCfg.isDefault ? "Hardcoded Default" : "In Datenbank"}
              </span>
            </div>
            {!styleCfg.isDefault && styleCfg.updatedAt && (
              <div style={S.row}>
                <span style={S.label}>Zuletzt gespeichert</span>
                <span style={{ fontSize: 13, color: "#777" }}>
                  {new Date(styleCfg.updatedAt).toLocaleString("de-DE")}
                </span>
              </div>
            )}
          </div>
        )}

        <textarea
          style={{ ...S.textarea, minHeight: 100 }}
          value={styleText}
          onChange={e => setStyleText(e.target.value)}
          placeholder="Style-Prefix…"
          spellCheck={false}
        />

        <div style={{ fontSize: 11, color: "#999", marginTop: 4, textAlign: "right" }}>
          {styleText.length.toLocaleString("de-DE")} / 2000 Zeichen
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: isStylePending ? 0.6 : 1 }}
            onClick={handleSaveStyle}
            disabled={isStylePending || !styleText.trim()}
          >
            {isStylePending ? "Speichert…" : "Style-Prefix speichern"}
          </button>
          <button
            style={{ ...S.btn, ...S.btnGhost, opacity: isStylePending ? 0.6 : 1 }}
            onClick={handleResetStyle}
            disabled={isStylePending}
          >
            Auf Default zurücksetzen
          </button>
        </div>

        {styleMsg && (
          <div style={styleMsg.type === "ok" ? S.ok : S.err}>{styleMsg.text}</div>
        )}

        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Hardcoded Default (Fallback)</div>
          <div style={{ fontSize: 12, color: "#555", fontFamily: "ui-monospace, 'Cascadia Code', monospace", lineHeight: 1.5 }}>
            {DEFAULT_STYLE_PREFIX}
          </div>
        </div>
      </div>

      {/* ── AI Agent Prompt ──────────────────────────────────────────── */}
      <div style={{ ...S.card, marginTop: 40 }}>
        <div style={S.cardTitle}>Glev AI Agent Prompt</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 16, lineHeight: 1.6 }}>
          Der System-Prompt steuert das Verhalten des Glev-Chat-Assistenten (Mistral).
          Änderungen wirken sofort ohne Redeploy — der Chat-Endpunkt lädt den Prompt zur Laufzeit aus der Datenbank.
        </p>

        {/* Metadata row */}
        {promptCfg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <div style={S.row}>
              <span style={S.label}>Key</span>
              <code style={{ fontSize: 12, background: "#f3f4f6", padding: "2px 8px", borderRadius: 4 }}>glev_ai_default</code>
            </div>
            <div style={S.row}>
              <span style={S.label}>Status</span>
              <span style={S.badge(!promptCfg.isDefault)}>
                {promptCfg.isDefault ? "Hardcoded Default" : `v${promptCfg.version} · In Datenbank`}
              </span>
            </div>
            {promptCfg.updatedAt && (
              <div style={S.row}>
                <span style={S.label}>Zuletzt gespeichert</span>
                <span style={{ fontSize: 13, color: "#777" }}>
                  {new Date(promptCfg.updatedAt).toLocaleString("de-DE")}
                  {promptCfg.updatedBy ? ` · ${promptCfg.updatedBy}` : ""}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Prompt textarea */}
        <textarea
          style={{ ...S.textarea, minHeight: 320, fontSize: 12, lineHeight: 1.5 }}
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          placeholder="System-Prompt…"
          spellCheck={false}
        />

        {/* Character count */}
        <div style={{ fontSize: 11, color: "#999", marginTop: 4, textAlign: "right" }}>
          {promptText.length.toLocaleString("de-DE")} Zeichen
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: isPromptPending ? 0.6 : 1 }}
            onClick={handleSavePrompt}
            disabled={isPromptPending || !promptText.trim()}
          >
            {isPromptPending ? "Speichert…" : "Prompt speichern"}
          </button>
          <button
            style={{ ...S.btn, ...S.btnGhost, opacity: isPromptPending ? 0.6 : 1 }}
            onClick={handleResetPrompt}
            disabled={isPromptPending}
          >
            Auf Default zurücksetzen
          </button>
        </div>

        {promptMsg && (
          <div style={promptMsg.type === "ok" ? S.ok : S.err}>{promptMsg.text}</div>
        )}

        {/* ── Änderungshistorie ───────────────────────────────────────── */}
        <div style={{ marginTop: 24, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
            }}
            onClick={() => setHistoryOpen(o => !o)}
          >
            <span style={{ fontSize: 11, transition: "transform 0.15s", display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            Änderungshistorie
            {versions.length > 0 && (
              <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", borderRadius: 10, padding: "1px 7px", fontWeight: 500 }}>
                {versions.length}
              </span>
            )}
          </button>

          {historyOpen && (
            <div style={{ marginTop: 12 }}>
              {versions.length === 0 ? (
                <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
                  Noch keine gespeicherten Versionen. Beim nächsten Speichern wird hier ein Eintrag erscheinen.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "10px 14px",
                        background: "#f9fafb",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>v{v.version}</span>
                        {v.isReset && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 6px" }}>
                            Reset
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>
                          {new Date(v.savedAt).toLocaleString("de-DE")}
                          {v.savedBy ? ` · ${v.savedBy}` : ""}
                        </span>
                        <button
                          style={{
                            marginLeft: "auto",
                            background: "none",
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            color: "#2563eb",
                          }}
                          onClick={() => {
                            setPromptText(v.promptText);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Wiederherstellen
                        </button>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {v.promptText.slice(0, 120)}{v.promptText.length > 120 ? "…" : ""}
                      </div>
                    </div>
                  ))}

                  {historyHasMore && (
                    <button
                      style={{
                        ...S.btn,
                        ...S.btnGhost,
                        width: "100%",
                        opacity: isHistoryLoading ? 0.6 : 1,
                      }}
                      onClick={loadMoreHistory}
                      disabled={isHistoryLoading}
                    >
                      {isHistoryLoading ? "Lädt…" : "Weitere laden"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
