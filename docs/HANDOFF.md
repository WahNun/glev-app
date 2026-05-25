# Glev — Vollständige Übergabe-Dokumentation

> **Zweck:** Diese Datei ermöglicht einen reibungslosen Einstieg in den neuen Workflow (Claude mit lokalem Repo-Zugriff) ohne Rückfragen. Sie dokumentiert den aktuellen Build-Stand, alle offenen Tasks, die Repo-Struktur, alle Environment-Variablen und die empfohlene Reihenfolge für den ersten Arbeitstag.
>
> **Stand:** 2026-05-24 — Branch `main` auf `f8f8fef`

---

## 1 · Build-Stand & Git-Log

**Branch:** `main`  
**Letzter Commit:** `f8f8fef` — "Update basal insulin display to show remaining active duration"  
**Letzte Deployment-relevante Commits (30):**

```
f8f8fef  fix(iob): Basal-Ring zeigt verbleibende Wirkdauer (basalFraction statt immer voll)
2a4787e  docs: update HANDOFF.md — Phase 5, missing migration, git log, test:e2e fix
4bf9084  fix(iob): Bolus expanded — Coverage-Balken wie Basal, IOBSparkline entfernt
e962f39  fix(iob): Bolus Wirkdauer expanded — padding/gap identisch mit Basal
dc759f0  feat(voice): Phase 5 — TTS auto-play, FAB tap-to-talk, navigate_to AI tool
a861427  Update transcription model to latest version for improved accuracy
41194c0  Fix infinite loop in glucose chart display
02a63d6  test(e2e): add hold-to-talk mic button guard (Task #714)
157b407  Fix the continuous loading of navigation tabs
4053536  fix(IOBCard): Basal-Ring always full + Bolus Wirkdauer bar in expanded view (Task #712)
a9a08f5  feat(chat): Phase 4 — hold-to-talk voice input via Voxtral STT in GlevAIChatSheet
0e16bc6  Exclude Supabase functions from TypeScript checks
1e4498f  Fix error preventing glucose card from displaying correctly
5d548f8  fix: resolve git merge conflicts and push all Task-Agent work to GitHub
1e45fef  Merge remote-tracking branch 'origin/main'
d9c95ef  fix(ai): habit/pattern questions now immediately look up meal history (Task #688)
5867592  Fix Basal-IOB-Karte: Ausgangsdosis im Ring + Disclaimer-Text (#686)
a348335  Fix merge conflicts in decision documentation
8799df8  fix(#695): Landscape-Modus für den Meal-Node-Cluster
dd7c8ee  feat(#693): Server-seitiger Hypo-Push via Supabase Edge Function
d0be38a  feat(ai-chat): add add_timeline_check as WRITE-tool (Task #691)
670cef1  Fix test to display personal pattern headlines correctly
e4fd613  fix: React infinite loop "Maximum update depth exceeded" on Engine Step 2
5a154ca  feat(#694): Snooze-Button für den lokalen Hypo-Alarm
0d91ca1  feat(#692): auto-fill bg_at_check after fingerstick / CGM entry
5615571  feat(#687): Meal-Nodes auf der CGM-Kurve nur anzeigen wenn Engine aktiv ist
200c347  test(insights): guard hero-card sizing regression on small phones (Task #676)
72f4c04  feat(#677): low-glucose alarm with local notification + settings UI
bee416f  feat(ai-chat): Screen-Kontext für Glev AI Chat – useScreenContext-Hook (Task #679)
a99bddc  fix(insights): cards on adaptive-engine height + combine GMI/Avg-BG into one chip (Task #675)
```

**Deploy-Flow:** `git push origin main` → GitHub `WahNun/glev-app` → Vercel auto-deploys `https://glev.app`  
**Web-Changes** sind sofort auf iOS (TestFlight/App Store) und Android (Play Store) aktiv — beide sind Capacitor-Webview-Shells, kein neuer `.aab`/`.ipa`-Build nötig.

---

## 2 · Glev AI — Alle 5 Phasen (live auf glev.app)

Alle fünf Phasen sind produktiv auf `https://glev.app`. Phase-4-Commit: `a9a08f5`, Phase-5-Commit: `dc759f0`.

### Phase 1 — Consent-Gate + Dummy-Context (`user_settings`)
- Spalte `user_settings.ai_consent` (boolean, DEFAULT false) steuert, ob der FAB das AI-Sheet öffnet oder einen "Coming soon"-Toast zeigt.
- Inzwischen ersetzt durch Phase 2 (Spalte bleibt in der DB, wird nicht mehr gelesen).

### Phase 2 — Mistral-Chat-Provider + persistenter Consent (`profiles`)
- Consent-Quelle: `profiles.ai_consent_at TIMESTAMPTZ` + `profiles.ai_consent_version TEXT`.
- `POST /api/ai/consent` setzt `ai_consent_at = NOW()`, `ai_consent_version = 'v1.0'`.
- Chat-Provider: Mistral (`mistral-small-latest`, `maxTokens: 300`, `temperature: 0.4`) — bewusst getrennt vom OpenAI-Client (Food-Parser).
- Chat-Verlauf nur in `sessionStorage` (max. 10 Nachrichten) — keine Persistenz in Supabase (D-013).
- Consent-Revoke-Toggle in Settings (`DELETE /api/ai/consent`, löscht `sessionStorage`).
- Sicherheits-Gates: 401 ohne Auth, 403 ohne Consent, 429 > 20 req/min/User (Supabase-Tabelle `ai_rate_limit_hits`), 503 ohne `MISTRAL_API_KEY`.

### Phase 3 — Function-Calling READ-Tools + WRITE-Tool
- Tool-Loop: `app/api/ai/chat/route.ts` — max `MAX_TOOL_ROUNDS=2` Iterations, dann Streaming-Response.
- Tool-Definitionen + Executor: `lib/ai/glevTools.ts`.
- **READ-Tools:** `get_glucose_status`, `get_active_iob`, `get_meal_history`, `get_bolus_history`, `get_appointments`.
- **WRITE-Tool:** `add_timeline_check` — legt Vor-/Nachmahlzeit-Checks in `meal_timeline_checks` an, erst nach Confirm-Modal in der UI.
- Alle Tools RLS-scoped auf `auth.uid()` — keine Rohdaten-Weitergabe, nur kompakte Aggregate.
- **User-Memory:** `save_user_observation(key, value)` — Upsert in `ai_user_memory`-Tabelle; beim Chat-Start werden ≤50 Einträge als zweite System-Message injiziert (D-016).
- Pending-Actions für WRITE-Operationen: `ai_pending_actions`-Tabelle, Confirmation via `POST /api/ai/confirm-action`.

### Phase 4 — Hold-to-Talk Voice-Input via Voxtral STT
- Route: `POST /api/transcribe/mistral` — nimmt `audio`-Blob (webm/opus), ruft `mistral.audio.transcriptions.complete({ model: "voxtral-mini" })` auf.
- Client-Hook: `hooks/useVoxtral.ts` — `getUserMedia` + `MediaRecorder`, `pointerdown/up/leave` steuern Aufnahme.
- Mic-Button in `GlevAIChatSheet.tsx` — pulsiert mit `glevBtnGlowFast`-Animation bei Aufnahme.
- Android: `RECORD_AUDIO`-Permission in `AndroidManifest.xml` ergänzt. iOS-Permission war bereits vorhanden.
- Kein `@capacitor/microphone` (Paket existiert nicht) — `getUserMedia` bridged nativ in der WKWebView/WebView.
- Kein neues Secret — `MISTRAL_API_KEY` wird wiederverwendet.

### Phase 5 — Voice-First UX: TTS Auto-Play, FAB-Tap-to-Talk, `navigate_to`-Tool
**Commit:** `dc759f0` — "Add voice features for AI chat and navigation"  
**Status:** Live auf `https://glev.app` seit `dc759f0`.

**Text-to-Speech (TTS):**
- Route: `POST /api/tts/mistral` — nimmt `{ text, voice? }`, ruft Mistral `v1/audio/speech` mit Modell `voxtral-mini-tts-latest` + Stimme `en_paul_neutral` auf, gibt `audio/mpeg` zurück. Auth-Gate: 401 ohne User, 503 ohne `MISTRAL_API_KEY`, max 1000 Zeichen.
- Client-Hook: `hooks/useTTS.ts` — `speak(text)` fetcht die Route, baut Blob-URL, spielt via `Audio`-Element ab. `stop()` + `toggleEnabled()` (persisted in `localStorage.glev_tts_enabled`, Default: ein). `speaking`- und `enabled`-State.
- Chat-Auto-Play: `GlevAIChatSheet.tsx` trackt per Ref, wenn `streaming` von `true` → `false` wechselt, und spielt dann das letzte Assistant-Bubble via `tts.speak()` ab.
- Speaker/Mute-Toggle im Sheet-Header (Accent-Farbe während Wiedergabe). `tts.stop()` beim Sheet-Schließen.

