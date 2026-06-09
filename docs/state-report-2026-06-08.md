# Development State Report — Glev Codebase Inventory 2026-06-08

> **READ-ONLY REPORT.** Generated for context-grounding; no production logic was changed.
> Each section ends with a Confidence-Level (see Section 11).

---

## 1. Tech-Stack Inventur

| Paket / Tool | Version |
|---|---|
| **Node.js** | v24.13.0 |
| **TypeScript** | ~5.9.2 (tsc 5.9.3) |
| **Next.js** | ^16.2.6 |
| **React / React-DOM** | 19.1.0 |
| **@capacitor/core** | ^8.3.1 |
| **@capacitor/ios** | ^8.3.1 |
| **@capacitor/android** | ^8.3.1 |
| **@capgo/capacitor-health** | ^8.4.8 |
| **@supabase/supabase-js** | ^2.104.0 |
| **@supabase/ssr** | ^0.10.2 |
| **next-intl** | ^4.9.2 |
| **openai** | ^6.34.0 |
| **@mistralai/mistralai** | ^2.2.1 |
| **stripe** | ^22.1.0 |
| **resend** | ^6.12.2 |
| **swr** | ^2.4.1 |
| **@playwright/test** | ^1.59.1 |

**Top-10 Dependencies nach Bedeutung:**

1. `next` ^16.2.6 — App-Framework (App Router, API Routes, Middleware)
2. `@capacitor/core` + `ios` + `android` ^8.3.1 — Native Shells (iOS + Android Webview)
3. `@supabase/supabase-js` ^2.104.0 — Auth, DB, Edge Functions Client
4. `openai` ^6.34.0 — STT (Whisper/gpt-4o-mini-transcribe), nutrition parsing, chat-macros
5. `@mistralai/mistralai` ^2.2.1 — Glev AI Chat, intent classification
6. `stripe` ^22.1.0 — Subscription/Payment processing
7. `@capgo/capacitor-health` ^8.4.8 — Apple HealthKit Bridge
8. `resend` ^6.12.2 — Transactional Email Outbox
9. `next-intl` ^4.9.2 — i18n (de/en)
10. `swr` ^2.4.1 — Client-side data fetching / revalidation

**Build-Toolchain:** Next.js 16 App Router (Turbopack in dev, Webpack in prod). Kein Vite in der Haupt-App. Playwright für E2E/Unit-Tests.

---

## 2. Backend-Architektur (Supabase)

### Project-Ref
`[unklar — bitte verifizieren]` — `NEXT_PUBLIC_SUPABASE_URL` ist in `.env.example` leer. Der Ref kann aus der Vercel-Env-Variable abgelesen werden.

### Tabellen (public-Schema)

