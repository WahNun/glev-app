import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCENT = "#4F6EF7";
const BG = "#0a0a0f";
const SURFACE = "#111118";
const SURFACE2 = "#16161e";
const BORDER = "#1e1e2e";
const TEXT = "#e2e2ef";
const TEXT_MUTED = "#8888a8";
const TEXT_FAINT = "#55556a";

export default async function TrialUiPreviewPage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: TEXT,
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "32px 24px 64px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
          }}
        >
          Trial-UI Vorschau
        </h1>
        <p style={{ fontSize: 13, color: TEXT_MUTED, margin: "0 0 32px" }}>
          Alle In-App-Upgrade-Prompts die Trial-Nutzer:innen sehen. Statische
          Vorschau — Buttons sind nicht klickbar.
        </p>

        {/* ─── Timeline ────────────────────────────────────────────────────── */}
        <Section title="7-Tage-Trial · Zeitstrahl" subtitle="Was passiert wann — E-Mails und In-App-Prompts kombiniert.">
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              {
                day: "Tag 0",
                dot: ACCENT,
                email: true,
                inapp: false,
                label: "Anmeldung",
                details: [
                  "📧 Supabase Invite-Mail → Setup-Link + Passwort setzen",
                  "📧 trial-welcome E-Mail → Willkommen + Trial-Enddatum",
                ],
              },
              {
                day: "Tag 1–4",
                dot: "#333",
                email: false,
                inapp: false,
                label: "Freie Nutzung",
                details: [
                  "Keine Prompts — außer UpgradeGate bei gesperrten Features",
                ],
              },
              {
                day: "Tag 5",
                dot: "#f59e0b",
                email: false,
                inapp: true,
                label: "Banner erscheint",
                details: [
                  '🔔 In-App: TrialCountdownBanner "Noch 2 Tage Trial" (einmal pro Tag schließbar)',
                ],
              },
              {
                day: "Tag 6",
                dot: "#f97316",
                email: true,
                inapp: true,
                label: "Reminder",
                details: [
                  '🔔 In-App: TrialCountdownBanner "Noch 1 Tag Trial"',
                  "📧 trial_day6_reminder E-Mail → letzter Hinweis vor Ablauf",
                ],
              },
              {
                day: "Tag 7",
                dot: "#ef4444",
                email: true,
                inapp: true,
                label: "Letzter Tag",
                details: [
                  '🔔 In-App: TrialCountdownBanner "Dein Trial endet heute"',
                  "📧 trial_expired E-Mail → Trial läuft ab",
                ],
              },
              {
                day: "Tag 8+",
                dot: "#7f1d1d",
                email: false,
                inapp: true,
                label: "Abgelaufen",
                details: [
                  "🚫 In-App: TrialExpiredModal (Vollbild, nicht schließbar) — solange Plan = free",
                ],
              },
            ].map((row, i, arr) => (
              <div key={row.day} style={{ display: "flex", gap: 16 }}>
                {/* Timeline line + dot */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flexShrink: 0,
                    width: 20,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: row.dot,
                      border: `2px solid ${row.dot}`,
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  />
                  {i < arr.length - 1 && (
                    <div
                      style={{
                        width: 2,
                        flex: 1,
                        background: BORDER,
                        minHeight: 16,
                        marginTop: 3,
                      }}
                    />
                  )}
                </div>
                {/* Content */}
                <div style={{ paddingBottom: 20, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: row.dot,
                        minWidth: 52,
                      }}
                    >
                      {row.day}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: TEXT,
                      }}
                    >
                      {row.label}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    {row.details.map((d) => (
                      <span
                        key={d}
                        style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.5 }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: TEXT_FAINT, margin: "4px 0 0", borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            E-Mail-Versand via Resend/Outbox-Cron (alle 2 min). UpgradeGate erscheint jederzeit wenn eine gesperrte Funktion angetippt wird — unabhängig von Tag im Trial.
          </p>
        </Section>

        {/* ─── 1. TrialCountdownBanner ─────────────────────────────────────── */}
        <Section title="1 · TrialCountdownBanner" subtitle="Erscheint ab Tag 5 (≤3 Tage verbleibend) — einmal pro Tag schließbar. Wird nicht gezeigt wenn daysLeft > 3 oder Trial bereits abgelaufen.">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { days: 3, label: "Noch 2 Tage Trial" },
              { days: 2, label: "Noch 1 Tag Trial" },
              { days: 1, label: "Dein Trial endet heute" },
            ].map(({ days, label }) => (
              <div key={days} style={{ position: "relative" }}>
                <StateLabel>Tag {8 - days} von 7 ({days === 1 ? "letzter Tag" : `noch ${days} Tage`})</StateLabel>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${ACCENT}14 0%, ${ACCENT}08 100%)`,
                    border: `1px solid ${ACCENT}40`,
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ fontSize: 16 }}>⏳</span>
                  <span style={{ flex: 1, color: TEXT }}>
                    <strong style={{ color: ACCENT }}>{label}</strong> —{" "}
                    danach sind die meisten Funktionen gesperrt.
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      padding: "6px 14px",
                      borderRadius: 7,
                      background: ACCENT,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: "0.02em",
                    }}
                  >
                    Upgraden →
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `${ACCENT}18`,
                      color: TEXT_MUTED,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 2. UpgradeGate — overlay variant ───────────────────────────── */}
        <Section title="2 · UpgradeGate (Overlay)" subtitle="Jederzeit ab Tag 1 — sobald eine gesperrte Funktion angetippt wird. Gilt für Free- und Trial-Nutzer gleichermaßen. Schließbar per Backdrop-Tap.">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { planName: "Smart", accent: "#4F6EF7" },
              { planName: "Pro", accent: "#a855f7" },
            ].map(({ planName, accent }) => (
              <div key={planName} style={{ flex: "1 1 260px", minWidth: 240 }}>
                <StateLabel>Benötigt: {planName}</StateLabel>
                {/* Simulated blurred card beneath gate */}
                <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
                  {/* Blurred mock content */}
                  <div
                    style={{
                      background: SURFACE2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 14,
                      padding: "20px 18px",
                      filter: "blur(2.5px)",
                      opacity: 0.55,
                    }}
                  >
                    <div style={{ height: 12, width: "60%", borderRadius: 4, background: "#2a2a3a", marginBottom: 10 }} />
                    <div style={{ height: 10, width: "90%", borderRadius: 4, background: "#1e1e2e", marginBottom: 6 }} />
                    <div style={{ height: 10, width: "70%", borderRadius: 4, background: "#1e1e2e", marginBottom: 6 }} />
                    <div style={{ height: 10, width: "80%", borderRadius: 4, background: "#1e1e2e" }} />
                  </div>
                  {/* Gate overlay */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        background: "rgba(10,10,15,0.88)",
                        backdropFilter: "blur(4px)",
                        borderRadius: 12,
                        padding: "20px 18px",
                        width: 180,
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 24 }}>🔒</div>
                      <div
                        style={{
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: `${accent}18`,
                          color: accent,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {planName}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: TEXT_MUTED,
                          lineHeight: 1.4,
                        }}
                      >
                        Ab <strong style={{ color: TEXT }}>{planName}</strong> verfügbar
                      </p>
                      <div
                        style={{
                          width: "100%",
                          padding: "10px 0",
                          background: accent,
                          color: "#fff",
                          borderRadius: 9,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Jetzt upgraden →
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 3. UpgradeGate — row variant ───────────────────────────────── */}
        <Section title="3 · UpgradeGate (Zeile)" subtitle="Jederzeit ab Tag 1 — kompakte Variante direkt in Karten oder Listen eingebettet, kein Modal. Für Funktionen wo ein Vollbild-Overlay zu aufdringlich wäre.">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { planName: "Smart", accent: "#4F6EF7" },
              { planName: "Pro", accent: "#a855f7" },
            ].map(({ planName, accent }) => (
              <div
                key={planName}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: SURFACE2,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>🔒</span>
                  <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                    Ab{" "}
                    <strong style={{ color: accent }}>{planName}</strong>{" "}
                    verfügbar
                  </span>
                </div>
                <div
                  style={{
                    padding: "6px 14px",
                    borderRadius: 7,
                    background: accent,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  Upgraden →
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 4. TrialExpiredModal ─────────────────────────────────────────── */}
        <Section title="4 · TrialExpiredModal" subtitle="Ab Tag 8 — erscheint beim nächsten App-Öffnen wenn trial_end_at in der Vergangenheit liegt UND Plan = free. Nicht schließbar, kein Dismiss. Verschwindet sofort nach erfolgreichem Upgrade (Plan ≠ free).">
          <div
            style={{
              background: "rgba(10,10,15,0.92)",
              borderRadius: 14,
              padding: "40px 24px 32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderRadius: 20,
                padding: "36px 28px 28px",
                maxWidth: 360,
                width: "100%",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: `${ACCENT}1e`,
                  border: `1px solid ${ACCENT}4d`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}
              >
                ⏰
              </div>
              <h2
                style={{
                  fontSize: 21,
                  fontWeight: 700,
                  color: TEXT,
                  margin: 0,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                }}
              >
                Deine Testphase ist abgelaufen
              </h2>
              <p style={{ fontSize: 14, color: TEXT_MUTED, margin: 0, lineHeight: 1.6 }}>
                Deine Daten bleiben vollständig erhalten.
                Wähle ein Abo um weiterzumachen.
              </p>

              {/* Plan cards */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>

                {/* Pro — empfohlen */}
                <div style={{ position: "relative" }}>
                  <span
                    style={{
                      position: "absolute",
                      top: -10,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: ACCENT,
                      border: `2px solid ${SURFACE}`,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "2px 10px",
                      borderRadius: 20,
                      whiteSpace: "nowrap",
                      zIndex: 1,
                    }}
                  >
                    Empfohlen
                  </span>
                  <div
                    style={{
                      width: "100%",
                      background: ACCENT,
                      color: "#fff",
                      borderRadius: 13,
                      padding: "18px 20px 14px",
                      textAlign: "left",
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
                      Pro — Wie im Trial weiter →
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      Voller Funktionsumfang · alle Features entsperrt
                    </div>
                  </div>
                </div>

                {/* Smart — Einstieg */}
                <div
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 13,
                    padding: "14px 20px",
                    textAlign: "left",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, color: TEXT }}>
                    Smart — Einsteigen →
                  </div>
                  <div style={{ fontSize: 12, color: TEXT_MUTED }}>
                    Kernfeatures · ideal zum Einstieg
                  </div>
                </div>
              </div>

              <span style={{ fontSize: 13, color: TEXT_FAINT, padding: "4px 8px" }}>
                Abmelden
              </span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: TEXT_FAINT, margin: "10px 0 0", textAlign: "center" }}>
            Im echten App: Vollbild, kein Schließen-Button, Hintergrund geblurrt · Pro startet Stripe Checkout direkt
          </p>
        </Section>

        {/* ─── Trigger-Logik ────────────────────────────────────────────────── */}
        <Section title="Wann wird was angezeigt?" subtitle="">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {["Prompt", "Trigger", "Schließbar?"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      color: TEXT_MUTED,
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["TrialCountdownBanner", "Tag 5–7 des Trials (≤3 Tage verbleibend)", "Ja — 1× pro Tag"],
                ["UpgradeGate (Overlay)", "Tap auf gesperrte Funktion (Free/Trial)", "Ja — per Backdrop"],
                ["UpgradeGate (Zeile)", "Gesperrte Karte/Row (Free/Trial)", "Nein (inline)"],
                ["TrialExpiredModal", "Trial abgelaufen + Plan = free", "Nein — Paywall"],
              ].map(([prompt, trigger, close]) => (
                <tr key={prompt as string} style={{ borderBottom: `1px solid ${BORDER}20` }}>
                  <td style={{ padding: "10px 12px", color: ACCENT, fontWeight: 500 }}>{prompt}</td>
                  <td style={{ padding: "10px 12px", color: TEXT_MUTED }}>{trigger}</td>
                  <td style={{ padding: "10px 12px", color: TEXT_MUTED }}>{close}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 14 }}>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: TEXT,
            margin: "0 0 3px",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p style={{ fontSize: 12, color: TEXT_FAINT, margin: 0 }}>
            {subtitle}
          </p>
        )}
      </div>
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 14,
          padding: "20px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: TEXT_FAINT,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
