# Glev — Offene Tasks (Snapshot 2026-05-24)

> Asana-Daten: Stand 2026-05-21 (Quelle: `docs/asana/sprints.md`). Refresh via `pnpm asana:sync`.
> Replit-Platform-Tasks: Stand 2026-05-24 (aus aktueller Session).
> Pfad zum lokalen Kopieren: `cp OPEN_TASKS.md /Users/lucas/Documents/Claude/Projects/Glev/OPEN_TASKS.md`

---

## Prioritätssystem

| Kürzel | Bedeutung |
|--------|-----------|
| P0 | Blocker — Launch oder Revenue gefährdet |
| P1 | Diese Woche, überfällig oder kritischer Pfad |
| P2 | Diese oder nächste Woche, geplant |
| Backlog | Kein festes Datum, nach Launch oder bei Kapazität |
| Non-Dev | Marketing / Legal / Business — nicht Replit-Agent-Scope |

---

## Replit Platform Tasks (Agent-Queue)

### #676 — Catch Insights card oversizing on small phones automatically
**Status:** in progress
**Priorität:** P2
**Plan:** Playwright-Spec der prüft dass Insights-Cards auf 375px-Viewport (iPhone mini) die `clamp(280px,…,460px)`-minHeight nicht überschreiten. Viewport-Simulation via `page.setViewportSize({ width: 375, height: 812 })`, dann Bounding-Box-Check auf `.flip-card`-Container.
**Abhängigkeiten:** #674 (merged), #675 (merged)

### #683 — Refresh the AI chat context automatically every few minutes on the Dashboard
**Status:** proposed
**Priorität:** P2
**Plan:** In `hooks/useScreenContext.ts` einen `setInterval`-Refresh (z. B. 3 min) für die drei async Helper auf dem Dashboard-Screen einbauen. Cleanup im `useEffect`-Teardown. Optionaler Visibility-API-Check (`document.visibilityState`) damit der Fetch nicht im Hintergrund feuert.
**Abhängigkeiten:** #679 (merged)

### #684 — Show real-time glucose and IOB in the AI chat on other screens
**Status:** proposed
**Priorität:** P2
**Plan:** `useScreenContext` auf allen Screens (engine, entries, insights, settings) mit echten Daten füttern — nicht nur Dashboard. Pro Screen entscheiden welche Daten Sinn ergeben (z. B. engine → letzter Bolus + IOB, entries → letzte Mahlzeit).
**Abhängigkeiten:** #679 (merged)

### #685 — Automated tests: AI chat receives real glucose and IOB data on Dashboard
**Status:** proposed
**Priorität:** P2
**Plan:** Playwright-Spec: Login, CGM-Route via `page.route()` mocken (142 mg/dL, IOB 2.3), AI-Chat öffnen, senden „Wie ist mein Zucker?", antwort enthält „142" oder „mg/dL". Supabase-Consent-Check: `ai_consent_glucose_at` muss gesetzt sein (Fixture im before-Hook).
**Abhängigkeiten:** #679 (merged), #684

### #686 — Fix Basal-IOB-Karte: Ausgangsdosis im Ring + Disclaimer-Text
**Status:** proposed
**Priorität:** P2
**Plan:** `components/IOBCard.tsx`: Im Basal-View den Ring auf Basis der `lastBasal.units`-Ausgangsdosis kalkulieren statt aktuellen IOB-Wert. Disclaimer-Text aus der Karte in separaten Footer-Div mit korrekter Positionierung (nach `D-011`-Pattern).
**Abhängigkeiten:** keine

---

## Sprint 1 — Migration + Stripe Test-Mode

### QA: T6 Decision-Panel end-to-end testen
**Status:** offen ⚠️ überfällig (2026-04-28)
**Priorität:** P1
**Plan:** Playwright-Spec die den kompletten Decision-Panel-Flow auf `/engine` durchläuft: Eingabe → Step-1-Analyse → Step-2-Empfehlung → Step-3-Breakdown. Assertions auf Breakdown-Zellen (Carb/Korrektur/Gesamt) und Disclaimer-Label.
**Abhängigkeiten:** keine

### QA: Datenexport + PDF-Report verifizieren
**Status:** offen ⚠️ überfällig (2026-04-28)
**Priorität:** P1
**Plan:** Playwright-Spec: PDF-Download auf `/settings` → Blob-Response prüfen (`content-type: application/pdf`), Dateiname prüfen. Alternativ Unit-Test der `generatePdfReport()`-Funktion mit Fixture-Daten.
**Abhängigkeiten:** keine

### State-Logic für /beta-voll und /pro-voll prüfen
**Status:** offen ⚠️ überfällig (2026-04-28)
**Priorität:** P1
**Plan:** Middleware-Test: Request auf `/beta` wenn `beta_slots_remaining = 0` → muss auf `/beta-voll` redirecten. Supabase-Admin-Fixture oder Mock-Row setzen.
**Abhängigkeiten:** keine

### [Replit] Good Rate Fix — Prompt bereit, deployen
**Status:** offen ⚠️ überfällig (2026-04-30)
**Priorität:** P1
**Plan:** Engine-Auswertungs-Prompt anpassen: Kriterien für `GOOD`-Rating überprüfen (aktuell: ICR-Formel ±15%). Prompt in `lib/ai/enginePrompt.ts` oder äquivalent anpassen. Deploy via `git push`.
**Abhängigkeiten:** keine

### [Replit] Post-Meal Granularität — Prompt bereit, deployen
**Status:** offen ⚠️ überfällig (2026-04-30)
**Priorität:** P1
**Plan:** Post-Meal-Auswertung (bg_2h vs. bg_1h) genauer differenzieren. Spikes vs. Late-Highs unterscheiden im Prompt/Engine-Logik.
**Abhängigkeiten:** keine

### [Replit] Post-Meal Badge — Prompt bereit, deployen
**Status:** offen ⚠️ überfällig (2026-04-30)
**Priorität:** P1
**Plan:** Badge-Komponente in der Mahlzeit-Card (`components/MealCard.tsx` oder Entry-List) die Post-Meal-BG-Outcome visuell zeigt. Farb-Coding: grün=gut, gelb=akzeptabel, rot=hoch.
**Abhängigkeiten:** [Replit] Post-Meal Granularität

### Stripe Webhook (Live-Mode) — konfigurieren und testen
**Status:** offen ⚠️ überfällig (2026-05-15)
**Priorität:** P1
**Plan:** Non-Dev: Stripe Dashboard → Webhooks → Endpoint für `https://glev.app/api/pro/webhook` + `https://glev.app/api/webhooks/stripe` verifizieren. `STRIPE_PRO_WEBHOOK_SECRET` + `STRIPE_BETA_WEBHOOK_SECRET` in Vercel ENV prüfen.
**Abhängigkeiten:** Stripe Live-Mode aktivieren