| Tabelle | Beschreibung |
|---|---|
| `meals` | Kern-Tabelle: Mahlzeiteinträge mit `input_text`, `parsed_json`, Makros (Carbs/Protein/Fett/Kalorien), Insulin, CGM-Glukose, `meal_type`, `evaluation` (GOOD/HIGH/LOW), `outcome_state` |
| `profiles` | Pro User: `trial_end_at`, Sprache, Carb-Unit, Onboarding-Flag, `push_token`/`push_platform`/`push_token_updated_at`, persönliche Infos |
| `user_preferences` | UI-Reihenfolge (Dashboard- und Insights-Karten), per-user |
| `user_settings` | Erweiterte Einstellungen (z.B. CGM-Source, Alarmschwellen), versioniert via `user_settings_history` |
| `insulin_logs` | Manuelle Bolus- und Basal-Insulingaben (Einheit, Typ, Zeitstempel) |
| `exercise_logs` | Bewegungseinträge (Typ, Dauer, Intensität) |
| `fingerstick_readings` | Manuelle Blutzuckermessungen (mg/dL, Zeitstempel) |
| `cgm_samples` | Normierte CGM-Punkte aller Adapter-Quellen (15-min-Buckets) |
| `apple_health_readings` | Roh-CGM-Readings von Apple Health (iOS-Push) |
| `nightscout_readings` | CGM-Readings von Nightscout (polling) |
| `meal_glucose_samples` | CGM-Kurvenabschnitte um Mahlzeiten (pre/post) |
| `bolus_glucose_samples` | CGM-Kurven rund um Bolus-Gaben |
| `exercise_glucose_samples` | CGM-Kurven rund um Sport-Sessions |
| `meal_timeline_checks` | Drag-and-drop Mahlzeit-Nodes auf CGM-Kurve (pre/post-Checks mit Bestätigungs-Status) |
| `hypo_push_cooldown` | Server-seitiger Cooldown für Hypo-Push-Alarme (per User, 15 min) |
| `elevated_push_cooldown` | Server-seitiger Cooldown für Elevated-Alarme |
| `hyper_push_cooldown` | Server-seitiger Cooldown für Hyper-Alarme |
| `cgm_fetch_jobs` | Queue für CGM-Polling-Jobs (LLU/Nightscout) |
| `cgm_setup_requests` | Lead-Capture für CGM-Setup-Anfragen (Source: klinik/praxis/beta) |
| `ai_pending_actions` | Wartende AI-Tool-Calls (confirm_gate) die User-Bestätigung brauchen |
| `ai_user_memory` | Persistente User-Kontext-Facts für Glev AI (strukturierte Erinnerungen) |
| `ai_rate_limit_hits` | Zähler für Rate-Limiting von AI-Calls |
| `influence_logs` | Einträge für Einflussfaktoren (Alkohol, Koffein, Stress etc.) auf Glukose |
| `symptom_logs` | Symptom-Einträge (Zyklus, Befindlichkeit) |
| `menstrual_logs` | Zyklus-Einträge (Periode, Ovulation) |
| `sleep_sessions` | Schlaf-Tracking-Einträge |
| `daily_activity_summary` | Tages-Aggregat aus Apple Health (Schritte, Kalorien) |
| `appointments` | Arzttermin-Tracking |
| `user_food_history` | Häufig gegessene Gerichte pro User (personalisierte Autovervollständigung) |
| `user_icr_schedule` | Tageszeit-abhängige ICR-Werte (Insulin-to-Carb-Ratio) pro User |
| `meal_prep_refinements` | Verfeinerungen aus dem Mahlzeit-Prep-Flow |
| `rejected_pairs` | Abgelehnte Mahlzeit-Bolus-Paare (Engine-Learning) |
| `meta_leads` | Facebook/Instagram Ads-Leads (leadgen_id, Name, Email, Telefon, Kampagneninfo) |
| `referrals` | Referral-Codes und Konversions-Tracking |
| `short_links` | URL-Shortener-Tabelle (`glev.app/s/<token>` → Ziel-URL) |
| `message_templates` | SMS-Templates (invite, bulk, reminder) — DB-gespeichert |
| `sms_optout_events` | SMS-Opt-out-Tracking |
| `agent_messages` | Telegram-Agent-Nachrichten-Queue (Inbox Daemon) |
| `replit_queue` | Replit-Task-Queue für Agent-Handoffs |
| `admin_audit_log` | Audit-Log für Admin-Aktionen in /glev-ops |
| `admin_tts_config` | Konfiguration für TTS-Stimmen (Mistral) |
| `glev_ops_users` | Team-Zugänge für /glev-ops (Email, Rolle, TOTP-Secret, Marketer-Flag) |
| `user_feedback` | Strukturiertes User-Feedback via Glev AI (what/where/broken/wished, Kategorie, Severity, Status-Workflow) |
| `dev_cockpit_tasks` | Dev-Cockpit: Aufgaben-Tracking für AI-Agent-Tasks |
| `dev_cockpit_messages` | Dev-Cockpit: Chat-History pro Task |
| `dev_cockpit_attachments` | Dev-Cockpit: Datei-Anhänge |
| `dev_cockpit_builds` | Dev-Cockpit: Build-Artefakte (iOS/Android) |
| `dev_cockpit_code_generations` | Dev-Cockpit: AI-generierter Code |
| `dev_cockpit_previews` | Dev-Cockpit: Vorschau-Links |
| `dev_cockpit_prompt_queue` | Dev-Cockpit: Prompt-Queue |
| `stripe_processed_events` | Verarbeitete Stripe-Webhook-Event-IDs (Idempotenz) |

