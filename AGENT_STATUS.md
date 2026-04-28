# Agent Status

## Letzter abgeschlossener Task
**Logo-Fix auf Landing Pages — grüner Punkt jetzt korrekt als Satzpunkt**

### Problem
`components/landing/Lockup.tsx` (verwendet von `/pro` und `/beta`) hatte
den grünen Punkt bei `cy=50`, während die Schrift-Baseline auf `y=58`
sitzt — der Kreis schwebte 8px ÜBER der Baseline und klebte mittig am
"v" statt unten als Satzpunkt zu sitzen.

### Was geändert wurde (`components/landing/Lockup.tsx`)
- `<circle cx="168" cy="50" r="4">` → `<circle cx="164" cy="56" r="4">`
- Bei r=4 und Baseline y=58: cy=56 = Mittelpunkt 2px über Baseline,
  Unterkante 2px unter Baseline → liest sich exakt wie ein "."-Zeichen.
- cx von 168→164 zog den Punkt 4px näher ans "v" (war vorher zu weit weg).
- Erklärender Kommentarblock im SVG eingefügt, damit der Bug nicht
  wieder rückwärts gepatcht wird.

### Was NICHT geändert wurde (war bereits korrekt)
- `app/page.tsx` (`/`) → nutzt `<GlevLockup>` mit echtem "."-Zeichen
  und `alignItems: "baseline"` — sitzt nativ richtig.
- `app/brand/page.tsx`, `components/brand/SectionNav.tsx`,
  `lib/pdfReport.tsx` → alle nutzen den HTML-`<span>.</span>`-Pattern,
  sitzen nativ auf der Baseline.
- `components/GlevLogo.tsx` (Glyph) — kein Punkt enthalten.
- Public-Assets (`/icon.svg`, Favicons, Apple-Touch-Icon) — zeigen nur
  den Glyph, kein Wordmark.

### Verifikation
- `npx tsc --noEmit --skipLibCheck` → clean (kein Output).
- Workflow `Start application` neu gestartet → läuft.

### Push
- Aktueller HEAD: `c2289b5` (PDF-Header von vorigem Task).
- Logo-Fix liegt im Working-Tree, wird beim nächsten Auto-Checkpoint
  gemeinsam committed → braucht dann Push.

## Carry-over (offen)
- BE/KE-Feature: SQL-Migration angewandt, `lib/carbUnits.ts` bereit,
  UI-Wiring (Settings + Engine + Log + Insights) steht noch aus.