### [Entscheidung] Junction CGM UI — 'Coming Soon' bis Revenue trägt
**Status:** offen ⚠️ überfällig (2026-05-15)
**Priorität:** P1
**Plan:** Non-Dev: Richtungsentscheidung — aktuell gilt: CGM-Analyse hinter Feature-Gate. Entscheidung dokumentieren in DECISIONS.md.
**Abhängigkeiten:** keine

### [Android] Google Play Internal Testing einrichten
**Status:** offen ⚠️ überfällig (2026-05-17)
**Priorität:** P1
**Plan:** Non-Dev: Play Console → Internes Testen → Test-APK/AAB hochladen. Tester-Liste pflegen.
**Abhängigkeiten:** Android App Capacitor Platform

### [MARKETING] Canva Renderings updaten — Landing & Homepage
**Status:** offen ⚠️ überfällig (2026-05-20)
**Priorität:** P1
**Plan:** Non-Dev: Screenshots aus `public/mockups/` (refresht via `scripts/refresh-mockups.mjs`) in Canva-Templates einsetzen.
**Abhängigkeiten:** keine

### [Glev+] 'Direkter Draht zum Gründer' — Kanal einrichten
**Status:** offen (2026-05-22)
**Priorität:** P1
**Plan:** Non-Dev: Telegram-Gruppe oder WhatsApp-Channel für Glev+-Subscriber. Link in Willkommens-Mail.
**Abhängigkeiten:** keine

### [Glev+] PDF-Report: Produktionsbereitschaft prüfen
**Status:** offen (2026-05-22)
**Priorität:** P1
**Plan:** PDF-Generator auf Prod testen: Vercel-Funktion Timeout? PDF-Größe? Fehlerhandling wenn keine Daten. `app/api/report/route.ts` prüfen.
**Abhängigkeiten:** keine

### Compliance-Sweep Prio 1: Kritische Disclaimers + Card-Backs
**Status:** offen (2026-05-23)
**Priorität:** P1
**Plan:** `messages/{de,en}.json`: TIR/GMI/CV-Bänder mit Quellen belegen (Battelino et al., Diabetes Care 2019 — bereits in `tir_back_p2` drin, Rest prüfen). Alle `*_back_p*`-Texte auf fehlende Zitate prüfen. Keine direkten Dosis-Anweisungen in UI-Texten.
**Abhängigkeiten:** keine

### [Stripe] Early Access Coupon — 50% Rabatt erste 3 Monate
**Status:** offen (2026-05-25)
**Priorität:** P2
**Plan:** Non-Dev: Stripe Dashboard → Coupons → `EARLYBIRD50` mit 50% für 3 Monate. Code in Checkout-Link einbauen.
**Abhängigkeiten:** Stripe Live-Mode

### [Glev+] Familienzugang — Scope & Architektur definieren
**Status:** offen (2026-05-25)
**Priorität:** P2
**Plan:** Non-Dev: Architektur-Entscheidung (account_shares Tabelle, Share-Tokens). DECISIONS.md-Eintrag erstellen.
**Abhängigkeiten:** keine

### [UX] Control Score aufpolieren — prominenter, visuell stärker
**Status:** offen (2026-05-28)
**Priorität:** P2
**Plan:** `app/(protected)/insights/page.tsx`: Control-Score-Card visueller hervorheben. Größere Zahl, Gradient, Trend-Pfeil. Evtl. eigene prominente Position im Grid.
**Abhängigkeiten:** keine

### Compliance-Sweep Prio 2: i18n-Sweep + Hard-coded Strings + AI Prompt
**Status:** offen (2026-05-30)
**Priorität:** P2
**Plan:** `rg`-Sweep nach deutschen Strings in TSX-Dateien (nicht in `messages/`). AI-Prompt-Review auf Compliance-Prinzip. Hard-coded Strings in `next-intl`-Keys migrieren.
**Abhängigkeiten:** Compliance-Sweep Prio 1

### [Marketing] Social Proof — 3-5 Beta-Tester rekrutieren
**Status:** offen (2026-05-31)
**Priorität:** P2
**Plan:** Non-Dev: T1D-Community (Reddit r/diabetes_t1, JDRF-Forum, Instagram) ansprechen. TestFlight-Link + kurzes Briefing.
**Abhängigkeiten:** TestFlight-Build

### [Glev+] Backend: account_shares Tabelle + Share-Token-Generierung
**Status:** offen (2026-06-07)
**Priorität:** P2
**Plan:** Migration: `account_shares(id, owner_id FK profiles, caregiver_email, token uuid, accepted_at, expires_at, permissions jsonb)`. API-Route `POST /api/shares/invite` → Token generieren + Email. RLS: owner sieht eigene Shares, Caregiver sieht Invite via Token.
**Abhängigkeiten:** [Glev+] Familienzugang Scope

### [Glev+] Frontend: Caregiver-Dashboard (read-only View)
**Status:** offen (2026-06-14)
**Priorität:** P2
**Plan:** `app/(caregiver)/dashboard/page.tsx`: Read-only View der Dashboard-Komponenten für den freigegebenen Account. Token-basierter Zugang via Query-Param, Supabase Row-Level-Access via `account_shares`-Join.
**Abhängigkeiten:** account_shares Backend

### [Glev+] Feature Gate: Familienzugang nur für Glev+ Subscriber
**Status:** offen (2026-06-14)
**Priorität:** P2
**Plan:** Middleware-Check: `profiles.subscription_tier === 'pro'` vor Zugang zu Share-Invite-Route. UI-Gate in Settings: Share-Button disabled mit „Glev+"-Badge wenn kein Pro-Abo.
**Abhängigkeiten:** Caregiver-Dashboard

### [DACH] Beta-Launch — 500 Early-Access Plätze, DACH-fokussiert
**Status:** offen (2026-06-15)
**Priorität:** P2
**Plan:** Non-Dev: Launch-Kampagne, Social Media, Email-Liste.
**Abhängigkeiten:** App-Store Listings

### [DACH] DiaDigital-Qualitätssiegel — Antragsprozess recherchieren
**Status:** offen (2026-06-30)
**Priorität:** Backlog
**Plan:** Non-Dev: diadigital.de Anforderungen prüfen. Compliance-Backlog vorbereiten.
**Abhängigkeiten:** keine

### [Glev+] Remote-Bolus-Empfehlung (MDR-safe Architektur)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Architektur-Entscheidung: Eltern-kontrollierter Flow. MDR-Implikationen (Klasse IIb?). Erst nach DiGA-Pathway-Analyse sinnvoll.
**Abhängigkeiten:** DiGA-Pathway

### [Glev+] Betreuer-Account: eigener Account-Typ
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `profiles.account_type` Enum: `standard | caregiver`. Eigenes Onboarding-Flow für Betreuer.
**Abhängigkeiten:** account_shares Backend