**Globales FAB-Tap-to-Talk:**
- `Layout.tsx`: Short-Tap auf den Glev-FAB ruft `glevAi.openFromButton()` auf und dispatcht 350 ms später das `glev:voice-start`-CustomEvent — aber **nur**, wenn Consent bereits erteilt ist (damit kein Mic-Start beim Erstöffnen des Consent-Modals).
- `GlevAIChatSheet.tsx` hört auf `glev:voice-start` (nur wenn Sheet offen) und ruft `startListening()` des `useVoxtral`-Hooks auf.
- Effekt: Ein einziger Tap auf den FAB öffnet den Chat und startet sofort die Sprachaufnahme.

**`navigate_to`-AI-Tool:**
- Definition in `lib/ai/glevTools.ts` — Parameter: `path` (eine der validen App-Routen).
- Der Tool-Executor gibt `{ navigate: "/path" }` zurück (kein Confirmation-Gate nötig).
- `app/api/ai/chat/route.ts` erkennt das `NavigateEnvelope`-Ergebnis und emittiert einen separaten SSE-Frame `data: {"navigate":"/path"}`.
- `lib/useGlevAI.ts` parst den Frame und ruft `optsRef.current?.onNavigate?.(path)` auf.
- `Layout.tsx` übergibt `onNavigate: (path) => { glevAi.closeSheet(); router.push(path); }` — der Chat schließt sich und die App navigiert nahtlos.

**Architektur-Entscheidung D-022** (in `DECISIONS.md`):
- TTS läuft client-seitig via `Audio`-API — kein Capacitor-Plugin, kein nativer Kanal.
- `navigate_to` hat kein Confirmation-Gate, weil Navigation keine Daten mutiert und reversibel ist (Back-Button).
- TTS ist default-ein, weil der Voice-First-Flow ohne Auto-Play keinen Mehrwert hat; User können per Toggle abschalten.

---

## 3 · Feature-Inventar (alle Features live auf glev.app)

### Engine & Dosierung
| Feature | Dateien |
|---------|---------|
| Meal-Klassifikation (FAST_CARBS / HIGH_FAT / HIGH_PROTEIN / BALANCED) | `lib/meals.ts`, `lib/ai/systemPrompt.ts` |
| Per-Meal-Evaluierung (GOOD / UNDERDOSE / OVERDOSE / SPIKE / SPIKE_STRONG / HYPO_DURING) | `lib/engine/evaluation.ts` |
| Adaptive ICR (personalisierter gewichteter Durchschnitt) | `lib/engine/adaptiveICR.ts` |
| Dose-Empfehlung mit Safety-Gates (BG < 80 → blocked, max 25u) | `lib/engine/recommendation.ts` |
| Pattern-Detection (overdosing / underdosing / spiking / balanced) | `lib/engine/patterns.ts` |
| Meal-Lifecycle (pending → provisional → final) | `lib/engine/lifecycle.ts` |
| Bolus-Pairing (explicit tag + ±30min-Heuristik) | `lib/engine/pairing.ts` |
| Zeitbasierte ICR-Buckets (morning/afternoon/evening + Schedule) | `lib/engine/adaptiveICR.ts`, `lib/icrSchedule.ts` |
| Engine-Konstanten als `export const` mit Doc-Sync-Check | `lib/engine/constants.ts`, `docs/engine-algorithm.md`, `scripts/check-engine-doc-thresholds.mjs` |
| Eager Dose / Dose Chip Gating | `lib/engine/eagerDose.ts`, `lib/engine/doseChipGating.ts` |

### CGM & Glucose
| Feature | Dateien |
|---------|---------|
| HealthKit-CGM-Sync (iOS Apple Health) | `app/api/cgm/apple-health/sync/route.ts`, `lib/cgm/` |
| Nightscout-Integration | `lib/cgm/`, `app/api/cgm/` |
| CGM-Poll-Cron (alle 2 min) | `.github/workflows/cgm-jobs-flush.yml`, `app/api/cgm-jobs/` |
| 12h-CGM-Kurve mit Meal-Node-Cluster | `components/CurrentDayGlucoseCard.tsx`, `components/MealNodeCluster.tsx` |
| Draggable Pre/Post-Knobs auf Kurve | `components/MealNodeCluster.tsx`, `lib/mealTimelineChecks.ts` |
| Low-Glucose-Alarm (lokale Notification + Settings-UI) | `lib/lowGlucoseAlarm.ts`, `app/(protected)/settings/page.tsx` |
| Snooze-Button für Hypo-Alarm | `lib/lowGlucoseAlarm.ts` |
| Auto-fill `bg_at_check` nach Fingerstick/CGM | `lib/mealTimelineChecks.ts`, `lib/fingerstick.ts` |
| Server-seitiger Hypo-Push (Supabase Edge Function) | `supabase/functions/hypo-check/`, `app/api/profile/push-token/route.ts` |

### IOB & Basal
| Feature | Dateien |
|---------|---------|
| IOB-Karte (Basal-Ring + Bolus-Wirkdauer-Balken + kompakt/expandiert) | `components/IOBCard.tsx`, `lib/iob.ts` |
| Basal-Ring zeigt verbleibende Wirkdauer (`basalFraction`, nicht immer voll) | `components/IOBCard.tsx` L332 |
| Bolus expanded: Coverage-Balken statt IOBSparkline (identisch zu Basal) | `components/IOBCard.tsx` |
| `dia_minutes`-Einstellung (User kann DIA konfigurieren) | `lib/userSettings.ts`, `supabase/migrations/20260522_add_dia_minutes.sql` |
| `basal_action_window`-Einstellung | `supabase/migrations/20260523_add_basal_action_window.sql` |
| IOB-History-Chart (12h/24h) | `components/IOBHistoryChart.tsx` |

### Glev AI Chat
| Feature | Dateien |
|---------|---------|
| Consent-Modal + Revoke-Toggle | `components/GlevAIConsentModal.tsx`, `app/api/ai/consent/route.ts` |
| Chat-Sheet mit Streaming | `components/GlevAIChatSheet.tsx`, `app/api/ai/chat/route.ts` |
| Rate-Limit in Supabase | `supabase/migrations/20260523_ai_rate_limit_hits.sql` |
| User-Memory (Key/Value) | `supabase/migrations/20260524_ai_user_memory.sql`, `lib/ai/glevTools.ts` |
| Screen-Kontext-Hook | `lib/scopeHeaderContext.tsx`, hooks in jedem Page-File |
| Function-Calling-Schema | `supabase/migrations/20260523_ai_function_calling_schema.sql` |
| Pending-Actions (WRITE-Confirmation-Gate) | `supabase/migrations/20260524_ai_pending_actions.sql`, `app/api/ai/confirm-action/route.ts` |
| Granulare Consent-Scopes | `supabase/migrations/20260524_ai_consent_scopes.sql` |
| Hold-to-Talk Voxtral STT (Phase 4) | `hooks/useVoxtral.ts`, `app/api/transcribe/mistral/route.ts` |
| TTS Auto-Play / Speaker-Toggle (Phase 5) | `hooks/useTTS.ts`, `app/api/tts/mistral/route.ts` |
| FAB-Tap-to-Talk (Phase 5) | `components/Layout.tsx` (`runFabShortTap`), `components/GlevAIChatSheet.tsx` (`glev:voice-start`-Listener) |
| `navigate_to`-AI-Tool (Phase 5) | `lib/ai/glevTools.ts`, `app/api/ai/chat/route.ts`, `lib/useGlevAI.ts` |

### Daten & Logging
| Feature | Dateien |
|---------|---------|
| Mahlzeit-Log (Voice + Text + Makro-Review) | `app/(protected)/log/page.tsx`, `app/api/parse-food/`, `app/api/meals/` |
| Insulin-Log (Bolus + Basal, mit Bolus-Pairing) | `components/EngineLogTab.tsx`, `app/api/insulin/`, `lib/insulin.ts` |
| Exercise-Log mit Eval | `lib/exerciseEval.ts`, `app/api/exercise/` |
| Fingerstick-Log | `components/FingerstickLogCard.tsx`, `lib/fingerstick.ts` |
| Zyklus- & Symptom-Log | `components/CycleSymptomForms.tsx`, `app/api/symptoms/` |
| Einflussfaktoren-Log | `components/InfluenceLogForm.tsx`, `lib/influences.ts` |
| Appointments (Arzt-Termin-Verwaltung) | `lib/appointments.ts`, `supabase/migrations/20260501_add_appointments.sql` |
| PDF-Export (Arzt-Report) | `lib/pdfReport.tsx`, `components/ExportPanel.tsx` |
| Google-Sheets-Sync | `app/api/sheets/`, `lib/sheets.ts` |
| User-Food-History (Phase B) | `lib/userFoodHistory.ts`, `app/api/food-history/` |
| CGM-Samples-Tabelle (dense) | `supabase/migrations/20260514_add_cgm_samples.sql` |

