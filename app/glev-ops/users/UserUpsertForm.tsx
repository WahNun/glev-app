"use client";

import { useState, useTransition } from "react";
import { upsertUserAction, type UpsertUserResult } from "./actions";

const GIFT_LABEL_OPTIONS = [
  { value: "", label: "— kein Tag —" },
  { value: "Geschenkt", label: "Geschenkt" },
  { value: "Friends & Family", label: "Friends & Family" },
  { value: "Diablog.inn", label: "Diablog.inn" },
  { value: "Beta-Tester", label: "Beta-Tester" },
  { value: "Influencer", label: "Influencer" },
  { value: "Presse", label: "Presse" },
  { value: "custom", label: "Benutzerdefiniert…" },
];

const DURATION_OPTIONS = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "1 Monat" },
  { value: "90d", label: "3 Monate" },
  { value: "180d", label: "6 Monate" },
  { value: "365d", label: "1 Jahr" },
  { value: "unlimited", label: "Unbegrenzt" },
  { value: "custom", label: "Benutzerdefiniert…" },
];

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  beta: "Smart (S)",
  pro: "Pro (M)",
  plus: "Plus (L)",
};

export default function UserUpsertForm() {
  const [result, setResult] = useState<UpsertUserResult | null>(null);
  const [pending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("de");
  const [plan, setPlan] = useState("free");
  const [duration, setDuration] = useState("365d");
  const [customDate, setCustomDate] = useState("");
  const [giftLabel, setGiftLabel] = useState("");
  const [giftLabelCustom, setGiftLabelCustom] = useState("");
  const [manualPlanNote, setManualPlanNote] = useState("");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [activateTrial, setActivateTrial] = useState(false);

  function reset() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setLanguage("de");
    setPlan("free");
    setDuration("365d");
    setCustomDate("");
    setGiftLabel("");
    setGiftLabelCustom("");
    setManualPlanNote("");
    setSendWelcome(true);
    setActivateTrial(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("firstName", firstName);
      fd.set("lastName", lastName);
      fd.set("phone", phone);
      fd.set("language", language);
      fd.set("plan", plan);
      fd.set("duration", duration);
      fd.set("customDate", customDate);
      fd.set("giftLabel", giftLabel);
      fd.set("giftLabelCustom", giftLabelCustom);
      fd.set("manualPlanNote", manualPlanNote);
      if (sendWelcome) fd.set("sendWelcome", "1");
      if (activateTrial) fd.set("activateTrial", "1");

      const r = await upsertUserAction(fd);
      setResult(r);
      if (r.ok) reset();
    });
  }

  const planIsActive = plan !== "free";
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <section style={sectionStyle}>
      <h2 style={titleStyle}>User anlegen / Plan setzen</h2>
      <p style={descStyle}>
        Legt einen neuen Account an oder aktualisiert einen bestehenden — in einem Schritt.
        Upsert-Logik: existierender User → Plan + Label updaten · neuer User → Account + Plan.
        Wenn Plan = Free: nur Account anlegen / Metadaten updaten ohne Override.
      </p>

      <form onSubmit={handleSubmit}>
        {/* Zeile 1: E-Mail, Vorname, Nachname */}
        <div style={rowStyle}>
          <div style={{ ...fieldGroup, flex: "2 1 220px" }}>
            <label style={labelStyle}>E-Mail *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              style={inputStyle}
            />
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>Vorname</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Max"
              style={inputStyle}
            />
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>Nachname</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Mustermann"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Zeile 2: Telefon, Sprache */}
        <div style={rowStyle}>
          <div style={fieldGroup}>
            <label style={labelStyle}>Telefon</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+4917612345678"
              style={inputStyle}
            />
          </div>
          <div style={{ ...fieldGroup, flex: "0 0 110px" }}>
            <label style={labelStyle}>Sprache</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={inputStyle}
            >
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
          </div>
        </div>

        {/* Zeile 3: Plan, Dauer, (Custom-Datepicker) */}
        <div style={rowStyle}>
          <div style={fieldGroup}>
            <label style={labelStyle}>Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              style={inputStyle}
            >
              <option value="free">Free (kein Override)</option>
              <option value="beta">S — Smart</option>
              <option value="pro">M — Pro</option>
              <option value="plus">L — Plus</option>
            </select>
          </div>
          <div style={fieldGroup}>
            <label style={labelStyle}>Dauer</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              disabled={!planIsActive}
              style={{ ...inputStyle, opacity: planIsActive ? 1 : 0.4 }}
            >
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {duration === "custom" && planIsActive && (
            <div style={fieldGroup}>
              <label style={labelStyle}>Ablaufdatum</label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={todayIso}
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {/* Zeile 4: Tag/Label + Notiz */}
        <div style={rowStyle}>
          <div style={fieldGroup}>
            <label style={labelStyle}>Tag / Label</label>
            <select
              value={giftLabel}
              onChange={(e) => setGiftLabel(e.target.value)}
              style={inputStyle}
            >
              {GIFT_LABEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {giftLabel === "custom" && (
            <div style={fieldGroup}>
              <label style={labelStyle}>Eigener Tag</label>
              <input
                type="text"
                value={giftLabelCustom}
                onChange={(e) => setGiftLabelCustom(e.target.value)}
                placeholder="z.B. Partnerschaft"
                style={inputStyle}
              />
            </div>
          )}
          <div style={{ ...fieldGroup, flex: "2 1 200px" }}>
            <label style={labelStyle}>Notiz (intern)</label>
            <input
              type="text"
              value={manualPlanNote}
              onChange={(e) => setManualPlanNote(e.target.value)}
              placeholder="Interne Notiz (optional)"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Zeile 5: Checkboxen */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ ...checkLabel, opacity: planIsActive ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={sendWelcome}
              onChange={(e) => setSendWelcome(e.target.checked)}
              disabled={!planIsActive}
            />
            {" "}Welcome-Mail senden
          </label>
          <label style={{ ...checkLabel, opacity: planIsActive ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={activateTrial}
              onChange={(e) => setActivateTrial(e.target.checked)}
              disabled={!planIsActive}
            />
            {" "}Trial aktivieren (7 Tage)
          </label>
        </div>

        {/* Submit + Ergebnis */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="submit" disabled={pending} style={{ ...btnStyle, opacity: pending ? 0.6 : 1 }}>
            {pending
              ? "Wird gespeichert…"
              : planIsActive
                ? "Account anlegen / Plan setzen"
                : "Account anlegen / aktualisieren"}
          </button>
          {result?.ok && (
            <p style={successStyle}>
              ✓ <strong>{result.email}</strong>{" "}
              {result.isNew ? "angelegt" : "aktualisiert"}
              {result.plan !== "free"
                ? ` — ${PLAN_LABELS[result.plan] ?? result.plan}${
                    result.expiresAt
                      ? ` bis ${result.expiresAt.slice(0, 10)}`
                      : " (unbegrenzt)"
                  }`
                : ""}
            </p>
          )}
          {result && !result.ok && <p style={errStyle}>❌ {result.error}</p>}
        </div>
      </form>
    </section>
  );
}

// --- Styles ---

const sectionStyle: React.CSSProperties = {
  background: "#f0f9ff",
  border: "1px solid #bae6fd",
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 20,
};
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "#0369a1",
};
const descStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#0369a1",
  margin: "0 0 14px",
  lineHeight: 1.5,
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 10,
  alignItems: "flex-end",
};
const fieldGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  flex: "1 1 150px",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#374151",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
const checkLabel: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#0369a1",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const successStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 13,
  margin: 0,
  background: "#ecfdf5",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #a7f3d0",
};
const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 13,
  margin: 0,
};
