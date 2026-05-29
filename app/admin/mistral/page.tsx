"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getTtsConfig, uploadRefAudio, deleteRefAudio, testTts, type TtsConfig } from "./actions";

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
  textarea: { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "inherit", resize: "vertical" as const, boxSizing: "border-box" as const },
  fileInput: { fontSize: 13, padding: "6px 0" } as React.CSSProperties,
};

export default function MistralTTSPage() {
  const [cfg, setCfg] = useState<TtsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testText, setTestText] = useState("Dein Blutzucker liegt bei 104 mg/dL — gut im Zielbereich.");
  const [testAudio, setTestAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const reload = () => {
    setLoading(true);
    getTtsConfig().then(c => { setCfg(c); setLoading(false); });
  };

  useEffect(() => { reload(); }, []);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
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
      const res = await testTts(testText);
      if (res.ok && res.audioB64) {
        const url = `data:audio/mpeg;base64,${res.audioB64}`;
        setTestAudio(url);
        setTimeout(() => { audioRef.current?.play().catch(() => {}); }, 100);
      } else {
        flash("err", res.error ?? "TTS-Fehler");
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
        <div style={S.cardTitle}>TTS testen</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
          Spricht den Text via Mistral Voxtral mit der aktuell hinterlegten Konfiguration.
        </p>
        <textarea
          style={S.textarea}
          rows={3}
          value={testText}
          onChange={e => setTestText(e.target.value)}
          placeholder="Test-Text…"
        />
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: isPending ? 0.6 : 1 }}
            onClick={handleTest}
            disabled={isPending || !testText.trim()}
          >
            {isPending ? "Generiere…" : "▶ Vorlesen"}
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
    </div>
  );
}
