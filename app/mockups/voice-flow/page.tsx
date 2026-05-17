"use client";

// Marketing-Mockup für die "Voice-first Mahlzeit-Logging"-Section in der
// neuen Website-Redo (/preview, FeatureDeepDive). Bewusst SEPARAT vom
// dark-cockpit-Mockup gehalten, weil:
//   * Lucas will einen viel cleaneren 3-Step-Wizard zeigen (1 Essen /
//     2 Makros / 3 Ergebnis), nicht die volle Glev-Engine-Page mit
//     Formular, Conditions, Pull CGM etc.
//   * Embed-Mode im dark-cockpit blendet die Sidebar aus — Lucas will
//     hier explizit mit Sidebar rendern (zeigt App-Kontext).
// Daher: self-contained, eigene Sidebar-Visualisierung, keine
// Abhängigkeit vom dark-cockpit-Wrapper. Ganze Datei ist statischer
// Visual-Mock — keine Logik, keine API-Calls.
//
// Geladen via FeatureLiveMockup wenn `desktopPage === "voice"`.

const ACCENT = "#4F6EF7";
const ACCENT_DIM = "rgba(79,110,247,0.12)";
const MINT = "#22D3A0";
const BG = "#0A0A0F";
const SURFACE = "#101016";
const PANEL = "#0E0E14";
const BORDER = "rgba(255,255,255,0.06)";
const BORDER_HI = "rgba(255,255,255,0.10)";
const TEXT = "#FFFFFF";
const TEXT_DIM = "rgba(255,255,255,0.55)";
const TEXT_FAINT = "rgba(255,255,255,0.30)";

// Kleines Atom-Lockup, identisch zum Sidebar-Mark im dark-cockpit.
function AtomMark({ size = 18 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.2" fill={ACCENT} />
      <ellipse
        cx="12"
        cy="12"
        rx="9"
        ry="3.6"
        stroke={ACCENT}
        strokeWidth="1.2"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="9"
        ry="3.6"
        stroke={ACCENT}
        strokeWidth="1.2"
        transform="rotate(60 12 12)"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="9"
        ry="3.6"
        stroke={ACCENT}
        strokeWidth="1.2"
        transform="rotate(120 12 12)"
      />
    </svg>
  );
}

