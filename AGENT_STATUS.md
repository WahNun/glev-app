# Agent Status

**Date:** 2026-04-29
**Last task:** 3-in-1 Batch — Email-Signatur (HTML+PNG), /beta-Copy-Update, /pro-Copy-Update + Szenario-Block

## Done in this session

### Email Signatur
- `public/email-signature.html` — table-based, 100% inline styles, 600 px wide.
  - Photo via `https://glev.app/founder.png` (absolute URL für E-Mail-Client-Kompatibilität).
  - Linke Akzentleiste 4 px `#4F6EF7`, rundes Foto mit 2 px Border, Wordmark "glev" oben rechts.
  - DE+EN Disclaimer in einer letzten Tabellenzeile.
- `scripts/generate-email-signature.js` — `@napi-rs/canvas`, lädt `public/founder.png`, rendert mit 2× Pixel-Density.
- `public/email-signature.png` — **1200 × 486**, identisches Layout wie HTML, B&W-Headshot rund mit blauem Border.
- Run: `node scripts/generate-email-signature.js`

### /beta — Copy-Update
- Headline: „Bessere Insulinentscheidungen. Jetzt in der Beta testen."
- Subline: „Wir bauen Glev gemeinsam mit den ersten Nutzer:innen auf. Du bekommst echten Einfluss auf das Produkt — und Zugang, bevor es für alle öffnet."
- CTA-Button-Label: „Frühzugang sichern" (vorher „Platz sichern — €19").
- Trust-Signale neu unter dem Formular: „Kein Spam · DSGVO-konform · Nur echte Updates".
- Platz-Anzeige: „Noch 23 Plätze frei" (statt „Limitiert auf 500 Beta-Plätze.").
- Stripe-Payment-Link & Form-Logik unverändert (€19 Reservierung läuft weiter).

### /pro — Copy-Update + Szenario-Block + CTA-Repoint
- Imports `SURFACE`, `BORDER` aus tokens hinzugefügt.
- **Neuer Szenario-Block** (Section 1b, zwischen Hero und Steps):
  - Setup: „Du bist bei **112 mg/dL**. Du willst gleich **60 g Kohlenhydrate** essen. Dein Wert steigt leicht."
  - Vorher-Card („Ohne Glev"): „Du spritzt sofort → später 220 mg/dL. Überzucker."
  - Nachher-Card („Mit Glev", blauer Border): „Du wartest 10 Minuten → stabil bei 140. Fertig."
  - Responsive: 2-spaltig Desktop, 1-spaltig Mobile via `.glev-scenario-grid`.
- FeatureTrio mit `items`-Override: Trend erkannt / Mahlzeit einberechnet / Timing angepasst (4. Card Arztbericht-PDF bleibt).
- **CTA repointed:** „Frühzugang testen" → `/beta` (vorher „Mitgliedschaft starten — €24,90/Monat" → Stripe).
- `STRIPE_PAYMENT_LINK` Konstante entfernt (war nur in ProCTALink benutzt).
- ⚠ Anmerkung: „Erste Abbuchung am 1. Juli 2026 · jederzeit kündbar" steht unter dem CTA und passt strenggenommen nicht mehr zum neuen Ziel `/beta`. Per Spec „NICHT ÄNDERN: Preisanzeige" stehen gelassen — sag Bescheid wenn das raus soll.

### FeatureTrio Refactor (`components/landing/FeatureTrio.tsx`)
- Neuer Export `FeatureItem` Type.
- Neuer optionaler Prop `items?: readonly FeatureItem[]` — überschreibt die 3 Default-Cards.
- Default-Cards in `DEFAULT_ITEMS` Konstante extrahiert.
- /beta nutzt weiterhin Defaults (kein Aufruf-Change), /pro nutzt `items`-Override.

## Verified
- `npx tsc --noEmit` — clean ✓
- `curl /beta` → 200 ✓
- `curl /pro` → 200 ✓
- PNG visuell geprüft ✓

## Files changed
- `public/email-signature.html` (NEW)
- `public/email-signature.png` (NEW)
- `scripts/generate-email-signature.js` (NEW)
- `components/landing/FeatureTrio.tsx`
- `app/beta/page.tsx`
- `app/pro/page.tsx`

## Conventions reminder
- Hand-written SQL migrations only (`supabase/migrations/`), NO Drizzle, NO `db:push`.
- `npm run dev` on port 5000.
- Never auto git commit / never auto suggest deploy.
- Never push without explicit user request.