### Monetarisierung & E-Mail
| Feature | Dateien |
|---------|---------|
| Stripe-Checkout (Beta €19 + Pro €24,90/mo) | `lib/stripeCheckout.ts`, `app/api/checkout/`, `app/api/pro/` |
| Stripe-Webhooks (2 Endpoints) | `app/api/webhooks/stripe/`, `app/api/pro/webhook/` |
| Email-Outbox + Drip-Scheduler | `lib/emails/outbox.ts`, `lib/emails/drip-scheduler.ts` |
| Drip-Mail-Pipeline (Beta Welcome + Onboarding) | `lib/emails/drip-templates.ts`, `lib/emails/drip-status.ts` |
| Email-Cron (GitHub Actions, alle 2 min) | `.github/workflows/flush-outbox.yml`, `app/api/cron/flush-outbox/` |
| Unsubscribe-Token (one-click) | `lib/emails/unsubscribeToken.ts` |
| Admin-Panel `/admin/*` (buyers, drip, emails) | `app/admin/` |

### Native & UX
| Feature | Dateien |
|---------|---------|
| Capacitor 8.x iOS/Android-Shell | `ios/`, `android/`, `capacitor.config.ts` |
| Push-Notifications (Capacitor + FCM/APNs) | `lib/pushNotifications.ts`, `components/PushNotificationsProvider.tsx` |
| Haptics-System (native + Web-Fallback) | `lib/haptics.ts` |
| Log-Screen gemeinsame Komponenten | `components/log/` (SnapSlider, TimeQuickChips, CollapsibleField, SaveButton) |
| Lokalisierung de/en via next-intl | `messages/de.json`, `messages/en.json`, `middleware.ts` |
| Dark/Light-Theme | `app/globals.css`, `components/ThemeProvider.tsx` |
| Dashboard sortierbare Karten | `components/SortableCardGrid.tsx`, `lib/cardOrder.ts` |
| Insights-Cockpit-Swipe-Pager (15 Tabs) | `app/(protected)/insights/page.tsx` |

---

## 4 · Supabase-Migrations-Übersicht (84 Dateien)

Letzter Migrations-Timestamp: `20260525_push_token.sql`

### Auth / Profile-Erweiterungen
| Datei | Inhalt |
|-------|--------|
| `20260425_add_user_settings.sql` | `user_settings`-Tabelle (Basis) |
| `20260427_add_junction_user_id.sql` | Junction-User-ID-Normalisierung |
| `20260427_add_profiles_language.sql` | `profiles.language` |
| `20260428_add_profiles_carb_unit.sql` | `profiles.carb_unit` (g/BE/KE) |
| `20260430_add_user_settings_insulin_params.sql` | ICR, CF, Target-BG-Felder |
| `20260430_add_user_settings_notifications.sql` | Notification-Prefs |
| `20260502_add_profiles_onboarding_completed_at.sql` | Onboarding-Tracking |
| `20260514_drop_profiles_language_default.sql` | Default-Drop für Language |
| `20260516_add_profiles_subscription_status.sql` | `profiles.subscription_status` |
| `20260517_add_profiles_time_format.sql` | 12h/24h-Setting |
| `20260511_add_profile_personal_info.sql` | Name, Geburtstag etc. |

### Meal-Tabellen-Erweiterungen
| Datei | Inhalt |
|-------|--------|
| `20260423_add_meal_macros.sql` | Protein, Fett, Ballaststoffe |
| `20260429_add_meal_glucose_timepoints.sql` | `bg_1h`, `bg_2h` etc. |
| `20260503_add_meal_glucose_samples.sql` | Dense-Kurven-Aggregat-Spalten |
| `20260511_add_pre_meal_trend.sql` | `pre_meal_trend`-Spalte |
| `20260503_clear_meals_evaluation_check_context.sql` | Cleanup CHECK_CONTEXT-Outcomes |
| `20260523_ai_function_calling_schema.sql` | `meal_timeline_checks`-Tabelle + `bolus_taken_at` / `pre_check_at` |

### Insulin / Exercise-Logs
| Datei | Inhalt |
|-------|--------|
| `20260425_add_insulin_logs.sql` | `insulin_logs`-Tabelle |
| `20260425_add_insulin_exercise_logs.sql` | `exercise_logs`-Tabelle |
| `20260425_add_insulin_entries.sql` | Insulin-Entry-Felder in `meals` |
| `20260425_add_insulin_related_entry.sql` | `related_entry_id` für Bolus-Pairing |
| `20260426_add_related_meal_id.sql` | Meal-Referenz in Bolus-Logs |
| `20260430_add_insulin_logs_icr_snapshot.sql` | ICR-Snapshot beim Logging |
| `20260501_add_insulin_icr_snapshot.sql` | Backfill-Migration |
| `20260501_backfill_insulin_logs_icr_snapshot.sql` | Backfill-Exec |
| `20260503_add_bolus_exercise_glucose_samples.sql` | Dense-Sampling für Bolus/Exercise |
| `20260503_add_team_sport_exercise_types.sql` | Neue Sport-Typen |
| `20260512_add_breathwork_and_swimming_exercise_types.sql` | Weitere Sport-Typen |
| `20260515_add_rejected_pairs.sql` | Abgelehnte Bolus-Paarungen |
| `20260518_extend_exercise_logs_apple_health.sql` | Apple-Health-Felder |
| `20260519_add_daily_activity_summary.sql` | Tages-Schritte-Aggregat |
| `20260522_add_bolus_brand2.sql` | Zweiter Bolus-Brand |
| `20260522_add_insulin_brands.sql` | Insulin-Marken-Tabelle |
| `20260425_relax_exercise_type.sql` | CHECK-Relaxierung |

### CGM-Integration
| Datei | Inhalt |
|-------|--------|
| `20260425_add_cgm_fetch_jobs.sql` | CGM-Fetch-Job-Queue |
| `20260426_add_fingerstick_readings.sql` | Fingerstick-Tabelle |
| `20260427_add_nightscout_credentials.sql` | Nightscout-Credentials |
| `20260430_add_apple_health_cgm.sql` | Apple-Health-CGM-Readings |
| `20260501_add_nightscout_readings.sql` | Nightscout-Reading-Cache |
| `20260503_add_symptom_cgm_glucose_at_log.sql` | BG-Wert beim Symptom-Log |
| `20260514_add_cgm_samples.sql` | Dense `cgm_samples`-Tabelle |
| `20260504_add_symptom_cgm_glucose_at_log.sql` | Symptom-BG-Spalte |

### Pro / Stripe
| Datei | Inhalt |
|-------|--------|
| `20260425_add_pro_subscriptions.sql` | `pro_subscriptions`-Tabelle |
| `20260425_add_beta_reservations.sql` | Beta-Reservierungen |
| `20260501_add_pro_subscriptions_stripe_session_id.sql` | Stripe-Session-ID |
| `20260501_add_full_name_to_purchases.sql` | Name in Purchases |
| `20260511_add_currency_country_to_purchases.sql` | Währung + Land |
| `20260511_add_manual_plan_expires_at.sql` | Manuelles Plan-Ablaufdatum |

### E-Mail-Outbox
| Datei | Inhalt |
|-------|--------|
| `20260501_add_email_outbox.sql` | `email_outbox`-Tabelle |
| `20260501_add_email_outbox_dedupe.sql` | Deduplizierungs-Index |
| `20260501_add_email_drip_schedule.sql` | Drip-Schedule-Tabelle |
| `20260501_add_email_drip_unsubscribes.sql` | Unsubscribe-Tabelle |
| `20260503_add_email_drip_schedule_locale.sql` | Locale-Feld im Drip |
| `20260518_email_drip_schedule_tier_plus.sql` | Plus-Tier-Drip |

### AI-Tabellen
| Datei | Inhalt |
|-------|--------|
| `20260522_ai_consent.sql` | `user_settings.ai_consent` (Phase 1, veraltet) |
| `20260523_ai_rate_limit_hits.sql` | Rate-Limit-Tabelle (20/min, D-014) |
| `20260523_ai_function_calling_schema.sql` | `meal_timeline_checks`, `bolus_taken_at`, `pre_check_at` |
| `20260524_ai_user_memory.sql` | `ai_user_memory(user_id, key, value)` |
| `20260524_ai_pending_actions.sql` | WRITE-Tool-Confirmation-Queue |
| `20260524_ai_consent_scopes.sql` | Granulare Consent-Scope-Spalten in `profiles` |

### Alarm / Settings
| Datei | Inhalt |
|-------|--------|
| `20260524_add_low_alarm_threshold.sql` | `user_settings.low_alarm_threshold` (Standard 70 mg/dL) für Low-Glucose-Alarm |

### Push-Notifications
| Datei | Inhalt |
|-------|--------|
| `20260525_hypo_push_cooldown.sql` | `hypo_push_cooldown(user_id, last_sent_at)` |
| `20260525_push_token.sql` | `profiles.push_token`, `push_platform`, `push_token_updated_at` |