### [Glev+] Kind-Account: vereinfachte UI + CGM-Weiterleitung
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Vereinfachte Mobile-UI (große Buttons, weniger Daten). CGM-Share via `account_shares`-Mechanismus.
**Abhängigkeiten:** Betreuer-Account

### #184 — Libre App Daten-Import (Backlog)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** CSV-Import aus der LibreLink-Export-Funktion. Parser in `lib/cgm/libreImport.ts`. UI-Upload-Button in Settings.
**Abhängigkeiten:** keine

### Per-User Food History (Phase B)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Eigene `food_history`-Tabelle (user_id, name, typical_carbs, typical_protein, typical_fat). Quick-Select beim Logging. Engine nutzt Personaldaten statt nur Generic-Parsing.
**Abhängigkeiten:** keine

### [Feature] Laborwerte + Gewicht erfassen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Neue Tabelle `lab_readings(user_id, type, value, unit, measured_at)`. Log-Form in Settings oder neuer Tab. Typen: HbA1c, Cholesterin, Gewicht, eGFR.
**Abhängigkeiten:** keine

### [CGM] Server-seitiges LLU-Polling
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** GitHub-Actions-Cron oder Supabase-Edge-Function: alle 5 min LLU-API für aktive User pollen, Werte in `cgm_samples` schreiben. Vorteil: Unabhängig vom offenen Browser. Problem: Auth-Token-Refresh-Mechanismus für LLU.
**Abhängigkeiten:** keine

### Feature: Zeitbasierte IC-Ratios (ICR nach Tageszeit)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `user_icr_schedule`-Tabelle existiert bereits (8 Spalten laut post-merge-check). Frontend in Settings: Tageszeit-Slots mit je eigenem ICR-Wert. Engine nutzt `getActiveICR(time)` statt globalen Wert.
**Abhängigkeiten:** keine

### Feature: Einflussfaktoren-Log (Substances/Influences)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Erweiterung der `symptom_logs`-Tabelle oder eigene `influence_logs`-Tabelle. Typen: Alkohol, Stress, Krank, Sport-spät, Menstruation. Engine-Kontext berücksichtigt aktive Einflüsse.
**Abhängigkeiten:** keine

### [Nightscout] Caching-Tabelle nightscout_readings anlegen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Migration: `nightscout_readings(id, user_id, glucose_mgdl, direction, recorded_at, synced_at)`. Index auf `(user_id, recorded_at DESC)`. Polling-Job ähnlich LLU.
**Abhängigkeiten:** keine

### [Nightscout] Live-Status in Settings-Card aktualisieren
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Settings-Card zeigt letzten Sync-Zeitpunkt + Verbindungsstatus (grüner/roter Dot). Daten aus `nightscout_readings.synced_at`.
**Abhängigkeiten:** nightscout_readings Tabelle

### [Apple Health] Erweiterte Gesundheitsdaten — Gewicht, Schritte, Workouts
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/appleHealth.ts` erweitern: `readWeight()`, `readStepCount()`, `readWorkouts()`. Daten in `apple_health_readings`-Tabelle mit `data_type`-Discriminator.
**Abhängigkeiten:** Apple Health Integration

### [P1] ops.glev.app auf VPS-Agent umstellen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: VPS-Infrastruktur-Task. Nginx-Reverse-Proxy, SSL via Certbot.
**Abhängigkeiten:** VPS einrichten

### [P1] Cloudflare Tunnel für VPS einrichten
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: `cloudflared tunnel create glev-ops` → Cloudflare DNS.
**Abhängigkeiten:** VPS einrichten

### [P1] Glev Agent Backend auf VPS deployen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Docker-Container oder PM2 für Agent-Backend. Environment-Vars via `.env`-File.
**Abhängigkeiten:** VPS + Tunnel

### [P2] Sprint-Filter ins Kanban Dashboard einbauen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Asana-API: Sprint-Projekte als Filter-Tabs. `scripts/sync-asana-sprints.mjs` als Basis.
**Abhängigkeiten:** keine

### [P1] VPS aufsetzen — DigitalOcean Droplet erstellen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: DO Droplet Ubuntu 22.04, 1 vCPU 1 GB. SSH-Key. Firewall: Port 22, 80, 443.
**Abhängigkeiten:** keine

### [P1] Erster Live-Test des VPS-Agenten
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Smoke-Test nach Deployment.
**Abhängigkeiten:** VPS deployen

### Post-Meal Feedback Loop — BG-Check 2h nach Mahlzeit
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Via Task #673 teilweise implementiert (MealNodeCluster + mealCheckReminders). Verbleibend: Fingerstick-Erinnerung für Nicht-CGM-User. `lib/mealCheckReminders.ts` erweitern: Web-Notification-Fallback für User ohne CGM.
**Abhängigkeiten:** #673 (merged)

### [CGM] Settings — CGM Provider Selection + Credential Input UI
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Settings-Section: Provider-Dropdown (LibreLink, Dexcom, Nightscout, Apple Health). Per-Provider: Credential-Fields (Email/Pass für LLU, URL für Nightscout). Speichern encrypted in `user_settings.cgm_config jsonb`.
**Abhängigkeiten:** keine

### [CGM] Medtronic CareLink Integration (Beta)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** CareLink-API (inoffiziell). `lib/cgm/carelink.ts`. Sehr fragil — niedrige Prio bis offiziell.
**Abhängigkeiten:** CGM Settings UI

### [DB] Meal-Klassen auf 5 erweitert — DONE (verifizieren)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Prüfen ob CHECK-Constraint in `meals.meal_type` auf 5 Klassen erweitert wurde. Migration falls nötig.
**Abhängigkeiten:** keine

### [CGM] Libre 2 Integration — Stabilität + Edge Cases
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `lib/cgm/libre.ts`: Edge-Cases: Token-Expiry, Rate-Limit (429), leere Readings-Response. Retry-Logic + User-facing Error-Message in CGM-Card.
**Abhängigkeiten:** keine

### [UX] Onboarding-Flow für frisch Diagnostizierte (T1D-Neulinge)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Onboarding-Wizard: Diagnose-Datum, Insulintyp, CGM ja/nein. Daten in `user_settings` speichern. Setup-Screens vor erstem Dashboard-Besuch.
**Abhängigkeiten:** keine

### [CGM] Dexcom Share API Integration (EU)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/cgm/dexcom.ts`: OAuth2-Flow mit Dexcom EU-Endpoint. Token-Refresh. Reading in `cgm_samples`.
**Abhängigkeiten:** CGM Settings UI

### [CGM] Accu-Chek SmartGuide — xDrip+ Integration beobachten
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Marktbeobachtung. xDrip+ hat HTTP-Server-API — evtl. Nightscout-kompatibel.
**Abhängigkeiten:** Nightscout Integration