### Edge Functions

| Funktion | Zweck | `verify_jwt` | Trigger |
|---|---|---|---|
| `hypo-check` | Hypo-Alarm-Push (FCM/APNs) wenn CGM < Schwellwert | `false` | Cron alle 5 min |
| `elevated-check` | Elevated-Alarm wenn CGM > leichter Schwellwert | `false` | Cron |
| `hyper-check` | Hyper-Alarm wenn CGM > hoher Schwellwert | `false` | Cron |
| `cgm-ingest-alarm` | Sofort-Alarm bei neuem CGM-INSERT (Apple Health / Nightscout) | nicht gesetzt (→ `true`, aber Auth via service_role JWT aus pg_net-Trigger) | Postgres-Trigger via pg_net |

### Storage-Buckets

| Bucket | Zweck |
|---|---|
| `sound-assets` | Alarm-WAV-Dateien (glev_low_alarm.wav, glev_high_alarm.wav, glev_elevated.wav) |
| `agent-files` | Datei-Anhänge vom Telegram-Bot-Agent |

### RLS-Status (Übersicht)
RLS ist aktiviert auf den meisten User-Tabellen (`meals`, `profiles`, `insulin_logs`, `exercise_logs`, `user_feedback`, etc.). Admin-Tabellen (`dev_cockpit_*`, `admin_audit_log`) haben RLS an aber keine User-Policies (nur service_role Zugriff). `user_feedback` erlaubt nur INSERT für User (kein SELECT — Privacy). Vollständige Policy-Liste im Supabase Dashboard.

---

## 3. AI-Pipeline — Welches Modell macht was

| Pfad im Code | Modell (aktuell) | Zweck | Temperatur | Structured Output | Env-Var |
|---|---|---|---|---|---|
| `app/api/transcribe/route.ts` | `gpt-4o-mini-transcribe` | Voice-STT (Mikrofon-Input aus Glev AI Chat) | — | Nein (plain text) | `AI_INTEGRATIONS_OPENAI_API_KEY` / `OPENAI_API_KEY` |
| `app/api/telegram/webhook/route.ts` | `whisper-1` | Telegram-Bot Audio-Transkription | — | Nein | `OPENAI_API_KEY` |
| `lib/nutrition/parseFood.ts` | `gpt-4o-mini` | Free-form Text → strukturierte Mahlzeit-Items (bilingual search terms) | 0.1 | Ja (JSON) | `AI_INTEGRATIONS_OPENAI_API_KEY` / `OPENAI_API_KEY` |
| `lib/nutrition/estimate.ts` | `gpt-4o-mini` | Makro-Schätzung als Safety-Net wenn OFF/USDA-Lookup scheitert | 0.1 | Ja (JSON) | `AI_INTEGRATIONS_OPENAI_API_KEY` / `OPENAI_API_KEY` |
| `app/api/chat-macros/route.ts` | `gpt-5` | Chat-Makros / Autocomplete-Vorschläge | — | `[unklar — bitte verifizieren]` | `AI_INTEGRATIONS_OPENAI_API_KEY` / `OPENAI_API_KEY` |
| `app/api/ai/chat/route.ts` | `mistral-small-latest` | Glev AI Chat (Tool-Calls, Function Calling, Kontext-Snapshot) | 0.4 | Nein (native function calling) | `MISTRAL_API_KEY` |
| `app/api/ai/classify-intent/route.ts` | `mistral-small-latest` | Voice-Intent-Klassifikation (vor Chat-Pipeline) | 0.1 | `[unklar — bitte verifizieren]` | `MISTRAL_API_KEY` |

