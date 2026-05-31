"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { createPracticeAction, deletePracticeAction, togglePracticeAction } from "./actions";

export type Practice = {
  id: string;
  slug: string;
  name: string;
  greeting_text: string | null;
  active: boolean;
  created_at: string;
};

const ACCENT = "#4F6EF7";
const BASE   = "https://glev.app";

function PracticeQR({ slug }: { slug: string }) {
  const url      = `${BASE}/praxis/${slug}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `glev-praxis-${slug}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <QRCodeCanvas
        ref={canvasRef}
        value={url}
        size={120}
        bgColor="#fff"
        fgColor="#09090B"
        includeMargin
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={download} style={smallBtnStyle}>
          PNG ↓
        </button>
        <button onClick={copyLink} style={{ ...smallBtnStyle, minWidth: 68 }}>
          {copied ? "✓ Kopiert" : "Link kopieren"}
        </button>
      </div>
    </div>
  );
}

export default function PraxisClient({
  practices,
  err,
  ok,
}: {
  practices: Practice[];
  err?: string | null;
  ok?: string | null;
}) {
  const errMsg =
    err === "missing"    ? "Slug und Name sind Pflichtfelder." :
    err === "duplicate"  ? "Dieser Slug existiert bereits." :
    err === "db"         ? "Datenbankfehler. Bitte erneut versuchen." :
    err === "auth"       ? "Nicht autorisiert." :
    null;

  const okMsg =
    ok === "created" ? "Praxis erfolgreich angelegt." :
    ok === "deleted" ? "Praxis gelöscht." :
    null;

  return (
    <div>
      {/* Feedback banners */}
      {okMsg  && <p style={successStyle}>{okMsg}</p>}
      {errMsg && <p style={errorStyle}>{errMsg}</p>}

      {/* Create form */}
      <section style={boxStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: "#111" }}>
          Neue Praxis anlegen
        </h2>
        <form action={createPracticeAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={labelStyle} htmlFor="slug">Slug (URL-Teil) *</label>
              <input
                id="slug" name="slug" required
                placeholder="z.B. kopenick"
                style={inputStyle}
              />
              <span style={{ fontSize: 11, color: "#888" }}>
                glev.app/praxis/<strong>kopenick</strong>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={labelStyle} htmlFor="name">Praxis-Name *</label>
              <input
                id="name" name="name" required
                placeholder="z.B. Diabeteszentrum Köpenick"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle} htmlFor="greeting_text">Begrüßungstext (optional)</label>
            <textarea
              id="greeting_text" name="greeting_text"
              placeholder="z.B. Ihr Behandlungsteam empfiehlt Glev zur Unterstützung Ihres Alltags mit Typ-1-Diabetes."
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
          <div>
            <button type="submit" style={btnStyle}>
              Praxis anlegen
            </button>
          </div>
        </form>
      </section>

      {/* Practice list */}
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 12px", color: "#111" }}>
        Alle Praxen ({practices.length})
      </h2>

      {practices.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>Noch keine Praxen angelegt.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {practices.map((p) => (
            <div key={p.id} style={{ ...boxStyle, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
              {/* Info column */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>{p.name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                    padding: "2px 7px", borderRadius: 99,
                    background: p.active ? "#ecfdf5" : "#f3f4f6",
                    color:      p.active ? "#065f46" : "#6b7280",
                    border: `1px solid ${p.active ? "#a7f3d0" : "#d1d5db"}`,
                    textTransform: "uppercase" as const,
                  }}>
                    {p.active ? "Aktiv" : "Inaktiv"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: ACCENT, marginBottom: 6, fontFamily: "monospace" }}>
                  glev.app/praxis/{p.slug}
                </div>
                {p.greeting_text && (
                  <p style={{ fontSize: 13, color: "#555", margin: "0 0 8px", fontStyle: "italic", maxWidth: 480 }}>
                    „{p.greeting_text}"
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {/* Toggle active/inactive */}
                  <form action={togglePracticeAction} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={String(p.active)} />
                    <button type="submit" style={{ ...smallBtnStyle, background: p.active ? "#fef3c7" : "#ecfdf5", borderColor: p.active ? "#fcd34d" : "#a7f3d0", color: p.active ? "#92400e" : "#065f46" }}>
                      {p.active ? "Deaktivieren" : "Aktivieren"}
                    </button>
                  </form>
                  {/* Delete */}
                  <form action={deletePracticeAction} style={{ display: "inline" }}
                    onSubmit={(e) => { if (!confirm(`„${p.name}" wirklich löschen?`)) e.preventDefault(); }}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" style={{ ...smallBtnStyle, background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
                      Löschen
                    </button>
                  </form>
                </div>
                <div style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>
                  Angelegt: {new Date(p.created_at).toLocaleDateString("de-DE")}
                </div>
              </div>

              {/* QR column */}
              <PracticeQR slug={p.slug} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 18,
};
const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: ACCENT,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const smallBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};
const successStyle: React.CSSProperties = {
  background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46",
  padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16,
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b",
  padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16,
};
