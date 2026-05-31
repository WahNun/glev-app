# Glev — CGM-Anbindungen: Technischer Report
Stand: Mai 2026

---

## Überblick

Glev unterstützt vier Wege, Glukosedaten ins System zu bringen. Kein Weg ist per se besser — sie unterscheiden sich in Echtzeit-Nähe, Aufwand und Plattform.

| Quelle | Plattform | Richtung | Takt (tatsächlich) | Trendpfeile |
|---|---|---|---|---|
| LibreLinkUp (LLU) | iOS + Android + Web | Server zieht (poll) | alle 2 min | Ja (von Abbott) |
| Nightscout | iOS + Android + Web | Server zieht (poll) | alle 2 min | Ja (von NS) |
| Apple Health / HealthKit | iOS only | App schiebt (push) | sensorabhängig (1–5 min) | Nein (Glev berechnet) |
| Manuell (Fingerstick) | alle | User-Eingabe | on demand | Nein |

---

## 1. LibreLinkUp (LLU)

### Was ist das?
Die offizielle Abbott-Cloud für Libre 2 und Libre 3. Wer die LibreLink-App nutzt, hat automatisch einen LLU-Account. Glev loggt sich serverseitig als "Beobachter" ein (gleiche API wie die LLU-Web-App).

### Technischer Ablauf
1. User gibt E-Mail + Passwort der LibreLink-App in Glev ein
2. Glev speichert die Credentials verschlüsselt in `cgm_credentials` (Supabase)
3. Server-Cron `/api/cron/cgm-poll` läuft alle 2 Minuten auf Vercel
4. Cron holt von Abbott: den aktuellen "Live"-Wert UND die letzten 12h Graph-Daten
5. Beide werden in `cgm_samples` upserted (kein Duplikat durch `(user_id, recorded_at)` UNIQUE)

### Besonderheit: Live-Wert vs. Graph-Wert
- **Live-Wert** (aus `currentMeasurement`): kommt bei jedem Poll, auch zwischen den 15-Minuten-Messungen. Das ist der Grund, warum Glev "alle 2 Minuten" realistisch ist — Libre 3 misst intern öfter.
- **Graph-Wert** (aus `graphData`): Abbott's 15-Minuten-Verlauf für die letzten 12h. Wird für Insights und Kurven genutzt.

### Tabellen
- `cgm_credentials`: `llu_email`, `llu_password_encrypted`, `llu_region`, Session-Token-Cache
- `cgm_samples`: alle Messwerte (LLU + Nightscout gemeinsam)

### Limitierungen
- Abbott kann die API jederzeit sperren (kein offizielles Developer-Programm)
- Regionale Endpunkte (EU, US, AE, …) — Glev erkennt und leitet automatisch um
- Bei Abbott-Serverausfall: keine Daten, Glev zeigt "Keine CGM-Verbindung"
- Passwort liegt verschlüsselt in Supabase — kein Klartext, aber trotzdem sensitiv

### Sensor-Kompatibilität
- Libre 2 (Gen 1 + Gen 2): ✅
- Libre 3: ✅ (Live-Wert verfügbar)
- Libre 1: ❌ (kein LLU-Support von Abbott)

---

## 2. Nightscout

### Was ist das?
Open-Source DIY-CGM-Server. Unterstützt nahezu alle Sensoren via Bridge-Apps (Dexcom Share, xDrip+, Spike, Juggluco, …). Wird selbst gehostet (Fly.io, Heroku, Railway, eigener VPS).

### Technischer Ablauf
1. User gibt Nightscout-URL + optionalen API-Token in Glev ein
2. Gespeichert in `profiles`: `nightscout_url`, `nightscout_token_enc`
3. Server-Cron `/api/cron/cgm-poll` läuft alle 2 Minuten
4. Glev ruft `{nightscout_url}/api/v1/entries.json?count=1` (aktuell) + `?count=288` (12h) auf
5. Werte landen in `cgm_samples` (gleiche Tabelle wie LLU)

### Sensor-Kompatibilität (via Nightscout)
- Dexcom G5/G6/G7 (via Dexcom Share oder xDrip+): ✅
- Libre 2/3 (via Juggluco oder xDrip+ mit OOP): ✅
- Medtronic (via 600-Series Uploader): ✅
- Eversense (via Eversense CGM-App): ✅
- Eigentlich: alles was Nightscout unterstützt

### Limitierungen
- User muss eigenen Nightscout-Server warten
- Nightscout läuft oft auf Free-Tier (Fly.io, Railway) — kann einschlafen, Kaltstart dauert 30+ s
- Wenn NS offline: Glev holt gar nichts (kein Fallback auf LLU)

### Trendpfeil
Nightscout liefert `direction` (Flat, SingleUp, DoubleUp, etc.) mit jedem Entry. Glev übernimmt diesen Wert direkt.

