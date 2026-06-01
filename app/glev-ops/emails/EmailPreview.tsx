"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type TemplateOption = {
  key: string;
  label: string;
  whenSent: string;
  subject: string;
  html: string;
  campaign: string;
  editableKey?: string;
};

export type SmsTemplateOption = {
  key: string;
  label: string;
  whenSent: string;
};

export type DbTemplate = {
  sms_text: string | null;
  email_subject: string | null;
  email_intro: string | null;
};

type Props = {
  templates: TemplateOption[];
  smsTemplates: SmsTemplateOption[];
  dbTemplates: Record<string, DbTemplate>;
  selectedKey: string;
  name: string;
  email: string;
  locale: "de" | "en";
  campaign: string;
};

const CAMPAIGNS = [
  { key: "alle", label: "Alle" },
  { key: "meta-lead", label: "Meta Lead" },
  { key: "trial", label: "Trial" },
  { key: "drip", label: "Drip" },
  { key: "welcome", label: "Welcome" },
  { key: "system", label: "System" },
  { key: "sms", label: "📱 SMS" },
];

type Width = "desktop" | "mobile";
const WIDTH_PX: Record<Width, number> = { desktop: 600, mobile: 375 };

export default function EmailPreview({
  templates,
  smsTemplates,
  dbTemplates,
  selectedKey,
  name,
  email,
  locale,
  campaign,
}: Props) {
  const router = useRouter();
  const isSms = campaign === "sms";

  const filteredTemplates =
    !campaign || campaign === "alle" || isSms
      ? templates
      : templates.filter((t) => t.campaign === campaign);

  const selected =
    filteredTemplates.find((t) => t.key === selectedKey) ?? filteredTemplates[0];

  const [activeSmsKey, setActiveSmsKey] = useState(smsTemplates[0]?.key ?? "");
  const activeSms = smsTemplates.find((t) => t.key === activeSmsKey) ?? smsTemplates[0];

  const [width, setWidth] = useState<Width>("desktop");

  const editKeyNow = isSms ? activeSmsKey : (selected?.editableKey ?? "");
  const [trackedEditKey, setTrackedEditKey] = useState(editKeyNow);
  const [editMode, setEditMode] = useState(false);

  const db = dbTemplates[editKeyNow] ?? {};
  const [editSmsText, setEditSmsText] = useState(db.sms_text ?? "");
  const [editEmailSubject, setEditEmailSubject] = useState(db.email_subject ?? "");
  const [editEmailIntro, setEditEmailIntro] = useState(db.email_intro ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  if (trackedEditKey !== editKeyNow) {
    setTrackedEditKey(editKeyNow);
    setEditMode(false);
    setSaveState("idle");
    const newDb = dbTemplates[editKeyNow] ?? {};
    setEditSmsText(newDb.sms_text ?? "");
    setEditEmailSubject(newDb.email_subject ?? "");
    setEditEmailIntro(newDb.email_intro ?? "");
  }

  const smsPreview = isSms
    ? editSmsText
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{link\}\}/g, "glev.app/s/preview")
    : "";

  const smsCharCount = editSmsText.length;
  const smsSegments = Math.max(1, Math.ceil(smsCharCount / 160));

  async function handleSave() {
    if (!editKeyNow) return;
    setSaveState("saving");
    try {
      const body: Record<string, string | null> = { key: editKeyNow };
      if (isSms) {
        body.sms_text = editSmsText;
      } else {
        body.email_subject = editEmailSubject;
        body.email_intro = editEmailIntro;
      }
      const res = await fetch("/api/glev-ops/message-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSaveState("saved");
      router.refresh();
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div>
      <div style={tabRowStyle}>
        {CAMPAIGNS.map((c) => {
          const isActive = campaign === c.key || (!campaign && c.key === "alle");
          return (
            <a
              key={c.key}
              href={buildHref(selectedKey, name, email, locale, c.key)}
              style={{ ...tabStyle, ...(isActive ? tabActiveStyle : null) }}
            >
              {c.label}
            </a>
          );
        })}
      </div>

      {isSms ? (
        <div style={layoutStyle}>
          <aside style={sidebarStyle}>
            <h2 style={sidebarHeadingStyle}>SMS-Templates</h2>
            <nav>
              {smsTemplates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setActiveSmsKey(t.key); setSaveState("idle"); }}
                  style={{
                    ...sidebarItemStyle,
                    ...(t.key === activeSmsKey ? sidebarItemActiveStyle : null),
                    width: "100%",
                    textAlign: "left",
                    background: t.key === activeSmsKey ? "#fff" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</span>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{t.whenSent}</span>
                </button>
              ))}
            </nav>

            <h2 style={{ ...sidebarHeadingStyle, marginTop: 24 }}>Platzhalter</h2>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.8 }}>
              <code style={codeStyle}>{"{{name}}"}</code> — Vorname<br />
              <code style={codeStyle}>{"{{link}}"}</code> — Einladungslink
            </div>

            {db.sms_text !== null && (
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 16, lineHeight: 1.5 }}>
                Zuletzt gespeichert — aktiv
              </p>
            )}
          </aside>

          <section style={mainStyle}>
            <div style={metaBarStyle}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>Template</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{activeSms?.label}</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{activeSms?.whenSent}</div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: smsSegments > 1 ? "#f59e0b" : "#6b7280",
                  textAlign: "right",
                  fontWeight: smsSegments > 1 ? 600 : 400,
                }}
              >
                {smsCharCount} Zeichen<br />
                {smsSegments} {smsSegments === 1 ? "Segment" : "Segmente"}
              </div>
            </div>

            <div style={phoneWrapStyle}>
              <div style={phoneStyle}>
                <div style={phoneStatusBar}>Glev · SMS-Vorschau</div>
                <div style={phoneChatArea}>
                  <div style={{ textAlign: "center", marginBottom: 12 }}>
                    <span style={phoneTimestamp}>Heute · Einladung</span>
                  </div>
                  <div style={smsBubbleStyle}>
                    {smsPreview || (
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>Kein Text — Textarea unten ausfüllen</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div style={editPanelStyle}>
              <h3 style={editPanelHeadingStyle}>SMS-Text bearbeiten</h3>
              <p style={editHintStyle}>
                Änderungen greifen bei allen SMS die danach rausgehen. Nutze{" "}
                <code style={codeStyle}>{"{{link}}"}</code> für den Einladungslink und{" "}
                <code style={codeStyle}>{"{{name}}"}</code> für den Vornamen.
                Die Vorschau oben aktualisiert sich live.
              </p>
              <textarea
                value={editSmsText}
                onChange={(e) => {
                  setEditSmsText(e.target.value);
                  setSaveState("idle");
                }}
                rows={7}
                style={textareaStyle}
                spellCheck={false}
                placeholder={"Hallo {{name}}, dein Glev-Test wartet: {{link}}"}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveState === "saving"}
                  style={saveBtnStyle}
                >
                  {saveState === "saving" ? "Speichert…" : "Speichern"}
                </button>
                {saveState === "saved" && (
                  <span style={savedMsgStyle}>✓ Gespeichert — gilt ab nächster SMS</span>
                )}
                {saveState === "error" && (
                  <span style={errorMsgStyle}>⚠ Fehler beim Speichern</span>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div style={layoutStyle}>
          <aside style={sidebarStyle}>
            <h2 style={sidebarHeadingStyle}>Templates</h2>
            <nav>
              {filteredTemplates.map((t) => (
                <a
                  key={t.key}
                  href={buildHref(t.key, name, email, locale, campaign)}
                  style={{
                    ...sidebarItemStyle,
                    ...(t.key === selected?.key ? sidebarItemActiveStyle : null),
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.label}
                    {t.editableKey && (
                      <span style={editableBadgeStyle}>✏</span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{t.whenSent}</span>
                </a>
              ))}
            </nav>

            <h2 style={{ ...sidebarHeadingStyle, marginTop: 24 }}>Sprache</h2>
            <div style={{ display: "flex", gap: 6 }}>
              {(["de", "en"] as const).map((l) => (
                <a
                  key={l}
                  href={buildHref(selected?.key ?? selectedKey, name, email, l, campaign)}
                  style={{ ...langBtnStyle, ...(locale === l ? langBtnActiveStyle : null) }}
                >
                  {l.toUpperCase()}
                </a>
              ))}
            </div>

            <h2 style={{ ...sidebarHeadingStyle, marginTop: 24 }}>Variablen</h2>
            <form method="get" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input type="hidden" name="t" value={selected?.key ?? ""} />
              <input type="hidden" name="lang" value={locale} />
              <input type="hidden" name="campaign" value={campaign} />
              <label style={labelStyle}>
                Vorname
                <input type="text" name="name" defaultValue={name} placeholder="Julia" style={textInputStyle} />
              </label>
              <label style={labelStyle}>
                E-Mail-Adresse
                <input type="email" name="email" defaultValue={email} placeholder="julia@example.com" style={textInputStyle} />
              </label>
              <button type="submit" style={applyBtnStyle}>Übernehmen</button>
            </form>

            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 14, lineHeight: 1.5 }}>
              Templates mit ✏ können direkt hier bearbeitet werden. Änderungen greifen ab der nächsten E-Mail.
            </p>
          </aside>

          <section style={mainStyle}>
            {selected ? (
              <>
                <div style={metaBarStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Subject</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", overflowWrap: "anywhere" }}>
                      {selected.subject}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {selected.editableKey && (
                      <button
                        type="button"
                        onClick={() => { setEditMode((v) => !v); setSaveState("idle"); }}
                        style={editToggleBtnStyle}
                      >
                        {editMode ? "✕ Schließen" : "✏ Bearbeiten"}
                      </button>
                    )}
                    {(["desktop", "mobile"] as Width[]).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWidth(w)}
                        style={{ ...widthBtnStyle, ...(width === w ? widthBtnActiveStyle : null) }}
                      >
                        {w === "desktop" ? "Desktop" : "Mobil"}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={iframeWrapStyle}>
                  <iframe
                    key={`${selected.key}-${width}`}
                    title={`Mail-Preview: ${selected.label}`}
                    srcDoc={selected.html}
                    sandbox=""
                    style={{
                      width: WIDTH_PX[width],
                      maxWidth: "100%",
                      height: 900,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#fff",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    }}
                  />
                </div>

                {editMode && selected.editableKey && (
                  <div style={editPanelStyle}>
                    <h3 style={editPanelHeadingStyle}>Email-Inhalt bearbeiten</h3>
                    <p style={editHintStyle}>
                      Subject und Intro-Text werden aus der DB geladen — gilt ab nächster Email. Das HTML-Design (Layout, Farben, Bullets, Button)
                      bleibt unverändert im Code. Vorschau aktualisiert sich nach dem Speichern.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <label style={labelStyle}>
                        Subject-Zeile
                        <input
                          type="text"
                          value={editEmailSubject}
                          onChange={(e) => { setEditEmailSubject(e.target.value); setSaveState("idle"); }}
                          style={textInputStyle}
                        />
                      </label>
                      <label style={labelStyle}>
                        Intro-Text (Hauptabsatz nach der Anrede)
                        <textarea
                          value={editEmailIntro}
                          onChange={(e) => { setEditEmailIntro(e.target.value); setSaveState("idle"); }}
                          rows={4}
                          style={textareaStyle}
                          placeholder="du hattest Interesse an Glev…"
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saveState === "saving"}
                        style={saveBtnStyle}
                      >
                        {saveState === "saving" ? "Speichert…" : "Speichern + Vorschau"}
                      </button>
                      {saveState === "saved" && (
                        <span style={savedMsgStyle}>✓ Gespeichert — Vorschau wird aktualisiert…</span>
                      )}
                      {saveState === "error" && (
                        <span style={errorMsgStyle}>⚠ Fehler beim Speichern</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: "#9ca3af", padding: 24 }}>Kein Template in dieser Kategorie.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function buildHref(
  key: string,
  name: string,
  email: string,
  locale: "de" | "en",
  campaign: string,
): string {
  const sp = new URLSearchParams();
  if (key) sp.set("t", key);
  if (name) sp.set("name", name);
  if (email) sp.set("email", email);
  sp.set("lang", locale);
  if (campaign && campaign !== "alle") sp.set("campaign", campaign);
  return `/glev-ops/emails?${sp.toString()}`;
}

const tabRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginBottom: 20,
  flexWrap: "wrap",
};

const tabStyle: React.CSSProperties = {
  padding: "7px 16px",
  borderRadius: 20,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  color: "#374151",
  border: "1px solid #e5e7eb",
  background: "#fff",
  whiteSpace: "nowrap",
};

const tabActiveStyle: React.CSSProperties = {
  background: "#4F6EF7",
  color: "#fff",
  borderColor: "#4F6EF7",
};

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "240px 1fr",
  gap: 20,
  alignItems: "start",
};

const sidebarStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 16,
  background: "#fafafa",
  position: "sticky",
  top: 16,
};

const sidebarHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "#9ca3af",
  margin: "0 0 8px",
  fontWeight: 700,
};

const sidebarItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "8px 10px",
  borderRadius: 6,
  textDecoration: "none",
  color: "#111",
  marginBottom: 3,
  border: "1px solid transparent",
};

const sidebarItemActiveStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #4F6EF7",
  boxShadow: "0 1px 2px rgba(79,110,247,0.1)",
};

const editableBadgeStyle: React.CSSProperties = {
  marginLeft: 5,
  fontSize: 10,
  color: "#4F6EF7",
};

const mainStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const metaBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "12px 16px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fafafa",
};

const widthBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const widthBtnActiveStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  borderColor: "#111",
};

const editToggleBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff",
  color: "#4F6EF7",
  border: "1px solid #4F6EF7",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const iframeWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: 16,
  background: "#f3f4f6",
  borderRadius: 8,
  minHeight: 500,
};

const phoneWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: 24,
  background: "#f3f4f6",
  borderRadius: 8,
};

