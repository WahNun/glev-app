# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system designed to provide personalized insulin recommendations. It analyzes historical meal data, glucose levels, and insulin dosages to offer data-driven insights and empower users in managing their diabetes. The project integrates with Supabase for data and authentication and uses AI for meal parsing and recommendation logic.

## User Preferences

- I prefer simple language.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.

## Agent Workflow Rules

1. **Task-Start:** `DECISIONS.md` lesen — besonders den `## Decisions`-Abschnitt, um bewusste Nicht-Entscheidungen und laufende Architekturvorgaben zu kennen.
2. **Task-Abschluss:** Direkt **vor** dem Aufruf von `bash scripts/finalize-task.sh TASK_GID` einen neuen Eintrag in die `## Fix Log`-Tabelle in `DECISIONS.md` schreiben (`| Datum | Task-Name | Asana-GID | Beschreibung |`). `finalize-task.sh` prüft das und bricht mit Fehler ab, wenn der Eintrag fehlt.
3. **DECISIONS.md Self-Assessment (vor Task-Abschluss):** Selbst prüfen, ob die Änderungen einen neuen D-XXX-Eintrag im `## Decisions`-Abschnitt erfordern. Checkliste:
   - [ ] Wurde eine **Infrastruktur- oder Plattformwahl** getroffen oder geändert? (z. B. neue Auth-Methode, neuer Cloud-Service, Wechsel einer Kernbibliothek)
   - [ ] Wurde ein **Schema** oder eine **Migration** hinzugefügt, die nicht rückwärtskompatibel ist?
   - [ ] Wurde ein **Sicherheits- oder Compliance-Prinzip** neu eingeführt oder geändert? (z. B. RLS-Policy, Middleware-Schutz, medizinischer Disclaimer)
   - [ ] Wurde eine **explizite Nicht-Entscheidung** getroffen — etwas, das bewusst *nicht* gemacht wird und das spätere Agents kennen müssen?
   - [ ] Wurde eine **E-Mail-, Webhook- oder Cron-Infrastruktur** eingerichtet oder wesentlich verändert?
   - **Wenn ja zu einer Frage:** neuen `### D-XXX · Titel (YYYY-MM-DD)`-Eintrag in `## Decisions` schreiben, mit Begründung und `**Nicht wieder öffnen:**`-Satz. `finalize-task.sh` erinnert dich, falls du Architektur-Grenz-Dateien (z. B. `supabase/`, `middleware.ts`, `lib/emails/`, `next.config.*`) berührt hast.
4. **Lucas per Telegram fragen (optional, vor Task-Abschluss):** Wenn eine offene Richtungsfrage besteht — also etwas, das Lucas als Product-Owner entscheiden muss und das die weitere Implementierung beeinflusst — den Agenten-Messenger nutzen, bevor `finalize-task.sh` aufgerufen wird:
   - **Direkt (nur Frage):** `node scripts/ask-telegram.mjs TASK_GID "Frage?"` → gibt die Antwort auf stdout aus oder `TIMEOUT`/`SKIPPED`.
   - **Mit Optionen:** `node scripts/ask-telegram.mjs TASK_GID "Frage?" "Option A" "Option B"` → nummeriert die Optionen in der Telegram-Nachricht.
   - **Im Finalize-Flow:** `bash scripts/finalize-task.sh TASK_GID --ask "Frage?" "Option A" "Option B"` → fragt Lucas vor dem Commit und setzt dann fort.
   - **Wann fragen?** Nur bei echten Richtungsfragen (z. B. UX-Entscheidungen, Scope-Abgrenzungen, Breaking Changes). Keine technischen Implementierungsdetails — die entscheidet der Agent selbst.
   - **Wenn Secrets fehlen:** Das Script gibt `SKIPPED` aus und bricht nicht ab — der Agent fährt ohne Antwort fort.
   - **Wenn kein Reply innerhalb 10 Minuten:** Das Script gibt `TIMEOUT` aus — der Agent fährt mit einer vernünftigen Default-Entscheidung fort und notiert sie im Fix Log.

## Compliance Backlog (nicht akut — vor MDR-Einreichung abarbeiten)

Glev ist aktuell **kein eingereichtes Medizinprodukt**. Primärzielgruppe: erwachsene T1D auf ICT (Pen). Kinder/Schwangere werden nicht aktiv beworben, aber auch nicht aktiv ausgeschlossen. Pump-Träger sind okay (Engine-Empfehlung für sie nicht relevant — wissen sie selbst). Sobald wir Klasse IIa anstreben, folgendes erledigen:

