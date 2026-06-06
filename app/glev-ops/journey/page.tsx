import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/adminAuth";
import PhoneFrame from "./_components/PhoneFrame";
import PhaseSection from "./_components/PhaseSection";
import CookieBanner from "@/components/CookieBanner";
import TrialCountdownBannerView from "@/components/TrialCountdownBannerView";
import TrialExpiredModal from "@/components/TrialExpiredModal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Brand tokens (mirroring the onboarding _shared.tsx palette) ────────────
const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";
const OB_BG = "#09090B";
const OB_SURFACE = "#111117";
const OB_BORDER = "rgba(255,255,255,0.08)";
const OB_TEXT = "rgba(255,255,255,0.96)";
const OB_DIM = "rgba(255,255,255,0.55)";
const OB_FAINT = "rgba(255,255,255,0.32)";

// Admin dark page tokens
const PAGE_BG = "#0a0a0f";
const PAGE_TEXT = "#e2e2ef";
const PAGE_MUTED = "#8888a8";
const PAGE_SURFACE = "#111118";
const PAGE_BORDER = "#1e1e2e";

// ─── Shared onboarding shell (static, no useTranslations) ───────────────────
function ObShell({
  step,
  showSkip = true,
  hidePrimary = false,
  primaryLabel = "Weiter",
  children,
}: {
  step: number;
  showSkip?: boolean;
  hidePrimary?: boolean;
  primaryLabel?: string;
  children: React.ReactNode;
}) {
  const STEP_COUNT = 8;
  return (
    <div
      style={{
        position: "relative",
        minHeight: 780,
        background: OB_BG,
        color: OB_TEXT,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Skip button */}
      {showSkip && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 22,
            zIndex: 2,
            color: OB_DIM,
            fontSize: 14,
            fontWeight: 600,
            padding: "10px 14px",
          }}
        >
          Überspringen
        </div>
      )}

      {/* Progress dots */}
      <div style={{ padding: "24px 0 14px", display: "flex", gap: 8, justifyContent: "center" }}>
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <div
            key={i}
            style={{
              width: i === step ? 24 : 8,
              height: 8,
              borderRadius: 99,
              background: i === step ? ACCENT : "rgba(255,255,255,0.18)",
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "24px 22px 32px", flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
        {children}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "18px 22px 32px",
          borderTop: `1px solid ${OB_BORDER}`,
          background: OB_BG,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          {step > 0 ? (
            <div
              style={{
                padding: "14px 22px",
                borderRadius: 12,
                border: `1px solid ${OB_BORDER}`,
                color: OB_DIM,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              ← Zurück
            </div>
          ) : (
            <span />
          )}
          {!hidePrimary && (
            <div
              style={{
                padding: "14px 26px",
                borderRadius: 12,
                background: ACCENT,
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                boxShadow: `0 4px 16px ${ACCENT}55`,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {primaryLabel} <span style={{ fontSize: 16 }}>→</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Step Previews ────────────────────────────────────────────────

function ObStep0Welcome() {
  return (
    <ObShell step={0} showSkip>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 8, textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: `${ACCENT}22`,
            border: `2px solid ${ACCENT}44`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
          }}
        >
          💙
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
          Willkommen bei Glev
        </h1>
        <p style={{ fontSize: 14, color: OB_DIM, margin: 0, maxWidth: 300, lineHeight: 1.45 }}>
          Dein Begleiter für Typ-1-Diabetes.
        </p>

        {[
          { icon: "🍽️", title: "Schnell loggen", body: "Mahlzeiten per Sprache oder Text — die KI extrahiert die Kohlenhydrate." },
          { icon: "🧠", title: "Adaptive Engine", body: "Dein KH-Faktor lernt aus jeder Mahlzeit mit Glukose-Verlauf." },
          { icon: "📊", title: "Klare Insights", body: "Time in Range, GMI und Trends — auf einen Blick." },
        ].map((b) => (
          <div
            key={b.title}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              background: OB_SURFACE,
              border: `1px solid ${OB_BORDER}`,
              borderRadius: 12,
              padding: "12px 14px",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{b.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{b.title}</div>
              <div style={{ fontSize: 12, color: OB_DIM, lineHeight: 1.4 }}>{b.body}</div>
            </div>
          </div>
        ))}

        <p style={{ fontSize: 11, color: OB_FAINT, margin: "4px 0 0", lineHeight: 1.45 }}>
          Glev ersetzt keinen ärztlichen Rat. Therapie-Entscheidungen immer mit deinem Diabetologen abstimmen.
        </p>
      </div>
    </ObShell>
  );
}

function ObStep1AboutYou() {
  return (
    <ObShell step={1} showSkip>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Erzähl uns kurz von dir
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Diese Angaben brauchen wir, um die Empfehlungen passend zu machen.
      </p>

      {/* Sex selector */}
      <div>
        <div style={{ fontSize: 12, color: OB_DIM, fontWeight: 600, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Geschlecht
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["Weiblich", "Männlich", "Divers"].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                padding: "10px 0",
                textAlign: "center",
                borderRadius: 10,
                border: s === "Weiblich" ? `2px solid ${PINK}` : `1px solid ${OB_BORDER}`,
                background: s === "Weiblich" ? `${PINK}14` : "transparent",
                color: s === "Weiblich" ? PINK : OB_DIM,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* Birth year */}
      <div>
        <div style={{ fontSize: 12, color: OB_DIM, fontWeight: 600, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Geburtsjahr
        </div>
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: `1px solid ${OB_BORDER}`,
            background: OB_SURFACE,
            fontSize: 14,
            color: OB_DIM,
          }}
        >
          z. B. 1993
        </div>
      </div>

      {/* Height / Weight */}
      <div style={{ display: "flex", gap: 12 }}>
        {[{ label: "Größe", placeholder: "z. B. 172 cm" }, { label: "Gewicht", placeholder: "z. B. 68 kg" }].map((f) => (
          <div key={f.label} style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: OB_DIM, fontWeight: 600, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {f.label}
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: `1px solid ${OB_BORDER}`,
                background: OB_SURFACE,
                fontSize: 12,
                color: OB_FAINT,
              }}
            >
              {f.placeholder}
            </div>
          </div>
        ))}
      </div>
    </ObShell>
  );
}

function ObStep2LogMeal() {
  return (
    <ObShell step={2} showSkip>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Mahlzeit in 3 Schritten
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        So loggst du deine erste Mahlzeit mit Glev.
      </p>

      {[
        { n: "1", icon: "👆", title: "Tap den Glev-Button", body: "Unten in der Mitte der Navigation — der hervorgehobene Glev-Button." },
        { n: "2", icon: "🎤", title: "Sprich oder schreib was du isst", body: 'Beispiel: \u201EPasta mit Tomatensauce\u201C. Die KI erkennt die Carbs.' },
        { n: "3", icon: "💡", title: "Bekomm einen Bolus-Vorschlag", body: "Glev empfiehlt Insulin basierend auf deiner Historie + KH-Faktor." },
      ].map((step) => (
        <div key={step.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `${ACCENT}22`,
              border: `1px solid ${ACCENT}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 800,
              color: ACCENT,
              flexShrink: 0,
            }}
          >
            {step.n}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{step.title}</div>
            <div style={{ fontSize: 12, color: OB_DIM, lineHeight: 1.4 }}>{step.body}</div>
          </div>
        </div>
      ))}

      {/* Demo card */}
      <div
        style={{
          background: OB_SURFACE,
          border: `1px solid ${OB_BORDER}`,
          borderRadius: 14,
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 10, color: OB_FAINT, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
          BEISPIEL-VORSCHLAG
        </div>
        <div
          style={{
            background: `${ACCENT}14`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            color: OB_TEXT,
            marginBottom: 10,
          }}
        >
          Pasta mit Tomatensauce, mittelgroß
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { label: "≈ 80 g KH", color: ORANGE },
            { label: "8 IE empfohlen", color: ACCENT },
            { label: "MITTLERE Konfidenz", color: GREEN },
          ].map((chip) => (
            <div
              key={chip.label}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                background: `${chip.color}18`,
                color: chip.color,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              {chip.label}
            </div>
          ))}
        </div>
      </div>
    </ObShell>
  );
}

function ObStep3Engine() {
  const phases = [
    { name: "Aufwärmphase", desc: "Glev nutzt deinen Default-Faktor.", count: "0–7 Mahlzeiten", color: ORANGE, active: false },
    { name: "Lernphase", desc: "Erste empirische Anpassung deines KH-Faktors.", count: "8–20 Mahlzeiten", color: ACCENT, active: true },
    { name: "Feinjustiert", desc: "Selbstkalibrierend mit deinen Trends.", count: "20+ Mahlzeiten", color: GREEN, active: false },
  ];

  return (
    <ObShell step={3} showSkip>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Die Engine lernt mit dir
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Dein KH-Faktor verbessert sich nach jeder Mahlzeit mit Glukose-Verlauf.
      </p>

      {/* ICR card */}
      <div
        style={{
          background: OB_SURFACE,
          border: `1px solid ${OB_BORDER}`,
          borderRadius: 14,
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontSize: 10, color: OB_FAINT, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          ADAPTIVER KH-FAKTOR
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, color: ACCENT, letterSpacing: "-0.02em" }}>1 : 12,5</div>
        <div style={{ fontSize: 12, color: OB_DIM }}>ergebnisgewichtet · 14 Mahlzeiten</div>
        <div style={{ fontSize: 11, color: OB_FAINT, marginTop: 4, padding: "8px 0 0", borderTop: `1px solid ${OB_BORDER}` }}>
          1 IE deckt 12,5 g KH
        </div>
      </div>

      {/* Phases */}
      <div>
        <div style={{ fontSize: 11, color: OB_FAINT, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Lernphasen
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phases.map((p) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: p.active ? `${p.color}18` : "transparent",
                border: `1px solid ${p.active ? p.color + "40" : OB_BORDER}`,
                alignItems: "center",
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: p.active ? p.color : OB_TEXT }}>{p.name}</div>
                <div style={{ fontSize: 11, color: OB_DIM }}>{p.desc}</div>
              </div>
              <div style={{ fontSize: 10, color: OB_FAINT, whiteSpace: "nowrap", flexShrink: 0 }}>{p.count}</div>
            </div>
          ))}
        </div>
      </div>
    </ObShell>
  );
}

function ObStep4Insights() {
  const cards = [
    { label: "TIME IN RANGE", value: "75", unit: "%", sub: "letzte 7 Tage", color: GREEN },
    { label: "GMI / A1c", value: "6,8", unit: "%", sub: "geschätzte HbA1c", color: ACCENT },
    { label: "VARIABILITÄT", value: "28", unit: "%", sub: "CV % · letzte 14 Tage", color: ORANGE },
  ];

  return (
    <ObShell step={4}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Deine Daten — dein Lernwerkzeug
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Im Verlauf-Tab siehst du, was bei dir wirklich wirkt.
      </p>

      {/* Metric cards row */}
      <div style={{ display: "flex", gap: 8 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              background: OB_SURFACE,
              border: `1px solid ${OB_BORDER}`,
              borderRadius: 12,
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div style={{ fontSize: 8, color: OB_FAINT, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {c.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.color, lineHeight: 1 }}>
              {c.value}<span style={{ fontSize: 11, fontWeight: 600 }}>{c.unit}</span>
            </div>
            <div style={{ fontSize: 10, color: OB_FAINT }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Mini chart placeholder */}
      <div
        style={{
          background: OB_SURFACE,
          border: `1px solid ${OB_BORDER}`,
          borderRadius: 12,
          padding: "14px",
          height: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <svg width="240" height="48" viewBox="0 0 240 48">
          <polyline
            points="0,40 30,32 60,20 90,28 120,10 150,22 180,16 210,8 240,18"
            fill="none"
            stroke={GREEN}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="0" y1="36" x2="240" y2="36" stroke={ORANGE} strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <line x1="0" y1="6" x2="240" y2="6" stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
        </svg>
        <div style={{ fontSize: 10, color: OB_FAINT }}>Glukose-Verlauf · 7d</div>
      </div>

      <div
        style={{
          background: `${ACCENT}10`,
          border: `1px solid ${ACCENT}30`,
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          color: OB_DIM,
          lineHeight: 1.4,
        }}
      >
        💡 <strong style={{ color: OB_TEXT }}>Tipp:</strong> Tap eine Karte, um Formel und Erklärung zu sehen.
      </div>
    </ObShell>
  );
}

function ObStep5GlevButton() {
  return (
    <ObShell step={5} primaryLabel="Los geht's" showSkip={false}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Dein zentraler Button
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Der Glev-Button in der Mitte der Navigation hat zwei Gesten — lern sie einmal, nutze sie täglich.
      </p>

      {[
        {
          gesture: "Kurz tippen",
          icon: "👆",
          title: "Spracheingabe & KI-Chat",
          body: "Einmal kurz tippen öffnet den Sprach-Modus: sprich einfach, was du gegessen hast. Du kannst auch tippen oder nachfragen.",
          color: ACCENT,
        },
        {
          gesture: "Lang drücken",
          icon: "✊",
          title: "Schnell-Menü",
          body: "Halte den Button gedrückt, um das Schnell-Menü zu öffnen: Insulin loggen, Fingertest, Training oder Symptome.",
          color: ORANGE,
        },
      ].map((item) => (
        <div
          key={item.gesture}
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 14,
            padding: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: `${item.color}22`,
                border: `1px solid ${item.color}44`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              {item.icon}
            </div>
            <div>
              <div style={{ fontSize: 11, color: item.color, fontWeight: 700, letterSpacing: "0.04em" }}>
                {item.gesture}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{item.title}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: OB_DIM, lineHeight: 1.45 }}>{item.body}</div>
        </div>
      ))}

      {/* Fake bottom nav with Glev button */}
      <div
        style={{
          marginTop: "auto",
          background: "#0D0D13",
          borderTop: `1px solid ${OB_BORDER}`,
          borderRadius: 16,
          padding: "12px 20px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
        }}
      >
        {["🏠", "📋"].map((icon) => (
          <div key={icon} style={{ fontSize: 20, opacity: 0.4 }}>{icon}</div>
        ))}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: ACCENT,
            boxShadow: `0 4px 20px ${ACCENT}66`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: "#fff",
            marginTop: -18,
            border: "3px solid #09090B",
          }}
        >
          💙
        </div>
        {["📊", "⚙️"].map((icon) => (
          <div key={icon} style={{ fontSize: 20, opacity: 0.4 }}>{icon}</div>
        ))}
      </div>
    </ObShell>
  );
}

function ObStep6Cgm() {
  return (
    <ObShell step={6} hidePrimary showSkip={false}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Verbinde deinen CGM
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Wähle deinen CGM-Hersteller — oder richte ihn später in den Einstellungen ein.
      </p>

      {[
        { name: "FreeStyle Libre", devices: "Libre 2, Libre 3, Libre 3 Plus", recommended: true },
        { name: "Dexcom", devices: "G6, G7, One+", recommended: false },
        { name: "Medtronic", devices: "MiniMed Guardian, Simplera", recommended: false },
        { name: "Andere / Apple Health", devices: "Eversense, Sibionics u. a.", recommended: false },
      ].map((v) => (
        <div
          key={v.name}
          style={{
            background: OB_SURFACE,
            border: v.recommended ? `1.5px solid ${ACCENT}60` : `1px solid ${OB_BORDER}`,
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{v.name}</span>
              {v.recommended && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: ACCENT,
                    background: `${ACCENT}18`,
                    borderRadius: 4,
                    padding: "1px 5px",
                  }}
                >
                  Empfohlen
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: OB_FAINT }}>{v.devices}</div>
          </div>
          <div style={{ fontSize: 16, color: OB_FAINT }}>›</div>
        </div>
      ))}

      <div
        style={{
          textAlign: "center",
          fontSize: 12,
          color: OB_FAINT,
          paddingTop: 8,
          borderTop: `1px solid ${OB_BORDER}`,
        }}
      >
        Später, in den Einstellungen einrichten
      </div>
    </ObShell>
  );
}

function ObStep7Install() {
  return (
    <ObShell step={7} primaryLabel="Fertig" showSkip>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
        Glev zum Homescreen
      </h1>
      <p style={{ fontSize: 13, color: OB_DIM, margin: 0, lineHeight: 1.45 }}>
        Die nativen iOS- und Android-Apps kommen ab 1. Juli — bis dahin Webapp hinzufügen.
      </p>

      {[
        {
          platform: "Android (Chrome)",
          steps: [
            "Öffne Glev in Chrome und tippe auf \u22EE",
            'Tippe auf \u201EApp installieren\u201C',
            'Bestätige mit \u201EInstallieren\u201C',
            "Glev erscheint als App-Icon",
          ],
          color: GREEN,
        },
        {
          platform: "iPhone / iPad (Safari)",
          steps: [
            "Öffne Glev in Safari und tippe auf \u25A1\u2191",
            'Scrolle und tippe auf \u201EZum Home-Bildschirm\u201C',
            'Passe den Namen an und tippe \u201EHinzufügen\u201C',
            "Glev erscheint als App-Icon",
          ],
          color: ACCENT,
        },
      ].map((p) => (
        <div
          key={p.platform}
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: p.color, marginBottom: 10 }}>
            {p.platform}
          </div>
          {p.steps.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: i < p.steps.length - 1 ? 8 : 0 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: `${p.color}22`,
                  color: p.color,
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: 12, color: OB_DIM, lineHeight: 1.4 }}>{step}</div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ textAlign: "center", fontSize: 12, color: OB_FAINT }}>
        Überspringen — ich mache das später
      </div>
    </ObShell>
  );
}

// ─── Dashboard shell for trial banner context ────────────────────────────────

function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: 780,
        background: "#09090B",
        color: OB_TEXT,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "16px 20px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>Dashboard</span>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: OB_SURFACE, border: `1px solid ${OB_BORDER}` }} />
      </div>
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
        <div
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 16,
            height: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: GREEN }}>5.8</div>
            <div style={{ fontSize: 11, color: OB_FAINT }}>mmol/L · ↗ steigend</div>
          </div>
        </div>
        <div
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 16,
            height: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 12, color: OB_FAINT }}>Letzte Mahlzeit · 2h ago</div>
        </div>
      </div>
    </div>
  );
}

function NoBannerPreview() {
  return (
    <div
      style={{
        minHeight: 780,
        background: "#09090B",
        color: OB_TEXT,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "16px 20px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>Dashboard</span>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: OB_SURFACE, border: `1px solid ${OB_BORDER}` }} />
      </div>
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 16,
            height: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: GREEN }}>5.8</div>
            <div style={{ fontSize: 11, color: OB_FAINT }}>mmol/L · ↗ steigend</div>
          </div>
        </div>
        <div
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 16,
            height: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 12, color: OB_FAINT }}>Letzte Mahlzeit · 2h ago</div>
        </div>
        <div
          style={{
            background: OB_SURFACE,
            border: `1px solid ${OB_BORDER}`,
            borderRadius: 16,
            height: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 12, color: OB_FAINT }}>Kein Banner · Trial aktiv</div>
        </div>
      </div>
    </div>
  );
}

// ─── Email link card ─────────────────────────────────────────────────────────

function EmailCard({
  label,
  whenSent,
  templateKey,
}: {
  label: string;
  whenSent: string;
  templateKey: string;
}) {
  return (
    <a
      href={`/glev-ops/emails?t=${templateKey}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "16px 18px",
        background: PAGE_SURFACE,
        border: `1px solid ${PAGE_BORDER}`,
        borderRadius: 12,
        textDecoration: "none",
        color: PAGE_TEXT,
        minWidth: 200,
        flexShrink: 0,
        transition: "border-color 0.15s",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${ACCENT}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          marginBottom: 2,
        }}
      >
        ✉️
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 11, color: PAGE_MUTED, lineHeight: 1.4 }}>{whenSent}</div>
      <div
        style={{
          marginTop: 4,
          padding: "5px 10px",
          borderRadius: 7,
          background: `${ACCENT}18`,
          color: ACCENT,
          fontSize: 11,
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        Vorschau öffnen →
      </div>
    </a>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function JourneyPage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAGE_BG,
        color: PAGE_TEXT,
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "32px 24px 80px",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Page header */}
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
          }}
        >
          User Journey Preview
        </h1>
        <p style={{ fontSize: 13, color: PAGE_MUTED, margin: "0 0 40px" }}>
          Vollständige Nutzer-Sequenz von Registrierung bis Trial-Ende. Cookie-Banner, Trial-Banner und TrialExpiredModal sind echte Komponenten mit Preview-Props. Onboarding-Screens sind statische Server-Renders (next-intl-Hooks nicht im Admin-Kontext verf\u00FCgbar).
        </p>

        {/* ── Phase 1: Auth & Einstieg ───────────────────────────────────── */}
        <PhaseSection
          title="Phase 1 – Auth & Einstieg"
          subtitle="Cookie-Banner beim ersten Besuch, dann Login/Registrierung."
        >
          {/* Frame 1: Cookie Banner */}
          <PhoneFrame label="Cookie-Banner (sichtbar)" readonly>
            <div
              style={{
                width: 393,
                height: 780,
                background: OB_BG,
                position: "relative",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ fontSize: 28, color: OB_FAINT }}>glev.app</div>
              <CookieBanner forceVisible />
            </div>
          </PhoneFrame>

          {/* Frame 2: Auth Screen */}
          <PhoneFrame label="Login / Registrierung" readonly>
            <iframe
              src="/login"
              style={{ width: 393, height: 780, border: "none", display: "block" }}
              title="Login-Screen"
            />
          </PhoneFrame>
        </PhaseSection>

        {/* ── Phase 2: Onboarding ────────────────────────────────────────── */}
        <PhaseSection
          title="Phase 2 – Onboarding (8 Schritte)"
          subtitle="Erscheint beim ersten Login. Kann jederzeit übersprungen werden."
        >
          <PhoneFrame label="Schritt 1 · Willkommen" readonly>
            <ObStep0Welcome />
          </PhoneFrame>
          <PhoneFrame label="Schritt 2 · Über dich" readonly>
            <ObStep1AboutYou />
          </PhoneFrame>
          <PhoneFrame label="Schritt 3 · Mahlzeit loggen" readonly>
            <ObStep2LogMeal />
          </PhoneFrame>
          <PhoneFrame label="Schritt 4 · Adaptive Engine" readonly>
            <ObStep3Engine />
          </PhoneFrame>
          <PhoneFrame label="Schritt 5 · Insights" readonly>
            <ObStep4Insights />
          </PhoneFrame>
          <PhoneFrame label="Schritt 6 · Glev-Button" readonly>
            <ObStep5GlevButton />
          </PhoneFrame>
          <PhoneFrame label="Schritt 7 · CGM verbinden" readonly>
            <ObStep6Cgm />
          </PhoneFrame>
          <PhoneFrame label="Schritt 8 · Homescreen" readonly>
            <ObStep7Install />
          </PhoneFrame>
        </PhaseSection>

        {/* ── Phase 3: Aktiver Trial ─────────────────────────────────────── */}
        <PhaseSection
          title="Phase 3 – Aktiver Trial (Dashboard-Kontext)"
          subtitle="Banner erscheint ab daysLeft ≤ 3. Einmal pro Tag schließbar."
        >
          <PhoneFrame label="Trial aktiv · kein Banner" readonly>
            <NoBannerPreview />
          </PhoneFrame>
          <PhoneFrame label="daysLeft=3 · Noch 2 Tage" readonly>
            <DashboardShell>
              <TrialCountdownBannerView daysLeft={3} />
            </DashboardShell>
          </PhoneFrame>
          <PhoneFrame label="daysLeft=2 · Noch 1 Tag" readonly>
            <DashboardShell>
              <TrialCountdownBannerView daysLeft={2} />
            </DashboardShell>
          </PhoneFrame>
          <PhoneFrame label="daysLeft=1 · Endet heute" readonly>
            <DashboardShell>
              <TrialCountdownBannerView daysLeft={1} />
            </DashboardShell>
          </PhoneFrame>
        </PhaseSection>

        {/* ── Phase 4: Trial abgelaufen ──────────────────────────────────── */}
        <PhaseSection
          title="Phase 4 – Trial abgelaufen"
          subtitle="TrialExpiredModal — nicht schließbar, verschwindet nach erfolgreichem Upgrade."
        >
          <PhoneFrame label="TrialExpiredModal (Plan-Auswahl)" readonly>
            <div style={{ position: "relative", width: 393, height: 780, overflow: "hidden", background: "#09090B" }}>
              <TrialExpiredModal forceOpen />
            </div>
          </PhoneFrame>
        </PhaseSection>

        {/* ── Phase 5: E-Mail-Sequenz ────────────────────────────────────── */}
        <PhaseSection
          title="Phase 5 – E-Mail-Sequenz"
          subtitle="Kein Phone-Frame (E-Mail-Design ist kein mobiles UI). Klick öffnet die Vorschau im Mail-Preview-Tab."
        >
          <EmailCard
            label="Welcome (Tag 0)"
            whenSent="Sofort nach Free-Trial-Anmeldung"
            templateKey="trial-welcome"
          />
          <EmailCard
            label="Trial Reminder (Tag 6)"
            whenSent="Tag 6 nach Trial-Start — Cron 09:00 UTC"
            templateKey="trial-day6"
          />
          <EmailCard
            label="Trial Expired (Tag 7)"
            whenSent="Tag 7 nach Trial-Start — Cron 09:00 UTC"
            templateKey="trial-expired"
          />
          <EmailCard
            label="Re-Engagement (48h inaktiv)"
            whenSent="Wenn Trial-User 48h nicht aktiv war — einmalig"
            templateKey="re-engagement"
          />
          <EmailCard
            label="Insights (Tag 7 nach Welcome)"
            whenSent="7 Tage nach Welcome-Mail — Cron 09:00 UTC"
            templateKey="drip-day7"
          />
          <EmailCard
            label="Feedback (Tag 14)"
            whenSent="14 Tage nach Welcome-Mail — Cron 09:00 UTC"
            templateKey="drip-day14"
          />
          <EmailCard
            label="Trustpilot (Tag 30)"
            whenSent="30 Tage nach Welcome-Mail — Cron 09:00 UTC"
            templateKey="drip-day30"
          />
        </PhaseSection>

      </div>
    </div>
  );
}