### [Backlog] Arztbericht — PDF + CSV Report (Pro Founder Exclusive)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `app/api/report/route.ts` erweitern: 14/30/90-Tage-Fenster, Kurven-Chart als SVG, Mahlzeit-Tabelle, IOB-Verlauf. CSV-Export parallel. Feature-Gate: nur `subscription_tier === 'pro'`.
**Abhängigkeiten:** keine

### [Backlog] Google Sheets Sync — Import-Feature fertig bauen
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Google-Sheets-Integration (bereits installiert als Connector). `scripts/sync-sheets.mjs` oder API-Route. Spalten-Mapping: Datum, Mahlzeit, KH, Insulin, BG.
**Abhängigkeiten:** Google-Sheets-Integration (bereits konfiguriert)

### Onboarding Welcome Screens — Setup Wizard für neue User
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/onboarding/page.tsx`: 3-Step-Wizard (Insulintyp → ICR/CF/DIA → CGM-Provider). Nur bei `profiles.onboarding_completed IS NULL` anzeigen. Nach Abschluss: Flag setzen, → Dashboard.
**Abhängigkeiten:** keine

### [Backlog] Parsing-Pipeline: Geschwindigkeit verbessern
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** GPT-5-Prompt optimieren (weniger Token, stricter Schema). Evtl. auf kleineres Modell für Standard-Fälle wechseln. Streaming-Response direkt in DB schreiben statt warten.
**Abhängigkeiten:** keine

### Cleanup: /beta/success auf /welcome redirecten
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `middleware.ts`: `pathname === '/beta/success'` → `redirect('/welcome')`. Oder `app/beta/success/page.tsx` mit `redirect()` ersetzen.
**Abhängigkeiten:** keine

### Font-Inkonsistenz: Große Zahlen auf JetBrains Mono vereinheitlichen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/globals.css`: `.font-mono-display` oder `--font-mono` überall wo Dashboard-Werte (Glukose, Makros, IOB) stehen. `rg 'fontSize.*[0-9]'` in Dashboard-Komponenten.
**Abhängigkeiten:** keine

### Macro-Circle Farben: Protein → Blau, Fat → Lila
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/globals.css` oder `components/MacroCircle.tsx`: `--color-protein: #4F6EF7` (Blau), `--color-fat: #9B59B6` (Lila). Alle Macro-Circle-Render-Stellen mit `rg 'protein.*color\|fat.*color'` finden.
**Abhängigkeiten:** keine

### App-Texte: Compliance-Review + Deutsch-Übersetzung aller UI-Strings
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `rg` nach Hard-coded deutschen Strings in TSX außerhalb von `messages/`. Compliance: keine Dosis-Empfehlungen, kein „senkt deinen Zucker" ohne Disclaimer. Jeder String durch `t()`-Aufruf.
**Abhängigkeiten:** keine

### Tagline 'Smart insulin decisions' — für spätere Phase evaluieren
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Marketing-Entscheidung.
**Abhängigkeiten:** keine

### OpenAI Spending Hard Limit setzen
**Status:** offen (kein Datum)
**Priorität:** P1
**Plan:** Non-Dev: OpenAI Dashboard → Billing → Hard Limit z. B. €50/Monat. Replit nutzt AI-Integrations-Proxy — prüfen ob Limit dort oder direkt in OpenAI gilt.
**Abhängigkeiten:** keine

### OpenAI Kosten-Monitoring einbauen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Logging in `app/api/ai/chat/route.ts`: Token-Count aus Mistral-Response in `ai_usage_logs`-Tabelle schreiben (user_id, model, prompt_tokens, completion_tokens, created_at). Admin-Dashboard-Tab zeigt Cost-per-User.
**Abhängigkeiten:** keine

### Rate-Limiting pro User (OpenAI-Schutz)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/api/ai/chat/route.ts`: Redis oder Supabase-Counter mit 1-Stunden-Sliding-Window. Limit z. B. 20 Requests/h. 429-Response mit `Retry-After`-Header.
**Abhängigkeiten:** keine

### OpenAI Modell-Audit: richtiges Modell pro Feature
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Alle API-Routes mit AI-Aufrufen auflisten. Chat → Mistral (bereits). Meal-Parsing → GPT-5 (prüfen ob kleineres Modell ausreicht). Engine → kein AI (regelbasiert). Kostentabelle erstellen.
**Abhängigkeiten:** Kosten-Monitoring

### Recibos Verdes aktivieren (Portugal)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Finanzen-Task. Nach ~€1k MRR.
**Abhängigkeiten:** Launch

### EU MDR CE-Zulassung SaMD evaluieren
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Compliance-Beratung. Compliance-Backlog in `replit.md` abarbeiten.
**Abhängigkeiten:** Launch

### [Pro] Feature-Cards Layout + Farben finalisieren
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/(protected)/settings/page.tsx` oder Pro-Landing: Feature-Cards mit finalen Farben/Layout nach UX-Update. Abstimmung mit Canva-Designs.
**Abhängigkeiten:** keine

### [Ads] Instagram Static + Reel — Performance-Monitoring
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Meta Ads Manager → Conversion-Tracking. Pixel-Events prüfen.
**Abhängigkeiten:** Meta Pixel

### [FEATURE] Workout-Bibliothek — Strukturierte Workouts im Engine-Log-Tab
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `exercise_logs`-Tabelle um `workout_template_id` erweitern. Vordefinierte Templates (Laufen 30min, Radfahren 60min). Engine berücksichtigt Workout-Typ für IOB-Warnung.
**Abhängigkeiten:** keine

### [PERF] fetchMeals ohne Limit — 90-Tage-Cap + Suspense
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Teilweise erledigt (Task #665: `FETCH_MEALS_DEFAULT_LIMIT = 50`). Verbleibend: Suspense-Boundary um Meal-Listen, `useMemo` für Engine-Berechnungen auf großen Datensätzen.
**Abhängigkeiten:** #665 (merged)

### [FEATURE] Whoop-Integration — Strain, Recovery, Sleep, HRV
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Whoop-OAuth2-API. `lib/whoop.ts`: `fetchRecovery()`, `fetchStrain()`. Daten in `apple_health_readings`-artiger Tabelle. Engine-Kontext: Low Recovery → erhöhte Insulin-Sensitivität-Warnung.
**Abhängigkeiten:** keine

### [UX] Einflussfaktoren-Tab auffindbarer machen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Dashboard-Quick-Log-Tile für Einflussfaktoren (Sport, Stress, Krank). Bottom-Nav oder Quick-Add-Sheet-Eintrag.
**Abhängigkeiten:** Quick-Add-Sheet (vorhanden)

### [DB] Cleanup bg_1h / bg_2h → glucose_1h / glucose_2h
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Migration: RENAME COLUMN in `meals`. Alle Code-Stellen via `rg 'bg_1h\|bg_2h'` finden und umbenennen. Breaking Change — erst wenn kein aktiver Code mehr die alten Namen nutzt.
**Abhängigkeiten:** keine

### [UX] Parsing-Timer im Log-Screen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `components/LogScreen.tsx` oder Engine-Log: Spinner mit vergangenem Zeit-Counter während AI-Parsing läuft. `setInterval(()=>setElapsed(e=>e+1),1000)` in useEffect.
**Abhängigkeiten:** keine

### [UX] Presale Feedback-Frage — In-App Survey
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Modal nach 7 Tagen (oder bei erstem Engine-Besuch): „Was hat dich zu €39 bewogen?" — 3 Multiple-Choice + Freitext. Speichern in `user_feedback`-Tabelle oder Resend-Webhook.
**Abhängigkeiten:** keine

### [MARKETING] L-Naming entscheiden
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Entscheidung zwischen „Glev Clinic" und „Glev Insight".
**Abhängigkeiten:** keine

### [PRODUCT] L-Trial — 7 Tage automatisch nach M-Monat 1
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Stripe-Webhook: `customer.subscription.updated` → wenn `M`-Plan nach 30 Tagen aktiv: Trial auf `L`-Plan starten. Email-Sequenz triggern.
**Abhängigkeiten:** L-Naming

### [PRODUCT] L-Killer-Feature entscheiden
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Arzt-Cockpit vs. KI-Pattern-Alerts. Entscheidung dokumentieren.
**Abhängigkeiten:** L-Naming

### [PRODUCT] S → M Upgrade-Flow — Engine-Sneak-Peek
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Nach 7 Tagen auf S-Plan: Engine-Sneak-Peek-Banner mit Upgrade-CTA. Limitierte Engine-Nutzung (z. B. 3 Anfragen/Monat on S).
**Abhängigkeiten:** keine

### [FEATURE] Adaptiver Correction Factor (CF)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/engine/adaptiveCF.ts`: Historische Korrekturboli auswerten (Insulin + BG-Delta). CF lernt aus Outcomes. Warnung wenn adaptiver CF >20% vom User-Setting abweicht.
**Abhängigkeiten:** keine