const phoneStyle: React.CSSProperties = {
  width: 300,
  minHeight: 460,
  background: "#1c1c1e",
  borderRadius: 36,
  border: "8px solid #2a2a2e",
  overflow: "hidden",
  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
  display: "flex",
  flexDirection: "column",
};

const phoneStatusBar: React.CSSProperties = {
  padding: "10px 16px 6px",
  fontSize: 11,
  fontWeight: 600,
  color: "rgba(255,255,255,0.4)",
  textAlign: "center",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const phoneChatArea: React.CSSProperties = {
  flex: 1,
  padding: "16px 12px",
  overflowY: "auto",
};

const phoneTimestamp: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(255,255,255,0.25)",
  fontWeight: 500,
};

const smsBubbleStyle: React.CSSProperties = {
  background: "#2c2c2e",
  borderRadius: "16px 16px 16px 4px",
  padding: "10px 14px",
  fontSize: 13,
  color: "rgba(255,255,255,0.85)",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxWidth: "90%",
};

const editPanelStyle: React.CSSProperties = {
  border: "1px solid #e0e7ff",
  borderRadius: 8,
  padding: "20px 20px 16px",
  background: "#f8f9ff",
};

const editPanelHeadingStyle: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 15,
  fontWeight: 700,
  color: "#1e1b4b",
};

const editHintStyle: React.CSSProperties = {
  margin: "0 0 14px",
  fontSize: 13,
  color: "#6b7280",
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 13,
  color: "#374151",
  fontWeight: 600,
};

const textInputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  fontWeight: 400,
};

const textareaStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  fontWeight: 400,
  resize: "vertical",
  lineHeight: 1.55,
  width: "100%",
  boxSizing: "border-box",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "9px 22px",
  background: "#4F6EF7",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const savedMsgStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#059669",
  fontWeight: 500,
};

const errorMsgStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#dc2626",
  fontWeight: 500,
};

const applyBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 4,
};

const langBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "7px 0",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "center",
  textDecoration: "none",
  letterSpacing: "0.04em",
};

const langBtnActiveStyle: React.CSSProperties = {
  background: "#4F6EF7",
  color: "#fff",
  borderColor: "#4F6EF7",
};

const codeStyle: React.CSSProperties = {
  background: "#f3f4f6",
  borderRadius: 3,
  padding: "1px 5px",
  fontSize: 12,
  fontFamily: "monospace",
  color: "#374151",
};
