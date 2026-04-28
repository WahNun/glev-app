# REPLIT PROMPT — Dexcom Partnership Mockups (PNG)

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## AUFGABE

Erstelle zwei PNG-Grafiken für den Dexcom Partnership Questionnaire:

1. **`public/mockup-consent-flow.png`** — App-Mockup: Einwilligungs-Screen (Consent / Opt-In)
2. **`public/mockup-data-flow.png`** — Datenfluss-Diagramm: Dexcom → Glev → Supabase

---

## TECHNISCHE ANFORDERUNGEN

- Node.js Script (`scripts/generate-mockups.js`)
- Library: `canvas` (`npm install canvas`)
- Ausgabe: PNG-Dateien unter `public/`
- Kein Browser, kein Puppeteer — reines Node canvas

---

## GRAFIK 1 — Consent Flow Mockup (`mockup-consent-flow.png`)

Größe: 390 × 780px (iPhone-Hochformat)

Inhalt (von oben nach unten):

```
┌─────────────────────────────┐  Hintergrund: #111117
│  ← Verbindung einrichten    │  Header: 16px, weiß, links mit Zurück-Pfeil
│                             │
│  [Glev Logo — Text "glev"]  │  Mitte, #4F6EF7, 28px, bold
│                             │
│  Dexcom G7 verbinden        │  20px, weiß, bold, zentriert
│  Daten sicher teilen        │  14px, rgba(255,255,255,0.6), zentriert
│                             │
│  ┌─────────────────────┐    │  Weißer Kasten (border-radius 16, bg #1C1C28)
│  │ 🔒 Welche Daten?   │    │  Überschrift 13px #4F6EF7
│  │ • Glukosewerte      │    │  Liste mit • Bullet, 12px weiß
│  │ • Trendpfeile       │
│  │ • Kalibrierdaten    │
│  └─────────────────────┘
│                             │
│  ┌─────────────────────┐    │  Zweiter Kasten
│  │ 📋 Deine Rechte    │    │
│  │ • Jederzeit widerrufbar  │
│  │ • Nur für Glev genutzt   │
│  │ • DSGVO-konform     │
│  └─────────────────────┘
│                             │
│  [  Verbindung erlauben  ]  │  Button: #4F6EF7, weiß, volle Breite, radius 12
│  [ Ablehnen ]               │  Ghost-Button: transparent, #4F6EF7 Text
│                             │
│  Datenschutz · AGB          │  Footer, 10px, gedimmt, zentriert
└─────────────────────────────┘
```

Farben:
- Background: `#111117`
- Accent: `#4F6EF7`
- Text: `#FFFFFF`
- Text dimmed: `rgba(255,255,255,0.5)`
- Card background: `#1C1C28`
- Card border: `rgba(255,255,255,0.08)`

---

## GRAFIK 2 — Data Flow Diagram (`mockup-data-flow.png`)

Größe: 900 × 500px (Querformat)

Inhalt: Technisches Flussdiagramm, Dark-Style

```
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────────┐
│  Dexcom  │────▶│  Dexcom API  │────▶│   Glev   │────▶│   Supabase   │
│  Sensor  │     │  (OAuth 2.0) │     │  Server  │     │  (EU, DE)    │
└──────────┘     └──────────────┘     └──────────┘     └──────────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │  Glev App    │
                                    │  (iOS/Android)│
                                    └──────────────┘
```

Layout-Details:
- Hintergrund: `#111117`
- Titel oben: "Glev — Datenfluss & Systemarchitektur" (16px, weiß, bold)
- Untertitel: "Stand: April 2026 · DSGVO-konform · Supabase EU (Frankfurt)" (11px, gedimmt)
- Boxen: `#1C1C28`, Rahmen `#4F6EF7` (2px), border-radius 10, Padding 20
- Box-Titel: 13px, `#4F6EF7`, bold
- Box-Untertitel: 11px, weiß
- Box-Detail: 10px, gedimmt (z.B. "OAuth 2.0 / HTTPS", "Encrypted at rest", "Region: eu-central-1")
- Pfeile: `#4F6EF7`, Linienstärke 2px, mit Pfeilkopf
- Pfeil-Labels: 9px, gedimmt, über der Linie ("HTTPS / OAuth 2.0", "REST API", "Real-time sync")
- Vertikaler Pfeil von "Glev Server" nach unten zu "Glev App": "WebSocket / Push"

Boxen von links nach rechts (Row 1):
1. **Dexcom G7 / ONE+** · "CGM Sensor" · "BLE → Dexcom App"
2. **Dexcom Web API** · "OAuth 2.0 Authorization" · "HTTPS · api.dexcom.com"
3. **Glev Backend** · "Next.js API Routes" · "Vercel · Edge Network"
4. **Supabase** · "Postgres + Auth" · "eu-central-1 (Frankfurt)"

Row 2 (unterhalb Glev Backend):
5. **Glev App** · "iOS & Android" · "T1D Patient"

Unten rechts: Kleine Legende mit Schlosssymbol: "Alle Verbindungen HTTPS/TLS 1.3 · Daten verlassen die EU nicht"

---

## SCRIPT

Erstelle `scripts/generate-mockups.js` mit folgendem Ablauf:

1. `npm install canvas` ausführen (falls nicht vorhanden)
2. Beide Grafiken in einer Datei generieren
3. Outputs nach `public/mockup-consent-flow.png` und `public/mockup-data-flow.png` speichern
4. Am Ende: `console.log('✓ mockup-consent-flow.png')` und `console.log('✓ mockup-data-flow.png')`

---

## AUSFÜHRUNG

```bash
node scripts/generate-mockups.js
```

---

## VERIFY

1. Beide PNG-Dateien existieren unter `public/`
2. `mockup-consent-flow.png`: 390×780px, Dark-UI sichtbar, Button + Datenliste erkennbar
3. `mockup-data-flow.png`: 900×500px, alle 5 Boxen verbunden, Pfeile mit Labels
4. Kein `git add` / commit nötig — nur die PNGs liefern

=== END ===