### [FEATURE] Apple Health — Körpergewicht-Sync (BodyMass)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/appleHealth.ts`: `readBodyMass()`. In `apple_health_readings` mit `data_type='weight'`. Insights: Gewichts-Trend-Sparkline.
**Abhängigkeiten:** Apple Health Integration

### [FEATURE] Apple Health — VO2 Max Sync
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/appleHealth.ts`: `readVO2Max()`. Engine-Kontext: hoher VO2 Max → erhöhte Insulin-Sensitivität im Training.
**Abhängigkeiten:** Apple Health Integration

### [FEATURE] Apple Health — HRV-Sync
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/appleHealth.ts`: `readHRV()`. Insights-Karte: HRV-Verlauf + Korrelation mit TIR.
**Abhängigkeiten:** Apple Health Integration

### [FEATURE] Apple Health — Zyklus-Sync (MenstrualFlow)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `lib/appleHealth.ts`: `readMenstrualFlow()`. Sync in `menstrual_logs`-Tabelle (existiert bereits). Insights-Karte: Zyklus-Phase + BG-Muster-Korrelation.
**Abhängigkeiten:** Apple Health Integration, menstrual_logs (existiert)

### [COMPLIANCE] DiaDigital-Siegel Anfrage — Rückmeldung abwarten
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: Warten auf Feedback.
**Abhängigkeiten:** keine

### Landing-Page-Footer dauerhaft am unteren Rand (#359)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/page.tsx`: Footer mit `position: sticky; bottom: 0` oder `min-height: 100dvh` auf dem Wrapper-Div damit Footer bei kurzem Content unten bleibt.
**Abhängigkeiten:** keine

### Alte Pure-Sugar-Snacks rückwirkend als Fast Carbs labeln (#313)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Einmalige Migration: `UPDATE meals SET meal_type = 'FAST_CARBS' WHERE meal_type = 'BALANCED' AND fat_grams < 5 AND protein_grams < 5 AND carbs_grams > 20`. Oder in einer Admin-Action mit Preview.
**Abhängigkeiten:** keine

### Active-Day-Outcomes aufgeteilt nach Mahlzeit-Typ (#341)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Insights-Karte: TIR/GMI per Mahlzeit-Typ (FAST_CARBS/HIGH_FAT/etc.). Gruppierte Bar-Chart mit Recharts.
**Abhängigkeiten:** keine

### Alle Insights-Karten einheitlich im Cockpit-Stil (#330)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/(protected)/insights/page.tsx`: Einheitliche Card-Rückseite (Back-Face) für alle Karten — gleiche Padding, gleiche Font-Größen, gleiche Disclaimer-Position.
**Abhängigkeiten:** #675 (merged)

### Settings-Übersetzungen automatisch per E2E fangen (#355)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Playwright-Spec: Settings-Seite auf DE + EN rendern, alle sichtbaren Texte gegen eine Blacklist von Hard-coded-Strings prüfen. `page.locator('text=Einstellungen')` auf EN-Locale darf nicht grün sein.
**Abhängigkeiten:** keine

### Reset-to-Default für Dashboard-Section-Reihenfolge (#322)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Settings-Button „Reihenfolge zurücksetzen": DELETE auf `user_preferences WHERE key = 'dashboard_card_order'`. Dashboard lädt dann Default-Reihenfolge.
**Abhängigkeiten:** keine

