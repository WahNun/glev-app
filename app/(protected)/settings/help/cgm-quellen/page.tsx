"use client";

/**
 * /settings/help/cgm-quellen — In-App help page that explains the
 * three CGM sources (LLU, Apple Health, Nightscout), how often new
 * values arrive, and which path fits which user.
 *
 * Lucas-spec (2026-05-15): "PDF ist unnötiges Format für User der
 * App — bau es als normalen Tab hinter dem Button in den Einstellungen
 * ein, mit Zurück-zu-Einstellungen-Button oben." Content mirrors
 * scripts/generate-cgm-matrix-pdf.mjs 1:1 (same DE/EN tables, callout,
 * source cards, bullets, help-row matrix) so the PDF stays as an
 * optional download via the script if needed in future.
 *
 * Locale: picks DE or EN content from useLocale(); no extra i18n
 * keys in messages/*.json beyond the back-link label, since the body
 * is long-form prose maintained as inline literals (same approach as
 * the PDF generator).
 */

import React from "react";
import Link from "next/link";
import { useLocale } from "next-intl";

const ACCENT      = "#4F6EF7";
const SURFACE     = "#111117";
const SURFACE_ALT = "#141420";
const BORDER      = "rgba(255,255,255,0.08)";
const TEXT        = "#FFFFFF";
const TEXT_STRONG = "rgba(255,255,255,0.85)";
const TEXT_SOFT   = "rgba(255,255,255,0.65)";
const TEXT_MUTED  = "rgba(255,255,255,0.45)";

type Content = {
  back: string;
  kicker: string;
  h1: string;
  sub: string;
  th2a: string;
  thCols: [string, string, string, string, string];
  rows: Array<[string, string, string, string, string]>;
  callout: string;
  th2b: string;
  src: Array<[string, string]>;
  th2c: string;
  bullets: string[];
  th2d: string;
  help: Array<[string, string]>;
  disclaimer: string;
};