### Appointments / IOB / Basal / Sonstiges
| Datei | Inhalt |
|-------|--------|
| `20260501_add_appointments.sql` | `appointments`-Tabelle |
| `20260430_add_user_settings_last_appointment.sql` | Last-Appointment-Spalte |
| `20260501_add_user_settings_last_appointment_note.sql` | Appointment-Note-Spalte |
| `20260520_add_iob_settings.sql` | IOB-Settings (DIA etc.) |
| `20260522_add_dia_minutes.sql` | `dia_minutes` (D-011) |
| `20260523_add_basal_action_window.sql` | `basal_action_window` |
| `20260514_add_icr_schedule.sql` | ICR-Schedule-Tabelle |
| `20260515_split_icr_user_engine.sql` | ICR-Split nach User/Engine |
| `20260517_add_user_food_history.sql` | `user_food_history`-Tabelle |
| `20260517_add_user_settings_target_range.sql` | TIR-Zielbereich-Settings |
| `20260518_add_sleep_sessions.sql` | Schlaf-Sessions |
| `20260520_agent_messages.sql` | Telegram-Agenten-Nachrichten-Bus (D-009) |
| `20260520_replit_queue.sql` | Replit-Queue-Tabelle |
| `20260521_practice_referrals.sql` | Praxis-Referral-Tabelle |
| `20260511_add_influence_logs.sql` | Einflussfaktoren-Tabelle |
| `20260510_add_admin_user_management.sql` | Admin-User-Verwaltung |
| `20260503_add_cycle_symptom_logs.sql` | Zyklus/Symptom-Logs |
| `20260503_add_user_settings_adjustment_history.sql` | Adjustment-History |
| `20260505_add_cycle_logging_enabled.sql` | Zyklus-Logging-Toggle |
| `20260505_add_cycle_phase_and_symptom_category.sql` | Phase + Kategorie |
| `20260517_per_symptom_severity.sql` | Schweregrad pro Symptom |
| `20260520_exercise_logs_source_unique.sql` | Unique-Index Apple-Health |
| `20260520_user_food_history.sql` | Food-History-Update |

---

## 5 · Offene Tasks

Die folgenden Tasks sind im aktuellen Backlog offen. Prioritäten: **P1** = Sicherheit/Blocker, **P2** = User-facing Feature/Bug, **P3** = Test-Coverage/Cleanup, **Backlog** = Nice-to-have.

---

### #106 · Restliches englisches Wort 'Outcome' im Engine-Karten-Rückseiten-Text übersetzen
**Priorität:** P3 (i18n-Cleanup)  
**Was:** Das Wort "Outcome" erscheint noch auf Englisch in den Rückseiten der Engine-Karten (Flip-Cards). Muss ins Deutsche übersetzt werden.  
**Betroffene Dateien:** `messages/de.json`, `messages/en.json`, `app/(protected)/insights/page.tsx` (Engine-Card-Rückseiten), ggf. `components/`  
**Abhängigkeiten:** Keine. Kann jederzeit solo erledigt werden.

---

### #107 · Show a simulated GPT chat exchange in the marketing demo
**Priorität:** Backlog (Marketing)  
**Was:** Die Demo-Phone-Komponente (`components/AppMockupPhone.tsx`) soll einen simulierten AI-Chat zeigen, der wie ein echtes Glev-AI-Gespräch aussieht — um Neu-Usern den Mehrwert zu zeigen.  
**Betroffene Dateien:** `components/AppMockupPhone.tsx`, `app/page.tsx` (Landing Page), ggf. neue `components/landing/`-Datei  
**Abhängigkeiten:** Keine.

---

### #108 · Let users pick which data types go into the export bundle
**Priorität:** P2 (User-facing Feature)  
**Was:** Der PDF/Daten-Export soll konfigurierbar sein — User können wählen, welche Datentypen (Mahlzeiten, Insulin, CGM, Exercise, Symptome etc.) ins Exportpaket kommen.  
**Betroffene Dateien:** `components/ExportPanel.tsx`, `lib/export.ts`, `lib/pdfReport.tsx`, `app/(protected)/settings/page.tsx`  
**Abhängigkeiten:** #113 (Legacy-Column-Drop) sollte vorher stabil sein.

---

### #109 · Translate the empty-state messages on the Insights page
**Priorität:** P3 (i18n)  
**Was:** Leerzustand-Texte auf der Insights-Seite (wenn keine Daten vorhanden) sind noch englisch oder haben Platzhalter.  
**Betroffene Dateien:** `app/(protected)/insights/page.tsx`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #110 · Add an automated test that catches missing translation keys before users see them
**Priorität:** P3 (Test-Coverage)  
**Was:** Ein E2E- oder Unit-Test soll sicherstellen, dass alle i18n-Keys in `de.json` auch in `en.json` vorhanden sind (und umgekehrt). Aktuell gibt es bereits einen GitHub-Actions-Workflow (`translation-key-checks.yml`), aber keinen lokalen Test.  
**Betroffene Dateien:** `tests/unit/` oder `tests/e2e/`, `.github/workflows/translation-key-checks.yml`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #111 · Show the medical disclaimer in English on the insights page
**Priorität:** P3 (i18n / Compliance)  
**Was:** Der medizinische Disclaimer (`page_medical_disclaimer`) auf der Insights-Seite erscheint nur auf Deutsch. Bei aktiviertem `en`-Locale muss er englisch sein.  
**Betroffene Dateien:** `app/(protected)/insights/page.tsx`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #112 · Test the appointment note end-to-end
**Priorität:** P3 (Test-Coverage)  
**Was:** Es gibt noch keinen E2E-Test für das Hinzufügen einer Notiz zu einem Termin. Der Test soll einen Termin anlegen, eine Notiz speichern und verifizieren dass sie nach Reload noch da ist.  
**Betroffene Dateien:** `tests/e2e/`, `app/(protected)/settings/page.tsx` (Appointments-Section), `lib/appointments.ts`  
**Abhängigkeiten:** Keine.

---