> **Kein `lib/nutrition/enrich.ts` gefunden** — kein separater Enrich-Schritt vorhanden. Makros werden direkt in `lib/nutrition/aggregate.ts` via OFF/USDA/GPT zusammengeführt.

---

## 4. AI-Feedback-Funnel

**Implementiert: JA** (als D-033 entschieden, 2026-06-07).

| Punkt | Detail |
|---|---|
| **Einstieg** | User gibt Feedback im Glev AI Chat → AI führt 2-Runden-Fragestrategie (what/where/broken/wished) |
| **Backend-Tool** | `submit_structured_feedback` in `lib/ai/glevTools.ts` — direkter DB-INSERT ohne Confirm-Gate |
| **Supabase-Tabelle** | `user_feedback` (fields: source, what_noticed, where_noticed, what_broken, what_wished, category, severity, free_text, ai_summary, screen_context, platform, status) |
| **Audio-Speicherung** | **Nicht persistent** — Audio wird transkribiert via `/api/transcribe`, das Transkript geht in den Chat. Kein Audio-Blob in Storage. |
| **Chat-Transcripts** | Werden **nicht** persistiert — kein `chat_messages`-Table für Glev AI. Nur `user_feedback`-Einträge landen in der DB. |
| **Admin-View** | `app/glev-ops/feedback/page.tsx` — Filter-Bar (Status/Kategorie/Severity/Platform/Datum), Tabelle mit Row-Click-Detail-Sheet inkl. Status-Workflow + Admin-Notes |
| **Admin-API** | `app/api/admin/feedback/route.ts` (GET mit Pagination + Filter, PATCH für Status) |
| **Auth-Gate** | `glev_ops_token` Cookie (selbe 3-Faktor-Session wie alle /glev-ops-Routen) |

---

## 5. iOS-Spezifika

### Aktive Capacitor-Plugins (aus `capacitor.config.ts` `packageClassList`)

| Plugin-Klasse | npm-Paket |
|---|---|
| `HapticsPlugin` | `@capacitor/haptics` ^8.0.2 |
| `LocalNotificationsPlugin` | `@capacitor/local-notifications` ^8.2.0 |
| `PushNotificationsPlugin` | `@capacitor/push-notifications` ^8.0.3 |
| `ScreenOrientationPlugin` | `@capacitor/screen-orientation` ^8.0.1 |
| `SharePlugin` | `@capacitor/share` ^6.0.2 |
| `HealthPlugin` | `@capgo/capacitor-health` ^8.4.8 |
| `GlevCriticalAlertsPlugin` | **Inline / Custom** (kein npm-Paket) |

> **ACHTUNG (D-032):** `cap sync ios` überschreibt `packageClassList` in `ios/App/App/capacitor.config.json` und strippt Custom-Plugins. Nach jedem sync muss die Liste manuell vervollständigt werden.

### Custom Native Module

**`GlevCriticalAlertsPlugin.swift`** (`ios/App/App/`)
- Registriert als: `GlevCriticalAlerts` (CAPPlugin + CAPBridgedPlugin)
- Methode: `requestPermission()` → ruft `UNUserNotificationCenter.current().requestAuthorization(options: [.criticalAlert])` auf
- JS-Bridge: `lib/criticalAlerts.ts` via `registerPlugin('GlevCriticalAlerts')`
- Status: implementiert, in `packageClassList` gelistet ✓

**HealthKit-Integration** (`lib/cgm/appleHealthClient.ts`)
- `requestAuthorization()` aufgerufen in `lib/cgm/appleHealthClient.ts:197`
- Verwendete domain-strings (korrekte Syntax per AGENTS.md-Convention):
  ```
  read: ["bloodGlucose", "steps", "calories", "workouts"]
  ```