---

## 3. Apple Health / HealthKit

### Was ist das?
iOS-internes Datenlager für Gesundheitsdaten. Alle CGM-Apps (Dexcom, Libre, xDrip, Spike) können Werte an HealthKit übergeben. Glev liest diese aus und schickt sie an den Server.

### Technischer Ablauf
1. iOS-App fragt HealthKit-Berechtigung für `HKQuantityTypeIdentifierBloodGlucose`
2. `HKObserverQuery` registriert Background-Observer — iOS weckt die App bei neuen Werten
3. `AppDelegate` (Swift / Capacitor Bridge) schickt neue Samples via `POST /api/cgm/apple-health/sync`
4. Server speichert in `apple_health_readings` (eigene Tabelle, kein Mixing mit cgm_samples)
5. `/api/cgm/samples` aggregiert beide Tabellen bei Abfragen

### Trendpfeil
HealthKit liefert **keinen** Trendpfeil. Glev berechnet ihn selbst: zwei aufeinanderfolgende Samples im 5–20-Minuten-Fenster → Delta → Kategorie (steigend/fallend/stabil).

### Tabellen
- `apple_health_readings`: `user_id`, `value_mgdl`, `recorded_at`, `source_uuid` (Dedup)
- `profiles.apple_health_bg_last_delivery`: Timestamp der letzten Background-Lieferung (für Health-Check)

### Besonderheit: Kein Server-Pull möglich
Anders als LLU und Nightscout **kann** der Glev-Server nicht selbst von Apple Health lesen. iOS erlaubt das nur aus der App heraus. Der 2-Minuten-Server-Cron hat hier keinen Effekt — Timing hängt davon ab, wie oft die Quell-App (z.B. Libre 3 App) an HealthKit schreibt.

### Limitierungen
- iOS only — kein Android, kein Web
- App muss mindestens gelegentlich aktiv sein (Background-Tasks werden von iOS gedrosselt)
- Resolution: 1–5 Minuten (sensor- und app-abhängig)
- Wenn die Quell-CGM-App HealthKit nicht befüllt: keine Daten

---

## 4. Manuell (Fingerstick)

### Was ist das?
User tippt einen Glukosewert manuell ein (z.B. aus einem Blutzuckermessgerät).

### Technischer Ablauf
- Eingabe in der App → `lib/fingerstick.ts` → direkt in Supabase (`fingerstick_readings`)
- Kein Cron, kein Polling

### Priorität
Wenn ein Fingerstick-Wert innerhalb von ±5 Minuten neben einem CGM-Wert liegt, **überschreibt der Fingerstick** den CGM-Wert als "aktuellen" Glukosewert. Begründung: Kapillarblut-Messung ist genauer als Gewebezucker.

### Tabellen
- `fingerstick_readings`: `user_id`, `value_mgdl`, `recorded_at`, `note`

---

## Update-Takt: Gesamtbild

```
Vercel Cron (alle 2 min)
  └─ /api/cron/cgm-poll
      ├─ LLU → cgm_samples
      └─ Nightscout → cgm_samples

iOS App (event-driven)
  └─ HealthKit Observer → /api/cgm/apple-health/sync → apple_health_readings

Browser (alle 2 min, solange Tab offen)
  └─ CgmJobsTicker → /api/cgm-jobs/process
      └─ Füllt nachträglich CGM-Werte bei geloggten Mahlzeiten/Insulin nach

GitHub Actions (alle 5 min)
  └─ cgm-jobs-flush.yml → /api/cron/cgm-jobs-flush
      └─ Fällige Hintergrund-Jobs verarbeiten (auch ohne offenen Tab)
```

---

## Quellenauswahl und Priorität

`lib/cgm/index.ts` → `resolveSource(userId)`:

1. Explizite Wahl in `profiles.cgm_source` ("llu" / "nightscout" / "apple_health")
2. Fallback: wenn `nightscout_url` vorhanden → Nightscout
3. Letzter Fallback: LLU

Ein User kann nur **eine** Quelle gleichzeitig aktiv haben. LLU + Nightscout parallel ist technisch möglich aber nicht vorgesehen.

---

## Admin-Sicht (Quell-Erkennung)

Im Admin-Panel (`/admin/users`) wird "CGM Kind" angezeigt:
- Basis: welche Felder in `profiles` oder `cgm_credentials` befüllt sind
- Kein Hardware-Sensor-Typ-Erkennung (Glev weiß nicht ob Libre 2 oder Libre 3)

---

## Dexcom-Hinweis

Es gibt **keine direkte Dexcom-API-Anbindung** in Glev. Dexcom-User nutzen Glev via Nightscout (xDrip+, Dexcom Share Bridge → Nightscout → Glev).

---

*Erstellt: 2026-05-29 | Glev Diagnose-Report*