### #113 · Drop the legacy single-appointment column once exports are stable
**Priorität:** P2 (Blocker / Tech-Debt)  
**Was:** Die alte Spalte `user_settings.last_appointment` (und `last_appointment_note`) ist durch die `appointments`-Tabelle abgelöst. Sie muss per Migration gedroppt werden — aber erst nachdem bestätigt ist, dass der Export stabil die neue Tabelle nutzt.  
**Betroffene Dateien:** `supabase/migrations/` (neue Drop-Migration), `lib/appointments.ts`, `lib/userSettings.ts`  
**Abhängigkeiten:** Exports (#108) müssen stabil auf `appointments`-Tabelle laufen. Erst dann droppen.  
⚠️ **Möglicherweise bereit:** Prüfen ob Exports bereits vollständig auf `appointments` umgestellt sind.

---

### #114 · Let users add notes and tags to each appointment for richer history
**Priorität:** Backlog  
**Was:** Appointments sollen um Freitext-Notizen und Tags (z. B. "Quartals-HbA1c", "Kardiologie") erweiterbar sein.  
**Betroffene Dateien:** `lib/appointments.ts`, `supabase/migrations/` (neue Migration für `notes` und `tags`-Array), `app/(protected)/settings/page.tsx`  
**Abhängigkeiten:** #113 (Legacy-Drop) empfohlen vorher.

---

### #115 · Cover the older-appointment picker with an end-to-end test
**Priorität:** P3 (Test-Coverage)  
**Was:** Der "ältere Termine"-Picker in den Settings hat keinen E2E-Test. Test soll mehrere Termine anlegen, dann den Picker nutzen und verifizieren dass der richtige Termin ausgewählt wird.  
**Betroffene Dateien:** `tests/e2e/`, `app/(protected)/settings/page.tsx` (Appointments-Section)  
**Abhängigkeiten:** Keine, aber #112 zuerst ist sinnvoll.

---

### #116 · Catch styling regressions on the English version of the demo phone too
**Priorität:** P3 (Test/Regression)  
**Was:** Der Playwright-Snapshot-Test für die Marketing-Demo-Phone-Komponente läuft nur mit dem deutschen Locale. Ein zweiter Testlauf mit `en`-Locale soll sicherstellen, dass keine englischen Texte überlaufen.  
**Betroffene Dateien:** `tests/e2e/` (bestehender Demo-Phone-Test erweitern), `components/AppMockupPhone.tsx`  
**Abhängigkeiten:** Keine.

---

### #117 · Let users log an insulin dose they took earlier today
**Priorität:** P2 (User-facing Feature)  
**Was:** Der Insulin-Log-Tab erlaubt nur "jetzt". User sollen eine Dosis rückdatieren können (z. B. "vor 2 Stunden genommen"). Wichtig für IOB-Berechnung (Backfill).  
**Betroffene Dateien:** `components/EngineLogTab.tsx`, `components/log/TimeQuickChips.tsx`, `app/api/insulin/route.ts`, `lib/insulin.ts`  
**Abhängigkeiten:** Keine.

---

### #118 · Add automated tests for the workout outcome evaluator
**Priorität:** P3 (Test-Coverage)  
**Was:** `lib/exerciseEval.ts` hat noch keine Unit-Tests. Tests sollen alle Outcome-Zweige (intensity-Level, Hypo-Risiko-Flag, Glucose-Delta) abdecken.  
**Betroffene Dateien:** `tests/unit/exerciseEval.test.ts` (neu), `lib/exerciseEval.ts`  
**Abhängigkeiten:** Keine.

---

### #119 · Show personal workout patterns on the Insights page too
**Priorität:** Backlog  
**Was:** Die Insights-Seite zeigt aktuell nur Mahlzeit-/Bolus-Patterns. Eine neue Karte soll Workout-Muster anzeigen (beste Tageszeit, Glukose-Delta nach Sport-Typ etc.).  
**Betroffene Dateien:** `app/(protected)/insights/page.tsx`, `lib/exerciseEval.ts`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** #118 (Evaluator muss getestet sein).

---

### #120 · Translate the Entry Log expanded view so the per-entry copy follows the language picker
**Priorität:** P3 (i18n)  
**Was:** Die aufgeklappte Einzel-Eintragsansicht in der Entries-Liste zeigt einige Texte noch auf Englisch (Makro-Labels, Outcome-Descriptions).  
**Betroffene Dateien:** `app/(protected)/entries/page.tsx`, `components/MealEntryLightExpand.tsx`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #121 · Engine-Toasts und Speicher-Validierungen auch übersetzen
**Priorität:** P3 (i18n)  
**Was:** Toast-Meldungen beim Speichern im Engine-Log-Tab und Validierungsfehlermeldungen erscheinen noch englisch oder sind hardcodiert.  
**Betroffene Dateien:** `components/EngineLogTab.tsx`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #122 · Pro-Bestätigungs-Mails kommen auch nach Server-Crash zuverlässig an
**Priorität:** P1 (Reliability / Revenue)  
**Was:** Wenn der Vercel-Serverless-Kontext abstürzt, bevor die Pro-Welcome-Mail gesendet wird, geht sie verloren. Die Mail muss stattdessen zuerst in die `email_outbox`-Tabelle geschrieben werden, bevor der Stripe-Webhook als Erfolg gilt.  
**Betroffene Dateien:** `app/api/pro/webhook/route.ts`, `app/api/webhooks/stripe/route.ts`, `lib/emails/outbox.ts`, `lib/emails/pro-welcome.ts`  
**Abhängigkeiten:** `email_outbox`-Tabelle existiert bereits (`20260501_add_email_outbox.sql`). Kann sofort implementiert werden.

---

### #123 · Beim Pro-Trial nicht erneut zur Mitgliedschaft schicken wenn schon aktiv
**Priorität:** P1 (UX-Bug / Vertrauen)  
**Was:** User mit aktivem Pro-Trial werden beim erneuten Besuch der `/pro`-Seite trotzdem zum Checkout weitergeleitet, statt einen "Bereits aktiv"-Status zu sehen.  
**Betroffene Dateien:** `app/(protected)/settings/page.tsx` (Pro-Section), `app/api/pro/status/route.ts` o. ä., `lib/proPlan.ts`  
**Abhängigkeiten:** Keine.

---

### #124 · Let users tap the wizard step pills to jump back
**Priorität:** P2 (UX)  
**Was:** Die Wizard-Step-Pillen (Step 1 / 2 / 3) im Engine-Wizard sind visuelle Indikatoren, aber nicht klickbar. User können nicht zu einem früheren Schritt zurückspringen.  
**Betroffene Dateien:** `app/(protected)/engine/page.tsx`, `lib/engineWizardStepContext.tsx`  
**Abhängigkeiten:** Keine.

---

### #125 · Translate the entries page filter labels and chips to German
**Priorität:** P3 (i18n)  
**Was:** Filter-Labels und Chips auf der Einträge-Seite (Zeitraum, Eintragstyp etc.) sind noch nicht vollständig übersetzt oder nutzen hardcodierte englische Werte.  
**Betroffene Dateien:** `app/(protected)/entries/page.tsx`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

### #126 · Add automated tests for the entries filter sheet
**Priorität:** P3 (Test-Coverage)  
**Was:** Der Filter-Sheet auf der Einträge-Seite hat nur manuelle Tests. Ein E2E-Test soll alle Filter-Kombinationen (Typ + Zeitraum) durchspielen und verifizieren, dass die Ergebnisliste korrekt gefiltert wird.  
**Betroffene Dateien:** `tests/e2e/`, `app/(protected)/entries/page.tsx`  
**Abhängigkeiten:** #125 (Übersetzungen sollten erst stimmen).

---

### #127 · Wizard-Step-Context auf URL-Params umstellen
**Priorität:** P2 (Deep-Link / UX)  
**Was:** Der aktuelle Wizard-Schritt ist nur im React-State, nicht in der URL. Tief-Links zu Schritt 2/3 funktionieren nicht. Eine `?step=2`-URL-Param soll den Wizard-Kontext steuern.  
**Betroffene Dateien:** `app/(protected)/engine/page.tsx`, `lib/engineWizardStepContext.tsx`  
**Abhängigkeiten:** #124 (Jump-Back-Pillen) ist ein natürlicher Vorgänger.

---

### #128 · Email-Outbox-Cron in GitHub Actions aktivieren und überwachen
**Priorität:** P1 (Infrastruktur / E-Mail-Delivery)  
**Was:** `.github/workflows/flush-outbox.yml` ist definiert und ruft alle 2 Minuten `POST https://glev.app/api/cron/flush-outbox` auf. Der GitHub-Repo-Secret `CRON_SECRET` muss mit dem Vercel-Env-Var übereinstimmen. Wenn er nicht gesetzt ist oder nicht übereinstimmt, werden keine Drip-Mails gesendet.  
**Betroffene Dateien:** `.github/workflows/flush-outbox.yml`, `app/api/cron/flush-outbox/route.ts`, `lib/emails/outbox.ts`  
**Abhängigkeiten:** Keine. Dies ist ein reiner Ops-Task — `CRON_SECRET` in GitHub Repo Secrets setzen und testen.

---

### #129 · IOB-Karte: Bolus-Wirkdauer-Balken auch für mehrere gleichzeitige Boli
**Priorität:** P2 (Feature-Vollständigkeit)  
**Was:** Der Bolus-Wirkdauer-Balken in der expandierten IOB-Ansicht zeigt nur den letzten Bolus. Bei mehreren aktiven Boli (z. B. Prä-Bolus + Korrektur) soll jeder seinen eigenen Balken bekommen.  
**Betroffene Dateien:** `components/IOBCard.tsx`, `lib/iob.ts`  
**Abhängigkeiten:** Keine.

---

### #130 · Add unit tests for the IOB calculation edge cases
**Priorität:** P3 (Test-Coverage)  
**Was:** `lib/iob.ts` hat Unit-Tests für `getActiveDosesAtTime`, aber noch keine für die Edge-Cases bei `calcTotalIOB` (mehrere überlappende Boli, DIA-Variation, Basal-vs.-Bolus-Trennung).  
**Betroffene Dateien:** `tests/unit/iobCalc.test.ts` (neu oder erweitern), `lib/iob.ts`  
**Abhängigkeiten:** Keine.

---

### #131 · Add E2E test for the hypo alarm settings
**Priorität:** P3 (Test-Coverage)  
**Was:** Der Low-Glucose-Alarm in den Settings hat keinen E2E-Test. Test soll Threshold ändern, Snooze aktivieren und verifizieren, dass die Settings persistiert werden.  
**Betroffene Dateien:** `tests/e2e/`, `app/(protected)/settings/page.tsx`, `lib/lowGlucoseAlarm.ts`  
**Abhängigkeiten:** Keine.

---

### #132 · Add E2E test for the Glev AI consent flow
**Priorität:** P3 (Test-Coverage)  
**Was:** Der komplette Consent-Flow (Modal öffnen → Aktivieren → Toggle in Settings → Revoke) hat noch keinen E2E-Test. Wichtig vor breiterem Rollout.  
**Betroffene Dateien:** `tests/e2e/`, `components/GlevAIConsentModal.tsx`, `app/(protected)/settings/page.tsx`  
**Abhängigkeiten:** Keine.

---

### #134 · Theme toggle soll Wahl dauerhaft speichern
**Priorität:** Backlog  
**Was:** Der Dark/Light-Theme-Toggle speichert die Wahl in `localStorage`. Bei eingeloggten Usern soll die Wahl auch in `user_preferences` gespeichert werden, damit sie geräteübergreifend synchron ist.  
**Betroffene Dateien:** `components/ThemeProvider.tsx`, `lib/theme.ts`, `app/api/preferences/route.ts`  
**Abhängigkeiten:** Keine.

---

### #135 · Meal-Node-Cluster: Bestätigte Checks in der CGM-Kurve einfärben
**Priorität:** P2 (UX)  
**Was:** Bestätigte Vor-/Nachmahlzeit-Checks (`confirmed_at IS NOT NULL`) sollen in der CGM-Kurve visuell anders dargestellt werden als unbestätigte Stubs (aktuell: gestrichelter Outline).  
**Betroffene Dateien:** `components/MealNodeCluster.tsx`, `components/CurrentDayGlucoseCard.tsx`, `lib/mealTimelineChecks.ts`  
**Abhängigkeiten:** Keine.

---

### #136 · Language-Persistence: Locale-Wahl in `profiles` statt nur Cookie speichern
**Priorität:** P2 (i18n-Vollständigkeit)  
**Was:** Die Locale-Wahl wird aktuell nur in einem Cookie gespeichert (`NEXT_LOCALE`). Bei App-Neustart auf einem neuen Gerät oder nach Cookie-Löschung fällt der User auf Deutsch zurück. Die Wahl soll auch in `profiles.language` persistiert werden.  
**Betroffene Dateien:** `components/LocaleSwitcher.tsx`, `middleware.ts`, `app/api/profile/route.ts`, `lib/locale.ts`  
**Abhängigkeiten:** Migration `20260427_add_profiles_language.sql` existiert bereits.

---

### #137 · AI-Chat: Conversation-Starters auf der Start-Seite
**Priorität:** P2 (UX / Onboarding)  
**Was:** Wenn der AI-Chat zum ersten Mal geöffnet wird, soll eine Liste von Conversation-Starter-Buttons angezeigt werden (z. B. "Wie war mein TIR heute?", "Was hat meine letzte Mahlzeit bewirkt?").  
**Betroffene Dateien:** `components/GlevAIChatSheet.tsx`, `messages/de.json`, `messages/en.json`  
**Abhängigkeiten:** Keine.

---

## 6 · Prioritäts- und Abhängigkeits-Analyse

### P1 — Sofort (Sicherheit / Revenue / Infrastruktur)

| # | Task | Warum P1 |
|---|------|----------|
| **#128** | Email-Outbox-Cron in GitHub Actions aktivieren | Ohne `CRON_SECRET`-Match kommen keine Drip-Mails an — stiller Failure |
| **#122** | Pro-Mails zuverlässig nach Server-Crash | Pro-Käufer:innen bekommen keine Bestätigung — Vertrauensverlust |
| **#123** | Trial-Redirect-Guard | User mit aktivem Pro-Abo werden erneut zum Checkout geschickt |

### P2 — Bald (User-facing / Blocker)

| # | Task | Notiz |
|---|------|-------|
| **#113** | Legacy-Column-Drop | Blockiert saubere Exports; erst nach Export-Verifikation |
| **#136** | Language-Persistence in `profiles` | Blockiert i18n-Vollständigkeit auf allen Geräten |
| **#124** | Wizard-Step-Pillen klickbar | UX-Friction im Engine-Wizard |
| **#117** | Insulin rückdatieren | Wichtig für korrekte IOB-Berechnung |
| **#108** | Export-Datentypen wählbar | Abhängt von #113 |
| **#137** | AI Conversation-Starters | Onboarding-UX für AI-Chat |

### P3 — Test-Coverage (batch bearbeitbar)

| # | Task |
|---|------|
| **#110** | i18n-Key-Vollständigkeits-Test |
| **#112** | E2E: Appointment-Note |
| **#115** | E2E: Appointment-Picker |
| **#116** | Regression: Demo-Phone English |
| **#118** | Unit: Workout-Evaluator |
| **#126** | E2E: Entries-Filter |
| **#130** | Unit: IOB-Edge-Cases |
| **#131** | E2E: Hypo-Alarm-Settings |
| **#132** | E2E: AI-Consent-Flow |

### Backlog (Nice-to-have)

| # | Task |
|---|------|
| **#107** | Marketing-Demo simulierter Chat |
| **#114** | Appointment-Notes und Tags |
| **#119** | Workout-Insights-Karte |
| **#134** | Theme-Toggle geräteübergreifend |

### i18n-Debt (seriell abarbeitbar)

`#106 → #109 → #111 → #120 → #121 → #125` — alle ohne gegenseitige Abhängigkeiten, alle nur `messages/`-Dateien + Page-Files.

---

## 7 · Repo-Struktur

```
glev-app/
├── app/
│   ├── (protected)/           # Alle Auth-geschützten Seiten
│   │   ├── dashboard/         # Dashboard mit Glucose-Karte + IOB + Karten-Grid
│   │   ├── engine/            # Engine-Wizard (Step 1/2/3) + AI-Chat
│   │   ├── entries/           # Eintrags-Liste + Einzelkarten-Navigation
│   │   ├── history/           # Historische Auswertungen
│   │   ├── import/            # Import-Panel (CSV etc.)
│   │   ├── insights/          # Cockpit-Swipe-Pager (15 Tabs)
│   │   ├── log/               # Log-Screen (Mahlzeit-Erfassung)
│   │   └── settings/          # Einstellungen + Appointments + Pro
│   ├── admin/                 # Operator-Tools (buyers, drip, emails)
│   ├── api/
│   │   ├── ai/                # consent, chat, confirm-action
│   │   ├── cgm/               # apple-health/sync, latest, history
│   │   ├── cgm-jobs/          # Job-Queue für CGM-Polling
│   │   ├── chat-macros/       # Makro-Analyse für AI-Kontext
│   │   ├── checkout/          # Stripe-Checkout-Session
│   │   ├── cron/              # flush-outbox (Email-Cron)
│   │   ├── exercise/          # Exercise-Log CRUD
│   │   ├── food-history/      # User-Food-History
│   │   ├── health/            # Apple-Health-Sync-Status
│   │   ├── icr-schedule/      # Zeitbasierte ICR-Schedule
│   │   ├── import/            # Daten-Import
│   │   ├── insulin/           # Insulin-Log CRUD
│   │   ├── log/               # Mahlzeit-Log-API
│   │   ├── meals/             # Mahlzeit-CRUD + Evaluation
│   │   ├── me/                # User-Profil-Info
│   │   ├── menstrual/         # Zyklus-Daten
│   │   ├── onboarding/        # Onboarding-Status
│   │   ├── parse-food/        # OpenAI-Mahlzeit-Parser
│   │   ├── preferences/       # UI-Preferences (Karten-Reihenfolge)
│   │   ├── pro/               # Pro-Status + Webhook
│   │   ├── profile/           # Profil-Update + push-token
│   │   ├── sheets/            # Google-Sheets-Sync
│   │   ├── symptoms/          # Symptom-Log CRUD
│   │   ├── telegram/          # Telegram-Webhook-Receiver
│   │   ├── transcribe/        # Voxtral-STT-Endpoint (Phase 4)
│   │   ├── tts/               # Mistral-TTS-Endpoint → audio/mpeg (Phase 5)
│   │   └── webhooks/          # Stripe-Beta-Webhook
│   ├── (marketing)/           # Landing, Beta, Pro, Legal-Seiten
│   └── layout.tsx             # Root-Layout (PushNotificationsProvider etc.)
│
├── components/                # Alle UI-Komponenten
│   ├── log/                   # SnapSlider, TimeQuickChips, CollapsibleField, SaveButton
│   ├── landing/               # Landing-Page-Sektionen
│   └── *.tsx                  # Einzelne Komponenten (GlevAIChatSheet, IOBCard etc.)
│
├── lib/
│   ├── engine/                # Kern-Algorithmus
│   │   ├── evaluation.ts      # GOOD/UNDERDOSE/OVERDOSE/SPIKE/HYPO_DURING
│   │   ├── recommendation.ts  # Dose-Formel, Safety-Gates
│   │   ├── adaptiveICR.ts     # Gewichteter Durchschnitt aus History
│   │   ├── lifecycle.ts       # pending → provisional → final
│   │   ├── patterns.ts        # 30-Tage-Pattern-Summary
│   │   ├── pairing.ts         # Bolus↔Meal-Matching
│   │   ├── constants.ts       # Exportierte Schwellenwerte
│   │   ├── activeDose.ts      # Aktive-Dosis-Abfrage
│   │   ├── chipState.ts       # Dose-Chip-State
│   │   ├── doseChipGating.ts  # Chip-Visibility-Gates
│   │   ├── eagerDose.ts       # Eager-Dose-Berechnung
│   │   ├── adjustment.ts      # AdjustmentMessage-Typ
│   │   └── trend.ts           # CGM-Trend-Berechnung
│   ├── ai/
│   │   ├── glevTools.ts       # Tool-Definitionen + Executors (READ + WRITE)
│   │   ├── glevChatPrompt.ts  # Mistral-Chat-System-Prompt
│   │   ├── systemPrompt.ts    # OpenAI-Food-Parser-Prompt
│   │   ├── mistralClient.ts   # Mistral-Client-Singleton
│   │   └── openaiClient.ts    # OpenAI-Client-Singleton
│   ├── emails/
│   │   ├── outbox.ts          # Email-Outbox-Write + Flush
│   │   ├── drip-scheduler.ts  # Drip-Schedule-Logik
│   │   ├── drip-templates.ts  # Template-Texte
│   │   ├── drip-status.ts     # Status-Abfrage
│   │   ├── drip-stats.ts      # Statistik
│   │   ├── pro-welcome.ts     # Pro-Welcome-Mail
│   │   ├── beta-welcome.ts    # Beta-Welcome-Mail
│   │   ├── plus-welcome.ts    # Plus-Welcome-Mail
│   │   ├── beta-free-year-welcome.ts
│   │   ├── password-reset.ts
│   │   └── unsubscribeToken.ts
│   ├── cgm/                   # CGM-Fetch, History, Normalisierung
│   ├── nutrition/             # Makro-Berechnungen
│   ├── utils/                 # Kleine Hilfs-Funktionen
│   └── *.ts                   # Alle weiteren Module (iob.ts, haptics.ts, etc.)
│
├── hooks/
│   ├── useVoxtral.ts          # Spracheingabe via MediaRecorder + Voxtral-STT (Phase 4)
│   ├── useTTS.ts              # Text-to-Speech via Mistral TTS + Audio-API (Phase 5)
│   └── *.ts                   # Weitere React-Hooks
│
├── supabase/
│   ├── migrations/            # 84 SQL-Dateien (siehe Abschnitt 4)
│   └── functions/
│       └── hypo-check/        # Edge Function: Server-seitiger Hypo-Push (alle 5 min)
│           ├── index.ts       # Deno-Runtime: Query → CGM-Check → FCM/APNs-Push
│           └── config.toml    # schedule = "*/5 * * * *"
│
├── scripts/
│   ├── apply-migration.mjs        # DB-Migration (--all, --baseline)
│   ├── check-engine-doc-thresholds.mjs  # Threshold-Index-Sync-Check
│   ├── check-schema-drift.mjs     # Schema-Drift-Detection
│   ├── sync-asana-sprints.mjs     # Asana-Sprint-Snapshot
│   ├── ask-telegram.mjs           # Telegram-Frage mit Warte-Timeout
│   ├── notify-telegram.mjs        # Telegram-Einweg-Nachricht
│   ├── finalize-task.sh           # Task-Abschluss (DECISIONS.md-Check + Telegram)
│   ├── refresh-mockups.mjs        # Marketing-Mockup-Screenshots
│   ├── bump-ios-version.mjs       # iOS-Versionsnummer
│   ├── bump-android-version.mjs   # Android-Versionsnummer
│   └── setup-branch-protection.mjs  # GitHub-Branch-Protection
│
├── .github/workflows/
│   ├── flush-outbox.yml          # Email-Cron (alle 2 min) → /api/cron/flush-outbox
│   ├── apply-migration.yml       # Auto-DB-Migration nach Push auf main (D-012)
│   ├── playwright-chromium.yml   # E2E-Tests auf Chromium
│   ├── android-chrome-slider.yml # Android-spezifischer Slider-Test
│   ├── android-release.yml       # Android-AAB-Release-Pipeline
│   ├── ios-release.yml           # iOS-IPA-Release-Pipeline
│   ├── cgm-jobs-flush.yml        # CGM-Job-Queue-Flush
│   ├── engine-doc-check.yml      # Threshold-Doc-Sync-Check in CI
│   ├── process-queue.yml         # Asana-Queue-Processor
│   └── translation-key-checks.yml  # i18n-Key-Vollständigkeit in CI
│
├── tests/
│   ├── unit/                  # Pure-Function-Tests (Playwright-Runner)
│   └── e2e/                   # Browser-E2E-Tests
│
├── messages/
│   ├── de.json                # Deutsche Texte (Standard-Locale)
│   └── en.json                # Englische Texte
│
├── docs/
│   ├── engine-algorithm.md    # Vollständige Algorithmus-Dokumentation mit Threshold-Index
│   ├── asana/
│   │   ├── sprints.md         # Asana-Sprint-Snapshot (refresh: pnpm asana:sync)
│   │   └── sprints.json       # Raw-JSON
│   └── HANDOFF.md             # Diese Datei
│
├── DECISIONS.md               # Architektur-Entscheidungen D-001 bis D-021+ + Fix-Log
├── middleware.ts              # Auth-Guard für alle (protected)-Routen + Locale-Routing
├── capacitor.config.ts        # Capacitor-Konfiguration
├── next.config.ts             # Next.js-Konfiguration
├── .env.example               # Alle Environment-Variable-Keys (ohne Werte)
└── package.json               # npm-Scripts
```

---

## 8 · Environment Variables

Alle Werte ohne Ausnahme über **Vercel Project Settings → Environment Variables** setzen. Replit Secrets sind dev-only.

### Supabase
| Variable | Beschreibung |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase-Projekt-URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon-Key für Client-Requests |
| `SUPABASE_URL` | Gleicher Wert wie PUBLIC-Version (server-only) |
| `SUPABASE_ANON_KEY` | Gleicher Wert wie PUBLIC-Version (JWT-Verifikation) |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — niemals im Client exponieren |
| `ENCRYPTION_KEY` | 64-Hex-Char (AES-256-GCM) für Passwort-Verschlüsselung. Generieren: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token für `db:migrate` (Supabase Dashboard → Account → Tokens) |

### OpenAI / Mistral / AI
| Variable | Beschreibung |
|----------|-------------|
| `OPENAI_API_KEY` | Food-Parser-Pipeline (GPT-5) |
| `MISTRAL_API_KEY` | Glev-AI-Chat (Phase 2–4) + Voxtral-STT (Phase 4) |

### Stripe
| Variable | Beschreibung |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Server-seitiger Stripe-Client |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-seitig für Checkout |
| `STRIPE_BETA_PRICE_ID` | €19 Beta-Reservierung |
| `STRIPE_WEBHOOK_SECRET` | Webhook-Secret für `/api/webhooks/stripe` (Beta) |
| `STRIPE_BETA_WEBHOOK_SECRET` | Zweites Secret für Beta-Webhook (gleicher Endpoint) |
| `STRIPE_PRO_PRICE_ID` | €24,90/mo Pro-Subscription |
| `STRIPE_PRO_WEBHOOK_SECRET` | Webhook-Secret für `/api/pro/webhook` |

### Cron / E-Mail
| Variable | Beschreibung |
|----------|-------------|
| `CRON_SECRET` | Bearer-Token für `/api/cron/flush-outbox`. Muss in Vercel UND GitHub Repo Secrets identisch sein (≥16 Zeichen) |
| `EMAIL_UNSUBSCRIBE_SECRET` | HMAC-Secret für One-Click-Unsubscribe-Links (≥16 Zeichen). Fällt auf `CRON_SECRET` zurück wenn nicht gesetzt |
| `SESSION_SECRET` | Session-Signing-Key |

### Site-Origin
| Variable | Beschreibung |
|----------|-------------|
| `NEXT_PUBLIC_SITE_ORIGIN` | `https://glev.app` (kein Trailing Slash). In Dev leer lassen |

### Asana
| Variable | Beschreibung |
|----------|-------------|
| `ASANA_PAT` | Personal Access Token von asana.com → Apps → PATs (nur dev/Replit, nicht Vercel) |
| `ASANA_WEBHOOK_SECRET` | 32-Byte-Hex für Webhook-Registrierung |
| `ASANA_REPLIT_QUEUE_SECTION_IDS` | Komma-separierte GIDs der "Replit Queue"-Sections |

### Telegram (Agent-Kommunikation)
| Variable | Beschreibung |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot-Token von @BotFather |
| `TELEGRAM_CHAT_ID` | Chat-ID von Lucas' Telegram-Account |

### Admin
| Variable | Beschreibung |
|----------|-------------|
| `ADMIN_API_SECRET` | Bearer-Token für `/admin/*`-Routes |

### Supabase Edge Function Secrets (für Hypo-Push)
Diese Secrets werden im **Supabase Dashboard → Edge Functions → Secrets** gesetzt, nicht in Vercel:

| Variable | Beschreibung |
|----------|-------------|
| `FIREBASE_SERVER_KEY` | FCM-Server-Key für Android-Push-Notifications |
| `APNS_KEY_P8` | APNs-Privat-Key (PEM-Inhalt, nicht Pfad) |
| `APNS_KEY_ID` | APNs-Key-ID (10 Zeichen) |
| `APNS_TEAM_ID` | Apple-Developer-Team-ID (10 Zeichen) |
| `APNS_BUNDLE_ID` | Bundle-ID der iOS-App (z. B. `app.glev`) |

---

## 9 · npm-Scripts

Alle Befehle werden mit `pnpm <script>` ausgeführt (kein `npm run`).

### Entwicklung
| Script | Befehl | Beschreibung |
|--------|--------|-------------|
| `dev` | `next dev -p 5000` | Dev-Server auf Port 5000 starten |
| `build` | `next build` | Produktion-Build (ruft `prebuild` vorher auf) |
| `start` | `next start -p 5000` | Produktions-Server lokal starten |

### Datenbank
| Script | Befehl | Beschreibung |
|--------|--------|-------------|
| `db:migrate` | `node scripts/apply-migration.mjs` | Neueste ausstehende Migration anwenden |
| `db:migrate:all` | `…--all` | Alle ausstehenden Migrationen anwenden |
| `db:migrate:baseline` | `…--baseline` | Tracking-Tabelle anlegen + alle vorhandenen Migrations als "applied" markieren (einmalig für bestehende DBs) |
| `db:check-schema` | `node scripts/check-schema-drift.mjs` | Schema-Drift zwischen Code und DB prüfen |

### Tests
| Script | Befehl | Beschreibung |
|--------|--------|-------------|
| `test` | `playwright test` | Alle Tests (Unit + E2E) |
| `test:unit` | `playwright test tests/unit` | Nur Unit-Tests |
| `test:e2e` | `playwright test` | Alle Tests (identischer Aufruf wie `test` — kein separater E2E-only-Filter; beide führen die vollständige Playwright-Suite aus) |

### Engine-Doc-Sync
| Script | Befehl | Beschreibung |
|--------|--------|-------------|
| `check:engine-doc` | `node scripts/check-engine-doc-thresholds.mjs` | Vergleicht `docs/engine-algorithm.md` Threshold-Tabelle mit TypeScript-Quellen. Exit 1 bei Abweichung. Läuft als `prebuild`. |

### Asana / Telegram
| Script | Befehl | Beschreibung |
|--------|--------|-------------|
| `asana:sync` | `node scripts/sync-asana-sprints.mjs` | Sprint-Snapshot nach `docs/asana/` schreiben |
| `telegram:notify` | `node scripts/notify-telegram.mjs` | Einweg-Nachricht an Telegram |
| `telegram:ask` | `node scripts/ask-telegram.mjs TASK_GID "Frage?"` | Frage stellen + auf Antwort warten (10 min Timeout) |

### iOS
| Script | Beschreibung |
|--------|-------------|
| `ios:version` | Aktuelle iOS-Versionsnummer anzeigen |
| `ios:bump:build` | Build-Nummer inkrementieren |
| `ios:bump:patch` | Patch-Version inkrementieren |
| `ios:release:beta` | TestFlight-Beta-Build via Fastlane |
| `ios:release:store` | App-Store-Release via Fastlane |

### Android
| Script | Beschreibung |
|--------|-------------|
| `android:sync` | Capacitor-Android-Sync |
| `android:open` | Android Studio öffnen |
| `android:build:debug` | Debug-APK bauen |
| `android:version` | Versionsnummer anzeigen |
| `android:bump:build` | Build-Nummer inkrementieren |

### GitHub
| Script | Beschreibung |
|--------|-------------|
| `gh:setup-branch-protection` | Branch-Protection-Regeln für `WahNun/glev-app@main` konfigurieren |

---

## 10 · Nächste Schritte — Empfohlene Reihenfolge

### Tag 1: Setup & Infrastruktur

1. **Env-Vars in der neuen Umgebung setzen**
   - Alle Vercel-Env-Vars aus Vercel Project Settings → Environment Variables kopieren
   - `MISTRAL_API_KEY` aus Mistral-Console
   - Supabase-Keys aus Supabase-Projekt-Dashboard
   - Stripe-Keys aus Stripe-Dashboard
   - `CRON_SECRET` — muss mit GitHub Repo Secret `CRON_SECRET` übereinstimmen

2. **Build verifizieren**
   ```bash
   pnpm install
   pnpm run check:engine-doc   # Threshold-Sync prüfen
   pnpm run typecheck          # Falls vorhanden
   pnpm run test:unit          # Unit-Tests ohne Server
   ```

3. **GitHub Actions prüfen**
   - Sicherstellen dass `CRON_SECRET` in GitHub Repo Secrets gesetzt ist und mit Vercel übereinstimmt
   - `flush-outbox.yml` manuell triggern und Log prüfen
   - `apply-migration.yml` läuft nach Push automatisch

### Tag 2–3: P1-Tasks

4. **#128 — Email-Outbox-Cron aktivieren**
   - GitHub Repo Secret `CRON_SECRET` setzen (falls noch nicht)
   - `.github/workflows/flush-outbox.yml` Workflow manuell dispatchen, Log verifizieren
   - Einen Test-User durch Drip-Sequenz schicken und Mail-Empfang bestätigen

5. **#122 — Pro-Mails Outbox-resilient**
   - `app/api/pro/webhook/route.ts`: Pro-Welcome-Mail über `outbox.ts` statt direktem Resend-Call
   - `app/api/webhooks/stripe/route.ts`: Beta-Welcome-Mail analog

6. **#123 — Trial-Redirect-Guard**
   - `lib/proPlan.ts` + Settings-Seite: `subscription_status`-Check vor Checkout-Redirect
   - User mit `subscription_status = 'pro_trial'` oder `'pro'` sehen "Bereits aktiv"-Status

### Woche 2: i18n-Debt (seriell)

7. **i18n-Tasks in Reihenfolge:** `#106 → #109 → #111 → #120 → #121 → #125 → #136`
   - Alle betreffen nur `messages/de.json`, `messages/en.json` und Page-Files
   - Nach jedem Task: `pnpm test:unit` laufen lassen (Translation-Key-Checks)

### Woche 2–3: Test-Coverage-Batch

8. **Test-Coverage-Tasks batchen:** `#110 → #112 → #115 → #118 → #126 → #130 → #131 → #132`
   - Alle unabhängig, gut für parallele Bearbeitung
   - Template: bestehende Tests in `tests/unit/` und `tests/e2e/` als Vorlage nehmen

### Danach: P2-Features

9. **#113** — Legacy-Column-Drop (nach Export-Verifikation)
10. **#124** — Wizard-Step-Pillen klickbar
11. **#117** — Insulin rückdatieren
12. **#137** — AI Conversation-Starters

---

## 11 · Architektur-Entscheidungen Zusammenfassung

Vollständige Begründungen in `DECISIONS.md`. Highlights:

| Entscheidung | Kern-Aussage |
|-------------|-------------|
| **D-001** Supabase | PostgreSQL + Auth + RLS = eine Plattform. Kein Firebase. |
| **D-002** Capacitor | Gleiche Next.js-Codebasis auf Web + iOS + Android. Kein React Native. |
| **D-003** Keine Dosis-Anweisungen | Safety-Invariante: Engine empfiehlt, entscheidet nicht. Gilt auch für AI-Chat. |
| **D-005** Pump-User ausgeschlossen | Engine nur für ICT (Pen). Pump-Träger sehen keinen Dosage-Output. |
| **D-006** Vercel = Produktion | Replit nur Dev. Kein Replit-Deploy. Secrets nur in Vercel. |
| **D-007** Gewichteter k-NN, kein LLM für Dosierung | Deterministisch, auditierbar, personalisiert. LLM parst nur, empfiehlt nie. |
| **D-008** Engine-Konstanten als `export const` | Maschinenlesbare Threshold-Tabelle + CI-Check verhindern stille Drift. |
| **D-009** Telegram-Agenten-Bus | Replit-Agent kann Lucas fragen und auf Antworten warten ohne Replit öffnen zu müssen. |
| **D-011** `dia_minutes` nullable | NULL = User hat nicht gesetzt, Code fällt auf insulintyp-abhängigen Default zurück. |
| **D-012** Auto-DB-Migration via GitHub Actions | Nach jedem Push auf `main` automatisch; idempotent via `schema_migrations`-Tabelle. |
| **D-013** Mistral als Chat-Provider, kein Chat-Persistenz | Kein medizinischer Aufzeichnungs-Footprint. Session-only im `sessionStorage`. |
| **D-014** Rate-Limit in Supabase | In-memory-Map war nicht Vercel-instance-übergreifend konsistent. |
| **D-015** Consent-Revoke-Toggle | DSGVO Art. 7 Abs. 3: Widerruf muss so einfach sein wie Zustimmung. |
| **D-016** Function-Calling READ-Tools | RLS-scoped, kompakte Aggregate, max 2 Tool-Rounds. Keine Raw-Zeitreihen-Weitergabe. |
| **D-016** User-Memory | Key/Value-Upsert, vollständig in Prompt injiziert (≤50 Einträge ≲28 KB). Kein Embedding-Retrieval. |

---

*Generiert: 2026-05-25 — Für Updates: relevante Abschnitte manuell pflegen oder `pnpm asana:sync` für Sprint-Snapshot aufrufen.*