- Background Delivery: via `AppDelegate.swift` (HKQuantityType `.bloodGlucose`)

### Entitlements (`ios/App/App/App.entitlements`)

| Entitlement | Status |
|---|---|
| `com.apple.developer.healthkit` | ✅ vorhanden |
| `com.apple.developer.healthkit.background-delivery` | ✅ vorhanden |
| `com.apple.developer.usernotifications.critical-alerts` | ✅ vorhanden |
| External Link Account Entitlement | ❌ nicht vorhanden |

### Push (APNs)
- `aps-environment: production` in App.entitlements ✅
- Token-Sync-Pfad: `lib/pushNotifications.ts` → `localStorage` (`glev_push_token`) → POST zu Supabase → `profiles.push_token` + `profiles.push_platform`
- `profiles.push_token`-Spalte: vorhanden ✅ (Migration `20260525_push_token.sql`)

### iOS Version
- `MARKETING_VERSION`: **1.0.2**
- `CURRENT_PROJECT_VERSION`: **1**

---

## 6. Android-Spezifika

| Punkt | Status |
|---|---|
| **@capacitor/android** | ^8.3.1 |
| **gradle-Sync** | `[unklar — bitte verifizieren]` (kein gradle-output in Replit zugänglich) |
| **google-services.json** | ❌ **FEHLT** (gitignored; muss manuell platziert werden per `android/SIGNING_SETUP.md` §6) |
| **FCM eingerichtet** | Code vorhanden (`lib/pushNotifications.ts` + Supabase Edge Functions), aber `google-services.json` fehlt |
| **Notification Channels** | `MainActivity.java`: `hypo_alarm` mit `IMPORTANCE_HIGH` + Sound `glev_low_alarm.wav` |
| **setBypassDnd** | Nicht explizit gefunden (IMPORTANCE_HIGH ≠ Bypass DnD auf Android — `[unklar — bitte verifizieren]`) |
| **Foreground Service** | Nicht gefunden |
| **Bekannte Crash-Areas** | Kein google-services.json → FCM-Push nicht funktionsfähig bis Datei platziert; kein weiterer Crash-Log gefunden |

---

## 7. Auth-State

| Punkt | Detail |
|---|---|
| **Auth-Provider** | Supabase Email/Password (primär) |
| **Sign-in-with-Apple** | ❌ **Nicht implementiert** — kein `signInWithApple`-Aufruf in Code, kein Supabase Apple-Provider |
| **Sign-in-with-Google** | ❌ Nicht gefunden |
| **Magic Link / OTP** | ✅ via `generateLink({ type: "invite" | "recovery" })` für Admin-Provisioning |

**Master-Admin-Fallback** (`lib/adminAuth.ts`):
```typescript
// Founder account — always authenticated as admin if password matches,
// regardless of ADMIN_EMAIL env var. Prevents permanent lockout from
// misconfigured env vars or future glev_ops_users migration bugs.
const MASTER_ADMIN_EMAIL = "lucas@wahnon-connect.com";
```
Auth-Flow: 3-Faktor (Email + `ADMIN_API_SECRET` Passwort + TOTP via `ADMIN_TOTP_SECRET`). Marketer-Login: 2-Faktor (`MARKETER_EMAIL` + `MARKETER_PASSWORD`).

**Admin-Route `/glev-ops`:**
- Gate-Logik: `lib/adminAuth.ts` → `isAdminAuthed()` / `isMarketerAuthed()` — prüft `glev_ops_token`-Cookie (HMAC-signiert: `"${role}:${hmac}"`)
- Layout: `app/glev-ops/layout.tsx` (server-side auth check)

---

## 8. Frontend-Architektur

### Routing-Struktur (Top-Level)