1. **Quellen-Pflicht in Insights-Texten** — alle Konsensus-Bänder (TIR ≥ 70 %, < 4 % unter 70 mg/dL, CV < 36 %, Level-2-Hypo < 54 mg/dL, ATTD-Konsensus 2019) brauchen geprüfte Quellenangabe direkt am Wert (z. B. Battelino et al., Diabetes Care 2019). Aktuell stehen die Werte in `swipe_ctx_*_body` (klinische Interpretation) und `*_back_p*` (Methodik) in `messages/{de,en}.json` ohne explizite Zitate.
2. **Disclaimer-Footer prominenter** — `page_medical_disclaimer` aktuell klein im Kontext-Footer der Insights-Swipe-Pager (`app/(protected)/insights/page.tsx` ~L3586). Bei MDR-Pflicht: einmal pro Session als Modal beim Insights-Erstaufruf zeigen.
3. **Zielgruppen-Hinweise per Karte** — falls Kinder/Schwangere explizit ausgeschlossen werden müssen, in den jeweiligen Karten (Adaptive Engine, TDD, Patterns) gesonderten Hinweis ergänzen.

**Compliance-Prinzip in allen User-facing Texten (gilt schon jetzt):** keine direkten Dosis-Anweisungen, jede Auffälligkeit wird als Gesprächs-Thema fürs Diabetologen-Team gerahmt, keine Diagnose.

## Deployment & Infrastructure (CRITICAL)

**Production runs on Vercel, NOT on Replit.**

- **Deploy flow:** local `git push origin main` → GitHub `WahNun/glev-app` → Vercel auto-deploys to `https://glev.app`
- **Web changes reach both platforms automatically:** Android (Play Store) and iOS (TestFlight/App Store) are Capacitor webview shells loading `https://glev.app`. A `git push` deploys to both simultaneously — no new `.aab` or `.ipa` needed. New native builds are only required when native files change (`styles.xml`, `AndroidManifest.xml`, Xcode project, etc.). Always plan and test for both platforms.
- **Replit is dev-only:** the workspace here is for coding/preview only. Replit Secrets are NOT read by production. Production env vars live in **Vercel Project Settings → Environment Variables**.
- **After changing any env var in Vercel:** the change only takes effect after a fresh deployment (Vercel caches env vars in serverless functions at build time). Trigger a redeploy via Vercel Dashboard → Deployments → "Redeploy" on the latest build, OR push an empty commit.
- **Two Stripe webhook endpoints (both on Vercel):**
  - `Glev_Production_Pro` → `https://glev.app/api/pro/webhook` → reads `STRIPE_PRO_WEBHOOK_SECRET`
  - `Glev_Production_Beta` → `https://glev.app/api/webhooks/stripe` → reads `STRIPE_BETA_WEBHOOK_SECRET`
- **Email outbox cron:** GitHub Actions workflow `.github/workflows/flush-outbox.yml` runs `*/2 * * * *` and calls `https://glev.app/api/cron/flush-outbox` with `Bearer $CRON_SECRET`. CRON_SECRET must match between GitHub Repo Secrets AND Vercel Environment Variables.
- **Hypo-push Edge Function cron:** Supabase Edge Function `hypo-check` (`supabase/functions/hypo-check/`) runs every 5 minutes via `schedule = "*/5 * * * *"` in `supabase/functions/hypo-check/config.toml`. It queries all users with `push_token IS NOT NULL + low_alarm_enabled = true`, fetches their latest CGM reading, and sends an FCM (Android) or APNs (iOS) push if the value is below their threshold and the 15-minute server-side cooldown (`hypo_push_cooldown` table) has expired. Required Supabase Edge Function Secrets: `FIREBASE_SERVER_KEY`, `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`. Deploy via `supabase functions deploy hypo-check`. Logs: Supabase Dashboard → Edge Functions → hypo-check → Logs.
- **Production logs:** Vercel Dashboard → Project → Logs (real-time) OR Deployments → individual deploy → Functions tab → per-route logs.
- **Production database queries:** prod data lives in Supabase (not the Replit-attached Postgres which is dev-only with stale test rows). Use the Supabase Dashboard SQL Editor for live queries.

## iOS Release Pipeline

Native iOS builds are automated via **fastlane** (`fastlane/Fastfile`) and triggered from GitHub Actions (`.github/workflows/ios-release.yml`) — either by clicking "Run workflow" in the GitHub UI or by pushing a tag like `ios-v1.2.3`.