const DE: Content = {
  back: "Zurück zu Einstellungen",
  kicker: "HILFE · CGM-QUELLEN",
  h1: "Wie kommen deine Glukose-Werte in Glev?",
  sub: "Glev liest deinen Sensor nicht selbst aus. Es bekommt die Werte von einer App auf deinem Handy. Welche App du nutzt, entscheidet, wie oft du in Glev einen neuen Wert siehst.",
  th2a: "Übersicht: was passt zu deinem Setup?",
  thCols: ["SENSOR", "APP AUF DEM HANDY", "GLEV-QUELLE", "NEUER WERT", "WAS DU SIEHST"],
  rows: [
    ["Libre 2",       "LibreLink",                       "LLU",          "alle ~2 min (Live)", "Live-Wert von Abbott alle 2 Minuten + 12h Backfill in 15-Min-Schritten. Sehr kurze Tiefs unter 2 min können fehlen."],
    ["Libre 2",       "xDrip4iOS / iAPS / Loop",         "Apple Health", "jede Minute",        "Lückenlose Kurve in Echtzeit."],
    ["Libre 2",       "xDrip4iOS / iAPS / Loop",         "Nightscout",   "jede Minute",        "Lückenlose Kurve in Echtzeit."],
    ["Libre 3",       "LibreLink (Deutschland)",         "LLU",          "alle ~2 min (Live)", "Wie Libre 2: Live-Wert alle ~2 Minuten + 15-Min-Backfill."],
    ["Libre 3",       "xDrip4iOS / Juggluco",            "Health od. NS","jede Minute",        "Lückenlose Kurve in Echtzeit."],
    ["Dexcom G6",     "Dexcom-App",                      "Apple Health", "alle 5 min",         "Sehr gute Auflösung — der Sensor selbst misst nur alle 5 Minuten."],
    ["Dexcom G7",     "Dexcom-App",                      "Apple Health", "alle 5 min",         "Wie G6. G7 ist nur kleiner und schneller einsatzbereit, nicht „genauer“."],
    ["Dexcom G6/G7",  "Loop / Loop Follow / xDrip",      "Nightscout",   "alle 5 min",         "Wie über Apple Health, nur via Nightscout-Server."],
    ["Medtronic Guardian 3/4", "Guardian Connect + CareLink-Bridge", "Nightscout", "alle 5 min", "Funktioniert nur über eine kleine Bridge-Software (carelink-uploader o. ä.) zu Nightscout."],
    ["Medtronic Simplera",     "Simplera-App + CareLink-Bridge",     "Nightscout", "alle 5 min", "Wie Guardian: Bridge nötig, dann saubere 5-Minuten-Werte."],
    ["Medtronic 770G/780G",    "CareLink (Pumpe als Quelle)",        "Nightscout", "alle 5 min", "Pumpen-Werte fließen über CareLink → Bridge → Nightscout. Latenz oft 10-15 min."],
  ],
  callout: "Glev holt sich seit Mai 2026 alle 2 Minuten neue Werte von deiner Quelle (vorher alle 5). Bei LLU speichert Glev jetzt zusätzlich den Live-Wert aus jedem Poll — Libre-Nutzer sehen damit alle ~2 Minuten einen frischen Punkt statt nur alle 15 Minuten. Apple Health und Nightscout liefern weiterhin in der Auflösung deiner Quell-App.",
  th2b: "Die drei Glev-Quellen, einfach erklärt",
  src: [
    ["1. LLU — der einfachste Weg",
     "Glev holt deinen Live-Wert alle 2 Minuten direkt von Abbott ab und speichert ihn. Du siehst also fast in Echtzeit was gerade passiert — keine 15-Minuten-Lücken mehr im laufenden Betrieb. Zusätzlich bekommst du die letzten 12 Stunden als Verlauf in 15-Minuten-Schritten. Vorteil: kein Extra-Setup, in 5 Minuten fertig. Nachteil: Hypos die kürzer als 2 Minuten dauern können noch unsichtbar bleiben — im Zweifel kurz mit dem Finger messen und manuell eintragen."],
    ["2. Apple Health — die beste Auflösung auf dem iPhone",
     "Apple Health ist die Gesundheits-App von Apple, die alle deine Apps gemeinsam nutzen können. Eine andere App (z. B. xDrip oder die Dexcom-App) liest deinen Sensor live aus und legt jeden Wert in Apple Health ab. Glev liest die Werte von dort. Vorteil: jeder Wert ist sofort da, lückenlos, ohne Cloud-Umweg. Nachteil: nur auf dem iPhone, du musst einmal die andere App einrichten und Glev die Berechtigung geben."],
    ["3. Nightscout — die offene Lösung für iPhone und Android",
     "Nightscout ist ein kleiner Server, den du dir selbst (oder mit Hilfe der Diabetes-Community) einmalig aufsetzt. Eine Uploader-App auf deinem Handy schickt deine Werte dorthin, Glev liest sie ab. Vorteil: funktioniert auf iPhone und Android und du hast deine Daten unter Kontrolle. Nachteil: einmalig 2-4 Stunden Einrichtung. Ideal wenn du schon mit Loop, AAPS oder xDrip arbeitest."],
  ],
  th2c: "Gut zu wissen",
  bullets: [
    "Wenn du in Deutschland einen Libre 2 oder Libre 3 hast und nur die LibreLink-App nutzt, hast du seit Mai 2026 in Glev fast Echtzeit-Werte (alle ~2 Minuten ein frischer Live-Punkt). Der historische Backfill bleibt aber in 15-Minuten-Schritten — wenn du dir alte Tage anschaust, siehst du keine Sub-15-Minuten-Tiefs.",
    "Dexcom-Sensoren messen prinzipbedingt alle 5 Minuten — egal welchen Weg du wählst. Das ist eine Hardware-Eigenschaft, keine Software-Einstellung.",
    "Medtronic-Nutzer: Glev hat aktuell keinen Direkt-Anschluss an CareLink (Medtronics Cloud). Realistisch ist Nightscout über eine kleine Bridge-Software wie carelink-uploader (Docker / Synology) oder 600SeriesAndroidUploader. Wer schon mit AndroidAPS oder Loop arbeitet hat das meist sowieso laufen. Wenn du Hilfe beim Setup brauchst, schreib uns an hello@glev.app.",
    "Manuelle Fingerstick-Werte, die du in Glev einträgst, werden immer berücksichtigt und im Diagramm als kleines Quadrat markiert. Wenn du auf LLU bist und einen Verdacht auf Unterzucker hast, miss kurz mit dem Finger und trage es ein.",
    "Die Hypo-Erkennung in Insights kann nur das zählen, was sie sieht. Live-LLU-Werte (alle ~2 min) erwischen die meisten Tiefs; im 15-Minuten-Backfill werden nur Tiefs erfasst, die mindestens 15 Minuten dauern oder zufällig auf einen Messpunkt fallen.",
    "Die Glev-Engine arbeitet mit allen drei Quellen gleich gut — sie nutzt für Empfehlungen den Wert, der zur Mahlzeit am nächsten dran liegt.",
  ],
  th2d: "Welche Quelle passt zu dir?",
  help: [
    ["LLU",          "Du willst loslegen ohne Bastelei. Seit Mai 2026 fast in Echtzeit (~2-Min-Live-Werte). Klassisch und einfachster Weg für DACH-Libre-Nutzer."],
    ["Apple Health", "Du hast ein iPhone und nutzt schon eine Live-App wie xDrip, Loop, iAPS oder die Dexcom-App. Beste Kombination aus Komfort und Auflösung."],
    ["Nightscout",   "Du hast Android (oder willst plattformunabhängig sein), bist technikaffin oder läufst sowieso schon mit Loop/AAPS/xDrip. Volle Datenhoheit."],
  ],
  disclaimer: "Glev ist ein Dokumentations- und Organisations-Tool, kein Medizinprodukt. Therapieentscheidungen triffst du gemeinsam mit deinem Arzt. · hello@glev.app",
};