| Route | Typ | Beschreibung |
|---|---|---|
| `/` | Public | Marketing Landing Page |
| `/pro` | Public | Pro-Tier Landing Page |
| `/beta` | Public | Beta Landing Page |
| `/login` | Public | Login-Form |
| `/signup` | Public | Signup-Flow |
| `/welcome` | Public | Welcome-Page nach Signup |
| `/onboarding` | Protected | Onboarding-Wizard (neue User) |
| `/dashboard` | Protected | Haupt-Dashboard (CGM, ADAPT-Score, Meal-Node-Cluster) |
| `/log` | Protected | Mahlzeit- + Insulin- + Bewegungs-Logging |
| `/entries` | Protected | Mahlzeiten-Listenansicht |
| `/insights` | Protected | Glukose-Insights, TIR, CGM-Statistiken |
| `/engine` | Protected | Glev Engine (Bolus-Empfehlung, Ähnliche Mahlzeiten) |
| `/glev-ai` | Protected | Dedizierte Glev AI Chat-Seite |
| `/settings/*` | Protected | Einstellungen (CGM, Alarme, Konto, AI) |
| `/import` | Protected | Daten-Import |
| `/auth/confirm` | Öffentlich (whitelisted) | Passwort-Setup / Reset per Magic Link |
| `/auth/callback` | Öffentlich (whitelisted) | PKCE-Code-Exchange-Endpoint |
| `/auth/auth-error` | Öffentlich | Auth-Fehler-Landing (Fallback) |
| `/glev-ops/*` | Admin | Operator-Tools (buyers, drip, emails, feedback, users, CRM, Dev-Cockpit) |
| `/legal` | Public | Datenschutz / Impressum |
| `/praxis` | Public | Praxis-Landing |
| `/klinik` | Public | Klinik-Landing |

### State-Management
- **swr** für Remote-Daten (CGM, Mahlzeiten, User-Settings)
- **React Context** für UI-State (Glev AI Session via `lib/useGlevAI.ts`)
- **localStorage** für Token-Cache (`glev_push_token`, `glev_theme`, etc.)
- **Kein Zustand / Redux** — reine React-Hooks + swr

### AI-Chat-Komponente
- **Datei:** `components/GlevAIChatSheet.tsx` (Haupt-Chat-UI)
- **Einstiegspunkte:** Layout FAB (`components/Layout.tsx`), `/glev-ai`-Seite
- **Voice-Input:** `MediaRecorder` API → Audio-Blob → `POST /api/transcribe` (gpt-4o-mini-transcribe) → Transkript in Chat-Input
- **Text-Input:** `POST /api/ai/chat` (mistral-small-latest)
- **Intent-Routing:** Optional via `POST /api/ai/classify-intent` (mistral-small-latest, temp=0.1) → Intent-Chip wird 2–3 s angezeigt
- **File-Upload:** ❌ Nicht implementiert in GlevAIChatSheet

### Footer-Nav-Komponente
- **Datei:** `components/Layout.tsx`
- **Funktion:** `MobileTab` (ca. Zeile 1588) + `MobileGlevFab` (Center-FAB)
- Labels: UPPERCASE, fontSize 9px, letterSpacing 0.04em

### Header-Komponente
- **Datei:** `components/Layout.tsx`
- **Live-CGM-Pill:** JA — `CgmStatusPill` (ca. Zeile 1444), eingebunden bei L1007
- States: `live` (grün pulsierend, <5 min), `connecting` (gelb), `delayed` (orange, 5–15 min), `offline` (rot, >15 min), `paused` (grau, vorbereitet — kein Feature aktiv)

### ADAPT-Score-Tile
- **Datei:** `app/(protected)/dashboard/page.tsx` (ca. Zeile 1788)
- **Aktuelle Tier-Labels:**
  - KONSISTENT (ehem. STARK)
  - STABIL (ehem. GUT)
  - ANPASSUNG (bleibt unverändert — `[bitte verifizieren]`)

---

## 9. Compliance-Architektur

