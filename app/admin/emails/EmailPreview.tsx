"use client";

import { useMemo, useState } from "react";

export type TemplateOption = {
  key: string;
  label: string;
  whenSent: string;
  subject: string;
  html: string;
};

type Props = {
  templates: TemplateOption[];
  selectedKey: string;
  name: string;
  email: string;
  locale: "de" | "en";
};

type Width = "desktop" | "mobile";

// Mobile-Breite orientiert sich an iPhone 13 mini (375px). Desktop-Breite
// 600px ist der typische Mail-Client-Inhaltsbereich (Gmail Web rendert
// um diese Breite); breiter macht für die meisten Empfänger keinen Sinn.
const WIDTH_PX: Record<Width, number> = {
  desktop: 600,
  mobile: 375,
};

/**
 * Sidebar + iframe-Preview. Die Auswahl des Templates läuft über echte
 * Links (kein Client-State), damit der Operator die URL kopieren und
 * teilen kann (z. B. „schau dir mal /admin/emails?t=drip-day14 an"). Die
 * Variablen-Inputs (Name, Email-Adresse) submitten als GET-Form, was die
 * URL-Params aktualisiert und den Server die Templates neu rendern
 * lässt — wieder share-bar und reload-fest.
 *
 * Lokal Client-State haben nur Sachen die nicht in die URL gehören:
 * Desktop/Mobile-Toggle.
 */
export default function EmailPreview({
  templates,
  selectedKey,
  name,
  email,
  locale,
}: Props) {
  const [width, setWidth] = useState<Width>("desktop");

  const selected = useMemo(
    () => templates.find((t) => t.key === selectedKey) ?? templates[0],
    [templates, selectedKey],
  );

  return (
    <div style={layoutStyle}>
      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <h2 style={sidebarHeadingStyle}>Templates</h2>
        <nav>
          {templates.map((t) => {
            const isActive = t.key === selected.key;
            const href = buildHref(t.key, name, email, locale);
            return (
              <a
                key={t.key}
                href={href}
                style={{
                  ...sidebarItemStyle,
                  ...(isActive ? sidebarItemActiveStyle : null),
                }}
              >
                <span style={{ fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>{t.whenSent}</span>
              </a>
            );
          })}
        </nav>

        {/* Sprach-Toggle: zeigt das aktuell selektierte Template in der
            jeweils anderen Sprache. Echte Links statt Client-State, damit
            man die URL teilen kann ("schau dir mal die EN-Variante an")
            und damit Reload den Stand beibehält. */}
        <h2 style={{ ...sidebarHeadingStyle, marginTop: 24 }}>Sprache</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <a
            href={buildHref(selected.key, name, email, "de")}
            style={{
              ...langBtnStyle,
              ...(locale === "de" ? langBtnActiveStyle : null),
            }}
          >
            DE
          </a>
          <a
            href={buildHref(selected.key, name, email, "en")}
            style={{
              ...langBtnStyle,
              ...(locale === "en" ? langBtnActiveStyle : null),
            }}
          >
            EN
          </a>
        </div>

        <h2 style={{ ...sidebarHeadingStyle, marginTop: 24 }}>Variablen</h2>
        <form method="get" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* `t` und `lang` mit-submitten, sonst springt die Auswahl beim
              Apply zurück auf das erste Template / Default-Sprache. */}
          <input type="hidden" name="t" value={selected.key} />
          <input type="hidden" name="lang" value={locale} />
          <label style={labelStyle}>
            Vorname (Anrede)
            <input
              type="text"
              name="name"
              defaultValue={name}
              placeholder="Julia"
              style={textInputStyle}
            />
          </label>
          <label style={labelStyle}>
            Empfänger-Adresse
            <input
              type="email"
              name="email"
              defaultValue={email}
              placeholder="julia@example.com"
              style={textInputStyle}
            />
          </label>
          <button type="submit" style={applyBtnStyle}>
            Übernehmen
          </button>
        </form>

        <p style={hintStyle}>
          Inhalt änderst du in <code>lib/emails/*</code>. Diese Seite zeigt
          live, was rauskommt.
        </p>
      </aside>

      {/* Preview */}
      <section style={mainStyle}>
        <div style={metaBarStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Subject</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#0f172a",
                overflowWrap: "anywhere",
              }}
            >
              {selected.subject}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setWidth("desktop")}
              style={{ ...widthBtnStyle, ...(width === "desktop" ? widthBtnActiveStyle : null) }}
            >
              Desktop
            </button>
            <button
              type="button"
              onClick={() => setWidth("mobile")}
              style={{ ...widthBtnStyle, ...(width === "mobile" ? widthBtnActiveStyle : null) }}
            >
              Mobil
            </button>
          </div>
        </div>

        <div style={iframeWrapStyle}>
          <iframe
            // `key` zwingt React beim Wechsel des Templates oder der Breite
            // einen Remount des iframes — ohne den behält der iframe seinen
            // alten Inhalt und srcDoc-Updates wirken nicht zuverlässig.
            key={`${selected.key}-${width}`}
            title={`Mail-Preview: ${selected.label}`}
            srcDoc={selected.html}
            // Strikter Sandbox ohne Tokens — kein JS, keine Same-Origin,
            // keine Forms, keine Top-Level-Navigation. Die Mail-Templates
            // setzen aktuell ihren Vornamen unescaped via String-Inter-
            // polation in HTML-Attribute. Würde der iframe Skripte
            // ausführen UND Same-Origin gelten, könnte ein präparierter
            // Link wie /admin/emails?name=<script>… serverseitige Admin-
            // Actions im Eltern-Tab triggern. Sandbox ohne Tokens
            // schließt diesen Vektor vollständig — Mail-HTML enthält
            // ohnehin nur Markup, keine interaktiven Elemente.
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
      </section>
    </div>
  );
}

function buildHref(
  key: string,
  name: string,
  email: string,
  locale: "de" | "en",
): string {
  const sp = new URLSearchParams();
  sp.set("t", key);
  if (name) sp.set("name", name);
  if (email) sp.set("email", email);
  sp.set("lang", locale);
  return `/admin/emails?${sp.toString()}`;
}

const langBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 0",
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

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "260px 1fr",
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
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#6b7280",
  margin: "0 0 8px",
  fontWeight: 700,
};

const sidebarItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "10px 12px",
  borderRadius: 6,
  textDecoration: "none",
  color: "#111",
  fontSize: 13,
  marginBottom: 4,
  border: "1px solid transparent",
};

const sidebarItemActiveStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #4F6EF7",
  boxShadow: "0 1px 2px rgba(79,110,247,0.15)",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "#374151",
};

const textInputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

const applyBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  marginTop: 16,
  lineHeight: 1.5,
};

const mainStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const metaBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
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
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const widthBtnActiveStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  borderColor: "#111",
};

const iframeWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: 16,
  background: "#f3f4f6",
  borderRadius: 8,
  minHeight: 900,
};