const EN: Content = {
  back: "Back to Settings",
  kicker: "HELP · CGM SOURCES",
  h1: "How your glucose values reach Glev",
  sub: "Glev doesn't read your sensor directly. It picks up the values from another app on your phone. Which app you use decides how often you see a new value in Glev.",
  th2a: "Overview: what fits your setup?",
  thCols: ["SENSOR", "APP ON YOUR PHONE", "GLEV SOURCE", "NEW VALUE", "WHAT YOU SEE"],
  rows: [
    ["Libre 2",       "LibreLink",                       "LLU",          "every ~2 min (live)","Live value from Abbott every 2 min + 12h backfill in 15-min steps. Very short lows under 2 min can be missed."],
    ["Libre 2",       "xDrip4iOS / iAPS / Loop",         "Apple Health", "every minute",       "Smooth, gap-free curve in real time."],
    ["Libre 2",       "xDrip4iOS / iAPS / Loop",         "Nightscout",   "every minute",       "Smooth, gap-free curve in real time."],
    ["Libre 3",       "LibreLink (DACH)",                "LLU",          "every ~2 min (live)","Same as Libre 2: live value every ~2 min + 15-min backfill."],
    ["Libre 3",       "xDrip4iOS / Juggluco",            "Health or NS", "every minute",       "Smooth, gap-free curve in real time."],
    ["Dexcom G6",     "Dexcom app",                      "Apple Health", "every 5 min",        "Very good resolution — the sensor itself only measures every 5 minutes."],
    ["Dexcom G7",     "Dexcom app",                      "Apple Health", "every 5 min",        "Same as G6. G7 is only smaller and faster to warm up, not \"more accurate\"."],
    ["Dexcom G6/G7",  "Loop / Loop Follow / xDrip",      "Nightscout",   "every 5 min",        "Same as via Apple Health, but through a Nightscout server."],
    ["Medtronic Guardian 3/4", "Guardian Connect + CareLink bridge", "Nightscout", "every 5 min", "Only works via a small bridge tool (carelink-uploader or similar) into Nightscout."],
    ["Medtronic Simplera",     "Simplera app + CareLink bridge",     "Nightscout", "every 5 min", "Same as Guardian: bridge needed, then clean 5-minute values."],
    ["Medtronic 770G/780G",    "CareLink (pump as source)",          "Nightscout", "every 5 min", "Pump values flow via CareLink → bridge → Nightscout. Latency often 10-15 min."],
  ],
  callout: "Since May 2026 Glev pulls new values from your source every 2 minutes (used to be every 5). For LLU, Glev now also stores the live value from each poll — Libre users see a fresh point every ~2 minutes instead of only every 15. Apple Health and Nightscout keep delivering at whatever resolution your source app produces.",
  th2b: "The three Glev sources, plain English",
  src: [
    ["1. LLU — the easiest path",
     "Glev pulls your live value directly from Abbott every 2 minutes and stores it. So you see what's happening almost in real time — no more 15-minute gaps during live operation. On top of that you get the last 12 hours as a backfill in 15-minute steps. Upside: no extra setup, done in 5 minutes. Downside: hypos shorter than 2 minutes can still stay invisible — when in doubt take a quick fingerstick and log it manually."],
    ["2. Apple Health — the best resolution on iPhone",
     "Apple Health is Apple's health app that all your apps can share. Another app (e.g. xDrip or the Dexcom app) reads your sensor live and stores every value in Apple Health. Glev reads the values from there. Upside: every value arrives instantly, gap-free, no cloud detour. Downside: iPhone only, you have to set up the other app once and grant Glev permission."],
    ["3. Nightscout — the open solution for iPhone and Android",
     "Nightscout is a small server that you (or someone from the diabetes community) sets up once. An uploader app on your phone sends your values there, Glev reads them. Upside: works on iPhone and Android and you stay in control of your data. Downside: 2-4 hours of one-time setup. Ideal if you already use Loop, AAPS or xDrip."],
  ],
  th2c: "Good to know",
  bullets: [
    "If you're in Germany/Austria/Switzerland with a Libre 2 or Libre 3 and only use the LibreLink app, since May 2026 you get near real-time values in Glev (a fresh live point every ~2 minutes). The historical backfill still runs at 15-minute steps though — when you look at past days you won't see sub-15-minute lows.",
    "Dexcom sensors only measure every 5 minutes by design — no matter which path you choose. That's a hardware property, not a software setting.",
    "Medtronic users: Glev currently has no direct connection to CareLink (Medtronic's cloud). The realistic path is Nightscout via a small bridge tool like carelink-uploader (Docker / Synology) or 600SeriesAndroidUploader. If you already run AndroidAPS or Loop you most likely have this in place. Drop us a line at hello@glev.app if you need help with setup.",
    "Manual fingerstick values that you log in Glev are always counted and shown as a small square on the chart. If you're on LLU and suspect a low, take a quick fingerstick and log it.",
    "The hypo detection in Insights can only count what it sees. Live LLU values (every ~2 min) catch most lows; in the 15-minute backfill only lows that last at least 15 minutes (or land exactly on a measurement point) are detected.",
    "The Glev engine works equally well with all three sources — for recommendations it uses the value closest in time to the meal.",
  ],
  th2d: "Which source fits you?",
  help: [
    ["LLU",          "You want to start without tinkering. Since May 2026 it's near real-time (~2-min live values). The classic and simplest path for DACH Libre users."],
    ["Apple Health", "You have an iPhone and already use a live app like xDrip, Loop, iAPS or the Dexcom app. Best mix of comfort and resolution."],
    ["Nightscout",   "You have Android (or want platform independence), are tech-minded, or already run Loop/AAPS/xDrip. Full data sovereignty."],
  ],
  disclaimer: "Glev is a documentation and organisation tool, not a medical device. Therapy decisions are made together with your doctor. · hello@glev.app",
};