### AGENTS.md
- **Vorhanden:** ✅
- **Sektionen:**
  1. `# AGENTS.md — Glev Agent Conventions` (Header)
  2. `## HealthKit Conventions`
- **HealthKit-Conventions-Sektion:** ✅ JA

### DECISIONS.md
- **Höchste D-Nummer:** D-034 (2026-06-07) — Compliance-Linguistik in UI-Status-Texten
- **Datum letzter Fix-Log-Eintrag:** 2026-06-08 (BUG-FIX Invite/Recovery-Links)
- **Anzahl D-XXX-Einträge:** D-001 bis D-034 (34 Entscheidungen dokumentiert)

### CI-Workflows (`.github/workflows/`)

| Datei | Zweck |
|---|---|
| `alarm-cron.yml` | Cron-basierte Alarm-Checks |
| `android-chrome-slider.yml` | Android Chrome Slider-Tests |
| `android-release.yml` | Play Store Release (Fastlane) |
| `apply-migration.yml` | Supabase Migration anwenden |
| `cgm-jobs-flush.yml` | CGM-Fetch-Job-Queue flushen |
| `engine-doc-check.yml` | Engine-Dokumentation prüfen |
| `flush-outbox.yml` | Email-Outbox flushen (`*/2 * * * *`) |
| `ios-release.yml` | TestFlight Release (Fastlane) |
| `migration-check.yml` | Migration-Schema-Check |
| `playwright-chromium.yml` | Playwright E2E Tests |
| `process-queue.yml` | Replit-Task-Queue verarbeiten |
| `remind-meta-leads.yml` | Meta-Lead-Reminder-SMS |
| `remind-post-launch-copy.yml` | Post-Launch Copy-Reminder |
| `translation-key-checks.yml` | i18n-Key-Vollständigkeit prüfen |

**Total: 14 GitHub Actions Workflows**

---

## 10. WIPs / TODOs / FIXMEs im Code

Grep über `app/`, `lib/`, `components/` — **Ergebnis: extrem sauberer Codestand, nur 1 echter TODO gefunden:**

| Nr | Datei | Zeile | Inhalt | Vor Launch (1. Juli)? |
|---|---|---|---|---|
| 1 | `lib/ai/glevTools.ts` | 1 | `// TODO(voice-control): When app-wide voice control is added, intent-routing belongs here.` | Nein — Zukunfts-Feature |
| 2 | `lib/historyLimit.ts` | 4 | `// Drei Stufen (D-XXX):` — Platzhalter für DECISIONS.md-Referenz | Nein — kosmetisch |

> **Keine FIXME, XXX oder HACK-Kommentare** im gesamten src-Tree gefunden.

**Bekannte Pre-Launch-Lücken (nicht als TODO markiert, aber aus DECISIONS.md + Report bekannt):**

| # | Thema | Dringlichkeit |
|---|---|---|
| 1 | `android/app/google-services.json` fehlt → FCM-Push auf Android nicht aktiv | **HOCH** — vor Launch |
| 2 | Sign-in-with-Apple nicht implementiert | Mittel — je nach Anforderung |
| 3 | Sentry nicht integriert (kein Error-Monitoring) | Mittel — vor Launch empfohlen |
| 4 | setBypassDnd für Android-Alarme unklar | **HOCH** — kritische Alarme sollen DnD durchbrechen |
| 5 | External Link Account Entitlement fehlt in App.entitlements | Niedrig — nur wenn External-Link-Feature geplant |
| 6 | Compliance-Backlog (Quellen in Insights, Modal-Disclaimer) — aus replit.md | Vor MDR, nicht vor 1. Juli |

---

## 11. Deployment

| Punkt | Detail |
|---|---|
| **Domain** | `https://glev.app` |
| **Vercel-Konfiguration** | `vercel.json` vorhanden mit 4 Crons: `/api/cron/hypo-check`, `/api/cron/elevated-check`, `/api/cron/hyper-check`, `/api/cron/flush-outbox` (alle `* * * * *` = jede Minute) |
| **Branch** | `main` (Vercel auto-deploys bei Push) |
| **Letzter Deploy-Zeitstempel** | `[unklar — bitte Vercel Dashboard prüfen]` |
| **Letzter Commit-SHA** | `[unklar — bitte Vercel Dashboard prüfen]` |

