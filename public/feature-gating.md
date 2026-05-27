# Glev — Feature-Gating Übersicht
Stand: 2026-05-27

---

## Zugangsstufen

| Stufe | Plan | Preis |
|---|---|---|
| `all` | Alle (Free, Smart, Pro, Plus, Trial) | — |
| `smart` | Ab Glev Smart + Pro + Plus + aktiver Trial | €9/Mo |
| `pro` | Ab Glev Pro + Plus + aktiver Trial | €14,90/Mo |
| `plus` | Nur Glev+ | €29/Mo |

> **Trial-Logik:** Free-User mit aktivem Trial → Pro-Level-Zugang (alle Features bis inkl. `pro`)

**Plan-Mapping:**
- `"free"` = kein Abo (inkl. abgelaufener Trial)
- `"beta"` = Glev Smart (S, €9/Mo)
- `"pro"` = Glev Pro (M, €14,90/Mo)
- `"plus"` = Glev+ (L, €29/Mo)

---

## 🟢 Tier: `all` — Jeder hat Zugang

| Feature-Key | Beschreibung | Im UI gegated? | Datei |
|---|---|---|---|
| `meal_log_voice` | Mahlzeit per Sprache loggen | ❌ kein Gate | — |
| `meal_log_manual` | Mahlzeit manuell loggen | ❌ kein Gate | — |
| `insulin_log` | Insulin loggen | ❌ kein Gate | — |
| `fingerstick_bz` | Fingerstich BZ loggen | ❌ kein Gate | — |
| `activity_log` | Sport/Bewegung loggen | ❌ kein Gate | — |
| `symptoms_log` | Symptome loggen | ❌ kein Gate | — |
| `cycle_tracking` | Zyklus tracken | ❌ kein Gate | — |
| `dashboard_basic` | Dashboard Grundansicht | ❌ kein Gate | — |
| `food_memory` | Mahlzeiten-Gedächtnis / History | ❌ kein Gate | — |
| `history_60d` | 60 Tage Historie | ❌ kein Gate | — |

---

## 🟡 Tier: `smart` — Ab Smart (€9/Mo)

| Feature-Key | Beschreibung | Im UI gegated? | Datei |
|---|---|---|---|
| `cgm_sync` | CGM-Verbindung (LibreLink etc.) | ❌ kein Gate — **bewusst für alle frei** | — |
| `apple_health_sync` | Apple Health Sync | ❌ Tier definiert, **nie verdrahtet** | — |
| `cgm_autofill` | BZ-Autofill aus CGM | ❌ nie verdrahtet | — |
| `hypo_warning` | Hypo-Push-Alarm | ❌ nie verdrahtet | — |

---

## 🔵 Tier: `pro` — Ab Pro (€14,90/Mo)

| Feature-Key | Beschreibung | Im UI gegated? | Datei |
|---|---|---|---|
| `hba1c_gmi` | GMI / Ø-Blutzucker Insights-Karte | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `tir_analysis` | Time-in-Range + Hypo/Hyper-Events | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `trends_variability` | Glukose-Trend + CV% Variabilität | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `meal_type_breakdown` | Mahlzeiten-Typen Insights-Karte | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `meal_bz_rating` | Mahlzeiten-Bewertung Insights-Karte | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `engine_bolus_suggestion` | Engine Step 2 Bolus-Empfehlung | ✅ `<UpgradeGate>` | `app/(protected)/engine/page.tsx` |
| `adaptive_icr` | Adaptiver ICR Insights-Karte | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `bz_pattern_recognition` | Muster-Erkennung Insights-Karte | ✅ `<UpgradeGate>` | `app/(protected)/insights/page.tsx` |
| `control_score` | Control Score | ❌ Tier definiert, **nie verdrahtet** | — |
| `settings_tips` | Einstellungs-Tipps | ❌ nie verdrahtet | — |
| `auto_apply_icr` | ICR automatisch anwenden | ❌ nie verdrahtet | — |
| `icr_by_daytime` | ICR nach Tageszeit | ❌ nie verdrahtet | — |
| `custom_target_range` | Eigener Zielbereich | ❌ nie verdrahtet | — |
| `google_sheets_import` | Google Sheets Import | ❌ nie verdrahtet | — |
| `history_90d` | 90 Tage Historie | ❌ nie verdrahtet | — |
| `founder_direct_line` | Direkter Kontakt zum Founder | ❌ nie verdrahtet | — |

---

## 🟣 Tier: `plus` — Nur Plus (€29/Mo)

| Feature-Key | Beschreibung | Im UI gegated? | Datei |
|---|---|---|---|
| `pdf_report` | PDF-Arztbericht exportieren | ✅ `<UpgradeGate>` | `components/ExportPanel.tsx` |
| `csv_export` | CSV exportieren | ✅ `<UpgradeGate>` | `components/ExportPanel.tsx` |
| `caregiver_view` | Caregiver-Zugang | ❌ nie verdrahtet | — |
| `push_alarm_contacts` | Push-Alarm an Kontakte | ❌ nie verdrahtet | — |
| `doctor_appointment_tracker` | Arzttermin-Tracker | ❌ nie verdrahtet | — |
| `since_last_appointment` | Seit letztem Termin | ❌ nie verdrahtet | — |
| `unlimited_history` | Unbegrenzte Historie | ❌ nie verdrahtet | — |
| `early_feature_access` | Early Access neuer Features | ❌ nie verdrahtet | — |

---

## Zusammenfassung

| Status | Anzahl |
|---|---|
| Aktiv gegated (`<UpgradeGate>` im Code) | **11 Features** |
| Tier definiert, aber nie im UI verdrahtet | **18 Features** |
| Bewusst frei trotz `smart`-Tier (`cgm_sync`) | **1 Feature** |

---

## Technische Details

**Gate-Komponente:** `components/UpgradeGate.tsx`
- Zeigt Kinder-Content unscharf (blur 5px, opacity 0.35, pointer-events: none)
- Absolutes Schloss-Overlay mit Plan-Badge + „Upgraden →"-Button → `/pro`
- Fail-open während Loading (kein Flash für berechtigte User)

**Logik:** `lib/planFeatures.ts` → `canAccess(feature, plan, trialActive)`
- Unbekannte Feature-Keys → `true` (fail-open)
- Trial: `plan === "free" && trialActive` → Pro-Level

**Client-Hook:** `hooks/usePlan.ts`
- Fetcht `GET /api/me/plan`, Modul-Level-Cache
- Gibt `{ plan, trialActive, trialEndsAt, loading, canAccess }` zurück