- **Quick command:** `bundle exec fastlane ios beta` — bumps `CURRENT_PROJECT_VERSION`, runs `npx cap sync ios`, archives, uploads to TestFlight.
- **GitHub Actions:** `.github/workflows/ios-release.yml` — click "Run workflow" or push a tag `ios-v*`. Runs on `macos-14`.
- **Version bumper:** `scripts/bump-ios-version.mjs` edits `ios/App/App.xcodeproj/project.pbxproj`.
- **Auth:** App Store Connect API key (`APP_STORE_CONNECT_API_KEY_ID` + `APP_STORE_CONNECT_API_ISSUER_ID` + `APP_STORE_CONNECT_API_KEY_BASE64`).
- **Code signing:** handled by `fastlane match`. The Distribution certificate and App Store provisioning profile live in a private `glev-certificates` git repo, encrypted with `MATCH_PASSWORD`. On every CI run, match fetches and installs them before the archive step. Required GitHub Actions secrets: `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_PRIVATE_KEY` (SSH only). On a developer Mac **without** `MATCH_GIT_URL` set, the match step is skipped and Xcode automatic signing is used.
- **Full docs:** `fastlane/README.md` → iOS section.

## Android Release Pipeline

Single-command Play Store releases via Fastlane (mirrors the iOS pipeline above).

- **Quick command:** `bundle exec fastlane android beta` — bumps `versionCode`, runs `npx cap sync android`, builds a signed AAB, uploads to Play Store internal track.
- **Promote to production:** `bundle exec fastlane android release` — promotes the current internal-track build (no rebuild).
- **GitHub Actions:** `.github/workflows/android-release.yml` — click "Run workflow" (pick bump strategy + lane) or push a tag `android-v*`. Runs on `ubuntu-latest` with JDK 17 (Temurin).
- **Version bumper:** `scripts/bump-android-version.mjs` edits `android/app/build.gradle` (`versionCode` + `versionName`). Run `node scripts/bump-android-version.mjs show` to inspect current values.
- **Auth:** Google Play service account JSON key stored as `PLAY_STORE_JSON_KEY_DATA` (base64). See `fastlane/README.md` → Android Authentication for setup steps.
- **Signing:** `android/app/build.gradle` `signingConfigs.release` reads `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` from env. CI decodes `ANDROID_KEYSTORE_BASE64` secret to `/tmp/glev-release.keystore` at runtime.
- **Required GitHub secrets:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_GOOGLE_SERVICES_BASE64`, `PLAY_STORE_JSON_KEY_DATA`.
- **Full docs:** `fastlane/README.md` → Android section.

## System Architecture

**Frontend:**
- Developed with Next.js 15 App Router, running on port 5000, featuring a mobile-first, responsive design.
- Theming system in `app/globals.css` supports dark and light modes, maintaining consistent brand accents.
- Navigation includes a sidebar for desktop and bottom navigation for mobile.
- Some pages, like `app/mockups/dark-cockpit/page.tsx`, are intentionally dark for fixed product mockups.
- **Log-screen haptics & shared form components**: `lib/haptics.ts` wraps `@capacitor/haptics` (native iOS/Android) with a `navigator.vibrate` web fallback and SSR-safe loaders, exposing `hapticLight/Medium/Selection/Success/Warning/Error`. Reusable input primitives live in `components/log/`: `SnapSlider` (detented numeric input with selection haptic on each step), `TimeQuickChips` (quick "Now / 5min / 15min" chip row), `CollapsibleField` (folded note row), and `SaveButton` (unified primary CTA with busy state and success haptic). Used across Insulin, Exercise, Cycle, Symptom, and Fingerstick log forms (`components/EngineLogTab.tsx`, `components/CycleSymptomForms.tsx`, `components/FingerstickLogCard.tsx`).

**Backend/API:**
- Supabase manages user authentication (email/password) and PostgreSQL database operations.
- `src/middleware.ts` protects all authenticated routes.
- An Express 5 API server (`artifacts/api-server`) is available for development support.

**Core Logic & Features:**
- **Meal Classification:** Meals are categorized as `FAST_CARBS`, `HIGH_PROTEIN`, `HIGH_FAT`, or `BALANCED` based on macronutrient content.
- **Dose Evaluation:** Insulin doses are evaluated as `GOOD`, `HIGH` (overdose), or `LOW` (underdose) using an Insulin-to-Carbohydrate Ratio (ICR) formula.
- **Glev Engine:** Provides AI-driven insulin recommendations by identifying similar historical meals and assigning a confidence level (HIGH, MEDIUM, LOW). The Engine page features a dynamic layout for chat interaction.
- **Data Seeding:** The dashboard loads realistic T1D meals for new users if their meal entries are empty.
- **Localization:** Uses `next-intl` with `de` (default) and `en` locales, resolving locale preferences from cookies or `Accept-Language` headers.
- **Insulin & Exercise Logging:** New tables (`insulin_logs`, `exercise_logs`) and API routes support logging and retrieving insulin dosages and exercise activities, which the Engine considers for recommendations (safety hooks provide warnings without altering dosage).
- **Native Shells (Capacitor):** iOS and Android apps are thin Capacitor 8.x webview shells loading `https://glev.app`, allowing instant content updates.
- **Push Notifications (Capacitor + FCM):** `@capacitor/push-notifications` is wired in via `lib/pushNotifications.ts` + `components/PushNotificationsProvider.tsx`, mounted once in `app/layout.tsx`. The helpers no-op on web/SSR and only register on native shells. Android requires `android/app/google-services.json` (gitignored — see `android/SIGNING_SETUP.md` §6 for the Firebase setup + smoke-test steps; `android/app/google-services.json.example` documents the expected shape). iOS uses APNs and does not need an extra config file.
- **Meal-Node-Cluster auf der 12h-CGM-Curve:** `components/CurrentDayGlucoseCard.tsx` rendert pro Mahlzeit-mit-Bolus (letzte 12 h) einen draggable Cluster (`components/MealNodeCluster.tsx`) mit Zentrum-Node auf der Glukosekurve, Pre-Knob (Default −15 min, Range −60..−1) und Post-Knob(s) (Default +90 min, Range +1..+180) plus „+"-Button für weitere `post_n`-Arme. Drag → Confirm-Modal → Upsert in `meal_timeline_checks` (`lib/mealTimelineChecks.ts`, Select-then-Update-or-Insert) + lokale OS-Notification mit eigenem Sound (`lib/mealCheckReminders.ts` via `@capacitor/local-notifications`, Web-Fallback `Notification`-API). Unbestätigte Stub-Arme = gestrichelter Outline. Siehe **D-017** für die Hard-Rules (kein Auto-Write, kein Server-Push in dieser Iteration).
- **Operator-Tools (`/admin/*`):** Drei `ADMIN_API_SECRET`-gegateete Tabs, die sich ein gemeinsames `glev_admin_token`-Cookie teilen: `/admin/buyers` (Käufer:innen-Liste), `/admin/drip` (Drip-Mail-Pipeline-Status & manuelle Aktionen) und `/admin/emails` (Live-Preview aller Mail-Templates inkl. Welcome + Drip — rendert direkt aus `lib/emails/*` damit „was du siehst" garantiert „was Resend schickt" ist; Variablen via `?name=` und `?email=` per URL).

