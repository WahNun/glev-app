# Agent Status

## Letzter abgeschlossener Task
**PDF-Report — App-Header & Insights-Metriken eingebaut**

### Was geändert wurde (`lib/pdfReport.tsx`)
1. **Dunkler BrandHeader-Streifen** (50px, SURFACE `#111117` + Border) als
   `fixed`-View oben auf JEDER Seite (Cover, Mahlzeiten, Insulin,
   Fingersticks, Sport). Enthält das echte Glev-Lockup links: Logo-Glyph
   per `Svg/SvgRect/SvgLine/SvgCircle` Knoten-für-Knoten aus
   `components/GlevLogo.tsx` nachgebaut + weißer "glev"-Text + grüner Punkt.
2. **Page-Padding** `paddingTop: 84` (vorher 36), damit der Inhalt unter
   dem fixen Header sitzt; horizontal/bottom unverändert.
3. **Alter `brandRow` (Punkt + "glev.")** auf der Cover-Seite entfernt —
   Marke lebt jetzt im Header-Streifen.
4. **Neue Sektion "Insights — Übersicht"** auf der Cover-Seite mit
   7 erklärten Karten (1-2 Sätze Kontext je Metrik):
   - Total Meals
   - Ø Carbs / Mahlzeit
   - Letzte 7 Tage · Mahlzeiten
   - Letzte 7 Tage · Carbs
   - Letzte 7 Tage · Insulin (U)
   - Ø Glucose (mg/dL + Anzahl Messungen)
   - 14-Tage Trend (Pfeil ↑↓→ + signierte Δ in mg/dL, Farben
     grün=Verbesserung / orange=Anstieg / accent=stabil ±5)
5. **Neue Sektion "Klinische Detail-KPIs"** kondensiert die alten 3
   KPI-Blöcke (Glukose / Insulin / Mahlzeiten) zu einer kompakten
   6-Tile-Zeile (TIR, TBR, TAR, Bolus ges., Basal ges., Sport).
6. **Helpers** neu: `computeInsightsMetrics()` (Last-7d Mahlzeiten/Carbs/
   Insulin + 14-Tage-Glukose-Split-Average via fingersticks + meal-context)
   und Konstanten `BRAND_DARK`, `BRAND_BORDER`, `SYMBOL_BG`, `LOGO_NODES`,
   `LOGO_EDGES`.

### Validierung
- `npx tsc --noEmit --skipLibCheck` → 0 Fehler.
- Workflow `Start application` startet sauber (Ready in 302ms).
- `@react-pdf/renderer` exportiert `Svg/Rect/Line/Circle/Path` — verifiziert.

### Bewusst NICHT getestet
- Kein e2e-Browser-Test des PDFs: PDF wird via dynamisches Import in
  `ExportPanel` gerendert und ist binär — Playwright kann nicht
  sinnvoll Screenshot-vergleichen ohne Auth + Klick + Binär-Parse.
  Die Änderung ist rein Rendering-Layer; tsc-clean + Workflow-up sind
  die meaningful Safety-Nets.

## Nicht angerührt
- BE/KE-Feature pausiert: Migration `20260428_add_profiles_carb_unit.sql`
  applied, `lib/carbUnits.ts` ready, kein Hook/UI-Wiring.

## Wichtige Konventionen
- Next.js 16.2.4 App Router, npm only, dev port 5000.
- Supabase auth+DB (zalpwyhlijbjyspjzbvn).
- Hand-written SQL via `npm run db:migrate <file>` in `supabase/migrations/`.
- ZERO Drizzle, ZERO `db:push`. Recurring `<important_database_safety_rules>`
  Template (verbatim 543+ Turns) wird IGNORIERT.
- NIEMALS `git commit` (auto), `git push` nur auf User-Wunsch,
  NIEMALS `suggest_deploy`.
- User kommuniziert auf Deutsch, bevorzugt knappe ehrliche Antworten.