export default function CgmSourcesHelpPage() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16, paddingBottom: 80, color: TEXT_STRONG }}>
      {/* Back link + page header */}
      <Link
        href="/settings"
        style={{ fontSize: 13, color: ACCENT, textDecoration: "none", display: "inline-block", marginBottom: 12 }}
      >
        ← {C.back}
      </Link>
      <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: "0.15em", marginBottom: 6 }}>
        {C.kicker}
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", margin: 0, lineHeight: 1.18, color: TEXT }}>
        {C.h1}
      </h1>
      <p style={{ fontSize: 14, color: TEXT_SOFT, marginTop: 10, marginBottom: 22, lineHeight: 1.55 }}>
        {C.sub}
      </p>

      {/* Section A — Overview table */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginTop: 22, marginBottom: 10 }}>
        {C.th2a}
      </h2>
      <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(90px, 1.1fr) minmax(120px, 1.6fr) minmax(80px, 1fr) minmax(90px, 1.1fr) minmax(140px, 2.2fr)",
          gap: 8,
          background: SURFACE_ALT,
          padding: "10px 12px",
          fontSize: 10,
          fontWeight: 700,
          color: TEXT_MUTED,
          letterSpacing: "0.08em",
          borderBottom: `1px solid ${BORDER}`,
        }}>
          {C.thCols.map((h, i) => <div key={i}>{h}</div>)}
        </div>
        {/* Table rows */}
        {C.rows.map((row, i) => (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "minmax(90px, 1.1fr) minmax(120px, 1.6fr) minmax(80px, 1fr) minmax(90px, 1.1fr) minmax(140px, 2.2fr)",
            gap: 8,
            padding: "10px 12px",
            fontSize: 12.5,
            color: TEXT_STRONG,
            borderBottom: i === C.rows.length - 1 ? "none" : `1px solid ${BORDER}`,
            lineHeight: 1.45,
          }}>
            <div style={{ fontWeight: 700, color: TEXT }}>{row[0]}</div>
            <div>{row[1]}</div>
            <div style={{ fontWeight: 700, color: TEXT }}>{row[2]}</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: TEXT }}>{row[3]}</div>
            <div style={{ color: TEXT_SOFT }}>{row[4]}</div>
          </div>
        ))}
      </div>

      {/* Callout */}
      <div style={{
        background: SURFACE,
        borderLeft: `3px solid ${ACCENT}`,
        borderRadius: 6,
        padding: "12px 14px",
        marginTop: 12,
        marginBottom: 8,
        fontSize: 13,
        lineHeight: 1.55,
        color: TEXT_STRONG,
      }}>
        {C.callout}
      </div>

      {/* Section B — Source cards */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginTop: 28, marginBottom: 12 }}>
        {C.th2b}
      </h2>
      {C.src.map(([label, body], i) => (
        <div key={i} style={{
          background: SURFACE,
          borderLeft: `3px solid ${ACCENT}`,
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 6, letterSpacing: "-0.01em" }}>
            {label}
          </div>
          <div style={{ fontSize: 13, color: TEXT_SOFT, lineHeight: 1.6 }}>
            {body}
          </div>
        </div>
      ))}

      {/* Section C — Bullets */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginTop: 28, marginBottom: 12 }}>
        {C.th2c}
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {C.bullets.map((b, i) => (
          <li key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 13, lineHeight: 1.55, color: TEXT_STRONG }}>
            <span style={{ color: ACCENT, fontWeight: 700, lineHeight: 1.5 }}>•</span>
            <span style={{ flex: 1 }}>{b}</span>
          </li>
        ))}
      </ul>

      {/* Section D — Help matrix */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginTop: 28, marginBottom: 12 }}>
        {C.th2d}
      </h2>
      {C.help.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ width: 110, flexShrink: 0, fontWeight: 700, color: ACCENT }}>{k}</div>
          <div style={{ flex: 1, color: TEXT_STRONG }}>{v}</div>
        </div>
      ))}

      {/* Disclaimer */}
      <p style={{ marginTop: 36, fontSize: 11, color: TEXT_MUTED, lineHeight: 1.5 }}>
        {C.disclaimer}
      </p>
    </div>
  );
}