function NavRow({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        borderRadius: 10,
        background: active ? ACCENT_DIM : "transparent",
        border: active
          ? `1px solid rgba(79,110,247,0.25)`
          : "1px solid transparent",
        color: active ? TEXT : TEXT_DIM,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        letterSpacing: "-0.01em",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 16,
          height: 16,
          color: active ? ACCENT : TEXT_FAINT,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}

const SVG_DASH = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);
const SVG_HISTORY = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const SVG_SETTINGS = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const SVG_SIGNOUT = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default function VoiceFlowMockup() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
        background: BG,
        color: TEXT,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 14,
        letterSpacing: "-0.01em",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 200,
          flexShrink: 0,
          background: SURFACE,
          borderRight: `1px solid ${BORDER}`,
          display: "flex",
          flexDirection: "column",
          padding: "20px 12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 10px",
            marginBottom: 24,
          }}
        >
          <AtomMark size={20} />
          <span
            style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em" }}
          >
            glev<span style={{ color: ACCENT }}>.</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <NavRow icon={SVG_DASH} label="Dashboard" />
          <NavRow icon={<AtomMark size={14} />} label="Glev" active />
          <NavRow icon={SVG_HISTORY} label="Verlauf" />
          <NavRow icon={SVG_SETTINGS} label="Einstellungen" />
        </div>
        <div
          style={{
            marginTop: "auto",
            padding: "9px 11px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: TEXT_FAINT,
            fontSize: 12,
          }}
        >
          <span style={{ display: "inline-flex", width: 14, height: 14 }}>
            {SVG_SIGNOUT}
          </span>
          <span>Sign Out</span>
        </div>
      </aside>

      {/* Center: 3-Step + Sprechen — Sprechen sitzt direkt unter den
          Steps mit moderatem Abstand (nicht vertikal mittig in der
          ganzen Main-Spalte), per Lucas-Spec. */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          padding: "32px 32px 32px",
          gap: 56,
        }}
      >
        {/* 3-Step Tabs */}
        <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
          <StepPill label="1 Essen" active />
          <StepPill label="2 Makros" />
          <StepPill label="3 Ergebnis" />
        </div>

        {/* Sprechen-Button */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 48px",
              borderRadius: 999,
              background: PANEL,
              border: `1px solid ${BORDER_HI}`,
              color: TEXT,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              cursor: "pointer",
            }}
          >
            <AtomMark size={18} />
            <span>Sprechen</span>
          </button>
        </div>
      </main>

      {/* Right Panel: AI Food Parser */}
      <aside
        style={{
          width: 360,
          flexShrink: 0,
          margin: "20px 20px 20px 0",
          borderRadius: 14,
          border: `1px solid ${BORDER_HI}`,
          background: PANEL,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.45)",
              }}
            >
              AI FOOD PARSER{" "}
              <span
                style={{
                  fontWeight: 500,
                  color: ACCENT,
                  letterSpacing: "0.02em",
                }}
              >
                GPT-Begründung
              </span>
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 999,
              background: "rgba(34,211,160,0.10)",
              border: `1px solid rgba(34,211,160,0.30)`,
              color: MINT,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: MINT,
              }}
            />
            BEREIT
          </div>
        </div>

        {/* Beispiel-Chat: zeigt einen User-Input und die GPT-Antwort,
            damit der Parser im Marketing-Render „lebt" statt leer
            zu wirken (Lucas-Spec). */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 18,
            overflow: "hidden",
          }}
        >
          {/* User-Bubble (rechtsbündig) */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: "14px 14px 4px 14px",
                background: ACCENT_DIM,
                border: `1px solid rgba(79,110,247,0.30)`,
                color: TEXT,
                fontSize: 12.5,
                lineHeight: 1.4,
              }}
            >
              Pasta mit Tomatensauce, 80 g Nudeln und ein Apfel
            </div>
          </div>

          {/* GPT-Response (linksbündig) */}
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                maxWidth: "92%",
                padding: "12px 14px",
                borderRadius: "14px 14px 14px 4px",
                background: "rgba(255,255,255,0.035)",
                border: `1px solid ${BORDER_HI}`,
                color: TEXT_DIM,
                fontSize: 12.5,
                lineHeight: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ color: TEXT, fontWeight: 600 }}>
                Aufschlüsselung:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <MacroLine label="Nudeln (80 g, trocken)" value="≈ 60 g KH" />
                <MacroLine label="Tomatensauce (~120 g)" value="≈ 8 g KH" />
                <MacroLine label="Apfel (mittel, ~150 g)" value="≈ 20 g KH" />
              </div>
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 8,
                  borderTop: `1px solid ${BORDER}`,
                  display: "flex",
                  justifyContent: "space-between",
                  color: TEXT,
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                <span>Gesamt</span>
                <span style={{ color: ACCENT }}>≈ 88 g KH</span>
              </div>
              <div
                style={{ fontSize: 11.5, color: TEXT_FAINT, lineHeight: 1.45 }}
              >
                Geschätzt anhand Standardportionen — passe die Mengen rechts an,
                falls deine Pasta-Portion größer war.
              </div>
            </div>
          </div>
        </div>

        {/* Input-Bar am Boden — Folgefragen / Korrekturen */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 8px 8px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${BORDER}`,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: TEXT_FAINT,
              letterSpacing: "-0.005em",
            }}
          >
            Frage oder Korrektur… z. B. „Die Pasta-Portion war größer"
          </span>
          <button
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: ACCENT,
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "-0.005em",
              border: "none",
              cursor: "pointer",
            }}
          >
            Senden
          </button>
        </div>
      </aside>
    </div>
  );
}

function MacroLine({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.65)" }}>{label}</span>
      <span
        style={{
          color: "rgba(255,255,255,0.85)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StepPill({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  if (active) {
    return (
      <div
        style={{
          padding: "12px 32px",
          borderRadius: 999,
          background: `linear-gradient(135deg, ${ACCENT} 0%, #6B8BFF 100%)`,
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          boxShadow: `0 6px 18px rgba(79,110,247,0.35)`,
        }}
      >
        {label}
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "12px 32px",
        borderRadius: 999,
        background: PANEL,
        border: `1px solid ${BORDER_HI}`,
        color: TEXT_DIM,
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </div>
  );
}