### Production Env-Vars (laut `.env.example` + Code-Grep)

| Variable | Zweck | Status |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Client | Pflicht |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase Server | Pflicht |
| `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI via Replit AI Integrations Proxy | Pflicht (STT, Nutrition) |
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` | OpenAI direkt (Fallback) | Pflicht |
| `MISTRAL_API_KEY` | Mistral (Glev AI Chat) | Pflicht |
| `MISTRAL_TTS_MODEL` + `MISTRAL_TTS_VOICE_ID` | Mistral TTS-Konfiguration | Optional |
| `MISTRAL_DEV_COCKPIT_API_KEY` | Dev-Cockpit separater Mistral-Key | Optional |
| `RESEND_API_KEY` | Email-Outbox | Pflicht |
| `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe | Pflicht |
| `STRIPE_BETA_WEBHOOK_SECRET` + `STRIPE_PRO_WEBHOOK_SECRET` + `STRIPE_PLUS_WEBHOOK_SECRET` | Stripe Webhooks | Pflicht |
| `STRIPE_BETA_PRICE_ID` + `STRIPE_PRO_PRICE_ID` + `STRIPE_PLUS_PRICE_ID` | Stripe Price-IDs | Pflicht |
| `ADMIN_API_SECRET` + `ADMIN_TOTP_SECRET` + `ADMIN_EMAIL` | Glev-Ops Admin-Auth | Pflicht |
| `MARKETER_EMAIL` + `MARKETER_PASSWORD` | Glev-Ops Marketer-Login | Pflicht |
| `CRON_SECRET` | Cron-Auth (GitHub Actions → Vercel) | Pflicht |
| **Sentry DSN** | **Nicht gefunden** — Sentry ist **nicht integriert** | Fehlt |

---

## Confidence-Level pro Sektion

| Sektion | Level | Grund |
|---|---|---|
| **1 Tech-Stack** | 5/5 | Direkt aus `package.json` + `node --version` |
| **2 Backend (Supabase)** | 4/5 | Tabellen vollständig aus Migrations; Project-Ref und genaue RLS-Policies nur via Dashboard verifizierbar |
| **3 AI-Pipeline** | 5/5 | Alle Model-Strings direkt aus Quellcode; enrich-Schritt nicht gefunden (vermutlich nicht vorhanden) |
| **4 Feedback-Funnel** | 5/5 | Route, Tabelle, Admin-Page direkt gefunden und bestätigt |
| **5 iOS-Spezifika** | 4/5 | Entitlements + Versionen direkt aus Dateien; Podfile leer (keine Pods gelistet — möglicherweise nur via SPM) |
| **6 Android** | 3/5 | MainActivity.java gelesen; google-services.json MISSING bestätigt; gradle-Status und setBypassDnd unklar ohne gradle-output |
| **7 Auth-State** | 5/5 | lib/adminAuth.ts vollständig gelesen; Sign-in-with-Apple sicher nicht vorhanden |
| **8 Frontend** | 4/5 | Routing-Struktur aus `app/`-Verzeichnis; ADAPT-Score dritte Tier-Label nicht vollständig verifiziert |
| **9 Compliance** | 5/5 | AGENTS.md + DECISIONS.md + Workflows direkt gelesen |
| **10 TODOs** | 4/5 | Grep über alle .ts/.tsx — sauberer Code; Pre-Launch-Lücken aus Kontext/DECISIONS.md abgeleitet |
| **11 Deployment** | 3/5 | vercel.json + .env.example gelesen; letzter Deploy-Zeitstempel + Commit-SHA nur via Vercel Dashboard abrufbar |