### Apple-Health-Badge auch im Dashboard-Expanded (#347)
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `components/CurrentDayGlucoseCard.tsx` oder Dashboard-Expanded: Apple-Health-Badge (kleines AH-Icon + „Live") auch im erweiterten Zustand zeigen.
**Abhängigkeiten:** Apple Health Integration

### [Vision] Kinder-Modus: Schul-Workflow für T1D-Kinder
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Eigener App-Modus mit vereinfachter UI, Lehrer-/Schulbegleiter-Sicht. MDR-Klasse IIb möglicherweise. Erst nach MDR-Beratung.
**Abhängigkeiten:** MDR-Evaluation

### [Glev+] 7-Tage L-Trial für M-Subscriber
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Stripe-Webhook + automatischer Trial-Start nach M-Monat 1.
**Abhängigkeiten:** L-Naming

### [Email · L-Trial] Sequenz aufsetzen (L0–L7)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Resend-Drip-Pipeline: 5 Emails (L0/L2/L4/L6/L7). Templates in `lib/emails/`. Trigger via Supabase-Webhook oder GitHub-Actions-Cron.
**Abhängigkeiten:** L-Trial Backend

### [Email · L-Trial] L0 — 'Du hast 7 Tage Glev+' (Tag 0)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Template `lib/emails/l-trial-day0.tsx`. Resend-Versand via `flush-outbox`-Cron.
**Abhängigkeiten:** Email-Sequenz Setup

### [Email · L-Trial] L4 — 'Arztbericht: 3 Minuten statt 20' (Tag 4)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Template `lib/emails/l-trial-day4.tsx`. Feature-Showcase: PDF-Report-Screenshot.
**Abhängigkeiten:** Email-Sequenz Setup

### [Email · L-Trial] L2 — 'Jemand würde das gerne sehen' (Tag 2)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Template `lib/emails/l-trial-day2.tsx`. Familienzugang-Teaser.
**Abhängigkeiten:** Email-Sequenz Setup

### [Email · L-Trial] L6 — Entscheidungshilfe vor Trial-Ende (Tag 6)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Template `lib/emails/l-trial-day6.tsx`. Vergleichs-Table S/M/L mit Preisen.
**Abhängigkeiten:** Email-Sequenz Setup

### [Email · L-Trial] L7 — Letzter Tag, finaler Push (Tag 7)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Template `lib/emails/l-trial-day7.tsx`. Urgency + Support-Link.
**Abhängigkeiten:** Email-Sequenz Setup

### [Stripe] Produkt-Beschreibungen in Stripe Dashboard aktualisieren
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Non-Dev: Stripe Dashboard → Products → Beschreibungen finalisieren (Hub-Stand).
**Abhängigkeiten:** keine

### [Homepage] Fix: 'Arztbericht als PDF' aus M-Card entfernen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `app/page.tsx`: M-Tier-Feature-Liste prüfen, „Arztbericht als PDF" auf L-Tier verschieben oder entfernen.
**Abhängigkeiten:** keine

### [Feature M] Sport-Auswertung: Wie wirkt Aktivität auf TIR/Glukose?
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Insights-Karte: TIR an Trainingstagen vs. Ruhetagen. Correlation-Score. `exercise_logs JOIN cgm_samples ON date(recorded_at)`.
**Abhängigkeiten:** keine

### [Feature M] Zyklus-Phasen-Auswertung: Glukose-Muster je Phase
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Insights-Karte: BG-Durchschnitt je Zyklus-Phase (Follikel/Ovulation/Luteal/Menstruation). `menstrual_logs JOIN cgm_samples`.
**Abhängigkeiten:** Zyklus-Sync

### [Feature Gate] CGM bei S: Kurve sehen, Analyse bei M
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Feature-Gate in `middleware.ts` oder Komponenten: CGM-Kurve sichtbar für alle, aber Insights-Analyse (TIR, GMI, Pattern) nur für M+. Blur-Overlay mit Upgrade-CTA auf S.
**Abhängigkeiten:** keine

### Mobile View: Kartengrößen überarbeiten
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Teilweise erledigt (#674, #675). Restliche Dashboard-Karten (IOBCard, Mahlzeiten-Liste) auf 375px-Breakpoint prüfen.
**Abhängigkeiten:** #674, #675 (merged)

### Settings: Dosierungs-Raster konfigurierbar (0.1/0.5/1er Schritte)
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `user_settings.bolus_step_size numeric DEFAULT 0.5`. Settings-SnapSlider mit Optionen 0.1/0.5/1.0. `EngineLogTab.tsx` + `SnapSlider` nutzen `step={userSettings.bolusStepSize}`.
**Abhängigkeiten:** keine

### [DEV] Test-Suite reparieren — Typecheck-Fehler bereinigen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Pre-existing Errors: `mealBolusMirror.test.ts` (`parsedJson readonly []`). Fix: `parsedJson: [] as ParsedFood[]` in Test-Fixtures. `import { test, beforeAll, afterAll } from '@playwright/test'` korrigieren.
**Abhängigkeiten:** keine

### [DEV] Nav-Tab Verifikation auf iOS — Saved-Screen Fix
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** TestFlight-Build: Bottom-Nav auf iOS prüfen. `Commit 165544` Saved-Screen-Regression verifizieren. Playwright kann Capacitor-Native nicht testen — manueller Test nötig.
**Abhängigkeiten:** TestFlight-Build

---

## Sprint 2 — Legal + Account-Setup

### iubenda oder eRecht24 Account anlegen
**Status:** offen ⚠️ überfällig (2026-05-03)
**Priorität:** P1
**Plan:** Non-Dev: Datenschutz- + Impressum-Generator. ~€25-50/Jahr. Dann URL in App hinterlegen.
**Abhängigkeiten:** keine

### Apple Developer Program registrieren (99 USD/Jahr)
**Status:** offen ⚠️ überfällig (2026-05-04)
**Priorität:** P1
**Plan:** Non-Dev: developer.apple.com → Enroll. Benötigt DUNS-Nummer für Unternehmen oder persönliches Konto.
**Abhängigkeiten:** keine

### Impressum-Text generieren und live stellen
**Status:** offen ⚠️ überfällig (2026-05-04)
**Priorität:** P1
**Plan:** iubenda-Text in `app/impressum/page.tsx` einbauen. Route bereits existiert? Falls nicht: `app/impressum/page.tsx` anlegen, statischer Text.
**Abhängigkeiten:** iubenda Account

### Stripe KYC vollständig abschließen
**Status:** offen ⚠️ überfällig (2026-05-06)
**Priorität:** P1
**Plan:** Non-Dev: Stripe Dashboard → Account → Verify Identity.
**Abhängigkeiten:** keine

### Stripe Live-Mode aktivieren
**Status:** offen ⚠️ überfällig (2026-05-08)
**Priorität:** P1
**Plan:** Non-Dev: Stripe Dashboard → Live-Keys → in Vercel ENV als `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` eintragen. Deployment triggern.
**Abhängigkeiten:** Stripe KYC

### [FUNDING] KfW StartGeld — Machbarkeit prüfen
**Status:** offen (2026-05-31)
**Priorität:** Backlog
**Plan:** Non-Dev: kfw.de/startgeld. Benötigt DE Entity.
**Abhängigkeiten:** Entity-Entscheidung

### [FUNDING] Entity-Entscheidung — Portugal Lda vs. Deutschland UG vs. Estland e-Residency
**Status:** offen (2026-06-28)
**Priorität:** Backlog
**Plan:** Non-Dev: Steuerberater + Anwalt konsultieren.
**Abhängigkeiten:** keine

---

## Sprint 3 — Capacitor + Native Setup

### Splash-Screens für iOS und Android
**Status:** offen ⚠️ überfällig (2026-05-12)
**Priorität:** P1
**Plan:** `@capacitor/splash-screen` Config in `capacitor.config.ts`. PNG-Assets: iOS 1242×2688, Android 1080×1920. In `android/app/src/main/res/drawable/` + Xcode-Assets.
**Abhängigkeiten:** keine

### Privacy Manifest für iOS 17+ erstellen
**Status:** offen ⚠️ überfällig (2026-05-13)
**Priorität:** P1
**Plan:** `ios/App/PrivacyInfo.xcprivacy` anlegen. Required Keys: `NSPrivacyAccessedAPITypes` (UserDefaults, FileTimestamp je nach Capacitor-Plugins). Apple-Docs: developer.apple.com/documentation/bundleresources/privacy_manifest_files.
**Abhängigkeiten:** Apple Developer Account

### Android App: Capacitor Android Platform einrichten + erster Build
**Status:** offen ⚠️ überfällig (2026-05-20)
**Priorität:** P1
**Plan:** `npx cap add android` falls noch nicht getan. `google-services.json` aus Firebase in `android/app/`. `npx cap sync android`. Android Studio: Generate Signed Bundle. `android/SIGNING_SETUP.md` folgen.
**Abhängigkeiten:** keine

### GitHub Actions: Android AAB Release Pipeline
**Status:** offen (2026-05-21)
**Priorität:** P2
**Plan:** `.github/workflows/android-release.yml`: Trigger `push to main`. Steps: `pnpm build`, `npx cap sync android`, `./gradlew bundleRelease`. Keystore via GitHub Secrets. Upload AAB als Artifact.
**Abhängigkeiten:** Android Capacitor Setup


### Apple Health Integration — Replit Prompt ausführen
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** `lib/appleHealth.ts` + `@capacitor-community/health-kit`. BG-Daten aus HealthKit lesen, in `apple_health_readings` schreiben. Hintergrund-Sync via `BackgroundRunner`.
**Abhängigkeiten:** Apple Developer Account

---

## Sprint 4 — TestFlight + Internal Testing

### TestFlight-Build hochladen
**Status:** offen ⚠️ überfällig (2026-05-17)
**Priorität:** P1
**Plan:** Xcode: Archive → Upload to App Store Connect. Oder Transporter.app. Vorher: `pnpm build && npx cap sync ios`.
**Abhängigkeiten:** Apple Developer Account, Privacy Manifest

### Google Play Internal Testing Track Build hochladen
**Status:** offen ⚠️ überfällig (2026-05-17)
**Priorität:** P1
**Plan:** Android AAB via Play Console hochladen. Internal Testing Track → Tester-Email-Liste.
**Abhängigkeiten:** Android AAB

### Liste von 5-10 T1D-Bekannten als Beta-Tester zusammenstellen
**Status:** offen ⚠️ überfällig (2026-05-18)
**Priorität:** P1
**Plan:** Non-Dev: Persönliches Netzwerk.
**Abhängigkeiten:** keine

### Beta-Tester per Email einladen
**Status:** offen ⚠️ überfällig (2026-05-19)
**Priorität:** P1
**Plan:** Non-Dev: TestFlight + Play Internal Links.
**Abhängigkeiten:** Builds hochladen

### Feedback-Sammelpunkt einrichten
**Status:** offen ⚠️ überfällig (2026-05-19)
**Priorität:** P1
**Plan:** Non-Dev: Tally.so oder Google Forms. Felder: App-Version, Bug-Beschreibung, Screenshot-Upload.
**Abhängigkeiten:** keine

### Bug-Backlog aus Tester-Reports sammeln
**Status:** offen (2026-05-21)
**Priorität:** P1
**Plan:** Non-Dev: Tally-Responses → Asana-Tasks.
**Abhängigkeiten:** Feedback-Sammelpunkt

### Tester-Sync: 1:1 oder Group-Call
**Status:** offen (2026-05-22)
**Priorität:** P1
**Plan:** Non-Dev: Zoom/Google Meet.
**Abhängigkeiten:** Beta-Tester eingeladen

### Top-3 Critical-Bugs fixen + neuen Build
**Status:** offen (2026-05-22)
**Priorität:** P1
**Plan:** Abhängig von Tester-Reports. Replit-Agent-Tasks nach Bugfix-Beschreibungen anlegen.
**Abhängigkeiten:** Bug-Backlog

### Praxis-Link: unique URL + Landing Page pro Praxis
**Status:** offen (2026-06-07)
**Priorität:** Backlog
**Plan:** `app/praxis/[slug]/page.tsx`. Slug → Praxis-Record in `clinics`-Tabelle. Landing mit Praxis-Logo + Beta-Signup-Form. QR-Code-Generator im Admin.
**Abhängigkeiten:** keine

---

## Sprint 5 — Marketing + Pre-Launch-Push

> Alle Non-Dev Tasks — kein Replit-Agent-Scope außer technische Implementierungen.

### Meta Pixel auf glev.app/beta installieren
**Status:** offen ⚠️ überfällig (2026-05-07)
**Priorität:** P1
**Plan:** `app/layout.tsx`: Meta-Pixel-Script via `next/script` (strategy: `afterInteractive`). Pixel-ID aus `NEXT_PUBLIC_META_PIXEL_ID` Env-Var. Event: `PageView` auf allen Seiten, `Lead` auf `/beta/success`.
**Abhängigkeiten:** keine

### Sprint 5 Final Push — 4 Posts vorbereiten
**Status:** offen (2026-05-22)
**Priorität:** P1
**Plan:** Non-Dev.
**Abhängigkeiten:** Social-Media-Konten

*(Restliche Sprint-5-Tasks sind Non-Dev — Social Media, Reels, Facebook-Setup, TikTok-Profil, Influencer-Outreach, Startnext-Kampagne.)*

---

## Sprint 6 — App-Store-Listings vorbereiten

> Überwiegend Non-Dev. Technische Ausnahmen:

### Privacy Policy URL für beide App-Stores hinterlegen
**Status:** offen (2026-06-05)
**Priorität:** P2
**Plan:** `app/datenschutz/page.tsx` muss existieren und öffentlich erreichbar sein (kein Auth-Gate). URL `https://glev.app/datenschutz` in App Store Connect + Play Console eintragen.
**Abhängigkeiten:** iubenda / Datenschutz-Text

*(Restliche Tasks sind Non-Dev: Screenshots, Beschreibungen, Keywords.)*

---

## Sprint 7 — Public Submission

> Überwiegend Non-Dev (Submissions, Builds, Customer-Support).

### Resend oder Postmark für transactional Emails einrichten
**Status:** offen (2026-06-11)
**Priorität:** P2
**Plan:** Resend bereits integriert (Drip-Pipeline via `lib/emails/`). Verbleibend: Transactional-Templates für Account-Actions (Passwort-Reset, Willkommen) prüfen ob alle live-ready sind.
**Abhängigkeiten:** keine

### Stripe-Webhook-URLs für Live-Domain verifizieren
**Status:** offen (2026-06-12)
**Priorität:** P2
**Plan:** Beide Endpoints in Stripe Dashboard: `https://glev.app/api/pro/webhook` + `https://glev.app/api/webhooks/stripe`. Test-Event senden → Response 200 verifizieren. Secrets in Vercel ENV.
**Abhängigkeiten:** Stripe Live-Mode

---

## Sprint 8 — Review-Buffer + Standard-Tier

### Standard-Tier €9/Monat mit 7-Tage-Trial bauen
**Status:** offen (2026-06-16)
**Priorität:** P2
**Plan:** Stripe-Produkt für Standard-Tier anlegen. `subscription_tier = 'standard'` in `profiles`. Feature-Gate-Middleware anpassen. `/signup`-Page (nächster Task). Checkout-Flow via bestehende Stripe-Integration.
**Abhängigkeiten:** Stripe Live-Mode

### /signup-Page als public Marketing-Page für Standard-Tier
**Status:** offen (2026-06-17)
**Priorität:** P2
**Plan:** `app/signup/page.tsx`: Öffentliche Seite (kein Auth-Gate). Preistabelle + CTA → Stripe Checkout. SEO-optimiert.
**Abhängigkeiten:** Standard-Tier Stripe

### Beta-Redirect-Logik /beta → /signup für 1. Juli
**Status:** offen (2026-06-18)
**Priorität:** P2
**Plan:** `middleware.ts`: Ab 2026-07-01 `pathname === '/beta'` → `redirect('/signup')`. Date-Check via `new Date() >= new Date('2026-07-01')`.
**Abhängigkeiten:** /signup-Page

### Performance-Tuning für Cold-Start
**Status:** offen (2026-06-19)
**Priorität:** P2
**Plan:** Vercel Analytics: Slowest Routes identifizieren. `app/api/ai/chat/route.ts`: Supabase-Client-Init optimieren. `fetchMeals`: Edge-Caching für Dashboard. `next/dynamic` für schwere Komponenten.
**Abhängigkeiten:** keine

---

## Sprint 9 — Soft-Launch-Vorbereitung

### Arzt-Report: Kurz- vs. Langwirksames Insulin — Tagesverhältnis
**Status:** offen (2026-05-29)
**Priorität:** P2
**Plan:** `app/api/report/route.ts` oder PDF-Generator: Sektion „Insulin-Verhältnis" — Bolus-Summe / Basal-Summe aus `insulin_logs` der letzten 14/30 Tage. Benchmark: 50:50 für ICT-User.
**Abhängigkeiten:** Arztbericht-PDF

### Arzt-Report: 24h-Tagesansicht mit Bolus, Basal & Einflussfaktoren
**Status:** offen (2026-05-29)
**Priorität:** P2
**Plan:** SVG-Chart: 24h-Zeitachse mit CGM-Kurve, Bolus-Marker (↑), Basal-Rate-Linie, Exercise-Marker. Daten aus `cgm_samples + insulin_logs + exercise_logs`.
**Abhängigkeiten:** Arztbericht-PDF

### Offline-First: SQLite lokaler Cache via Capacitor Plugin
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** `@capacitor-community/sqlite`: Lokale Kopie der letzten 30 Tage Meals + CGM. Sync bei App-Open wenn Online. Engine-Berechnungen auch Offline verfügbar.
**Abhängigkeiten:** keine

### Native Extension: Watch App — BZ anzeigen + Quick-Bolus
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** watchOS-Target in Xcode. WatchConnectivity für BG-Daten. Quick-Bolus-Log ohne iPhone-Öffnen.
**Abhängigkeiten:** Apple Developer Account, App Store approved

### Native Extension: Live Activity / Dynamic Island — BZ + Trend-Pfeil
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** iOS 16.1+ Live Activities API. AttributesProtocol für BG + Trend. Update via Push-Notification-Extension.
**Abhängigkeiten:** Apple Developer Account

### Food History — Context-Match
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Engine: Bei Mahlzeit-Eingabe ähnliche historische Mahlzeiten finden (Embedding-Similarity oder Text-Match). „Du hast das ähnlich letzte Woche gegessen — damals hat 7 IE gut funktioniert."
**Abhängigkeiten:** Per-User Food History

### Post-Meal BZ-Erinnerung für Fingerstick-User
**Status:** offen (kein Datum)
**Priorität:** P2
**Plan:** Via Task #673 teilweise implementiert. Für Fingerstick-User: Push-Notification (kein CGM) 2h nach Mahlzeit-Log. `lib/mealCheckReminders.ts` bereits vorhanden. Web-Push via Capacitor-PushNotifications oder FCM.
**Abhängigkeiten:** #673 (merged)

### [CGM] Libre 3 + Dexcom G7 — Direkte Integration
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Libre 3: Abbott LibreView API (EU). Dexcom G7: Dexcom API v3. Beide benötigen OAuth2-App-Registration.
**Abhängigkeiten:** CGM Settings UI

### [STRATEGIE] DiGA-Pathway — Machbarkeitsanalyse
**Status:** offen (kein Datum)
**Priorität:** Backlog
**Plan:** Non-Dev: BfArM DiGA-Anforderungen. MDR Klasse IIa Vorbereitung (Compliance-Backlog).
**Abhängigkeiten:** keine

*(Weitere Sprint-9-Tasks: Non-Dev — Press-Outreach, Customer-Support, Social-Media.)*

---

## Sprint 10 — LAUNCH

> Alle Tasks Non-Dev außer technischem Monitoring.

### Launch-Day-Monitoring: Crash-Reports, Webhooks, Customer-Support
**Status:** offen (2026-07-01)
**Priorität:** P1
**Plan:** Vercel-Logs live beobachten. Sentry oder Vercel Error-Tracking aktivieren. Stripe-Webhook-Logs prüfen. Supabase-DB-Load überwachen.
**Abhängigkeiten:** Launch

---

## Bekannte Schema-Drift (post-merge-check)

> Diese Migrations sind lokal vorhanden aber noch NICHT auf der Production-DB ausgeführt:

| Migration | Tabelle | Neue Spalten |
|-----------|---------|-------------|
| `20260524_ai_pending_actions.sql` | `ai_pending_actions` | Neue Tabelle (WRITE-Tool-Gate) |
| `20260524_add_low_alarm_threshold.sql` | `user_settings` | `low_alarm_enabled`, `low_alarm_threshold_mgdl` |
| vermutlich weitere | `user_settings` | `low_alarm_enabled`, `low_alarm_threshold_mgdl`, ggf. andere |

> **Aktion:** Supabase Dashboard → SQL Editor → die Dateien aus `supabase/migrations/` manuell ausführen. Dann `npm run db:migrate` (oder post-merge-Script) nochmal prüfen.

---

## Git-Status (Stand 2026-05-24)

Lokaler `main` ist **5 Commits ahead, 3 Commits behind** `origin/main`. Merge-Konflikt in:
- `DECISIONS.md`
- `app/api/ai/confirm-action/route.ts`
- `lib/ai/glevTools.ts`

**Lösung:** `git pull --no-rebase origin main` ausführen, dann Konflikte resolven (Agent wartet auf Output).