**Data Models:**
- `meals` table stores meal details, including `input_text`, `parsed_json`, glucose levels, carbs, insulin, meal type, and evaluation.
- `user_preferences` table stores per-user UI preferences like dashboard and insights card order.

**Asana Sprint Snapshot:**
- `scripts/sync-asana-sprints.mjs` (npm: `pnpm asana:sync`) pulls all "Glev — Sprint X:" projects from Asana and writes `docs/asana/sprints.json` (raw) + `docs/asana/sprints.md` (grouped Markdown with overdue highlight). Default zieht nur offene Tickets; `--include-completed` schaltet den Filter ab. Token via `https://app.asana.com/0/my-apps` → in Replit Secrets als `ASANA_PAT` ablegen (Vercel braucht ihn nicht). Snapshot regelmäßig refreshen, damit der Agent in jeder Session den aktuellen Sprint-Stand sehen kann.

**Marketing Mockups Refresh:**
- `scripts/refresh-mockups.mjs` (Playwright) loggt einen Test-Account ein, klickt das Onboarding weg, erzwingt Dark-Theme via `localStorage.glev_theme=dark` und zieht frische 393×852 @ 2× Screenshots nach `public/mockups/{dashboard,engine,entries,insights}.png` — diese vier werden in der Homepage-Deepdive-Sektion (`app/page.tsx` `FeatureImageRow`) gezeigt. Aufruf: `MOCKUP_USER_EMAIL=… MOCKUP_USER_PASSWORD=… node scripts/refresh-mockups.mjs`. Die Engine-Step-2-Pille ist `<div role="listitem">` ohne Click-Handler, daher zeigen wir bewusst nur Step 1 und nutzen `entries.png` (Mahlzeitenliste mit Makros) für die „Macros"-Reihe.

## External Dependencies

- **Supabase:** PostgreSQL database, authentication, and user preference storage.
- **OpenAI GPT-5:** AI functionalities for meal parsing and other AI features, integrated via Replit AI Integrations.
- **Next.js 15:** Frontend framework.
- **React:** UI library.
- **Vite:** Frontend tooling for design sandbox.
- **Express 5:** API server framework for development.
- **next-intl:** Localization library.
- **Playwright:** End-to-end and unit testing.
- **Capacitor 8.x:** Used for wrapping the web application into native iOS and Android shells.
- **Web Speech API:** Provides voice input functionality.
- **HealthKit (iOS):** Used for background blood glucose synchronization on iOS devices.