# Fix Report — Apple Health V2 — Trend-Pfeil, Live Settings Card, mmol/L, Permission Handling

Asana GID: HIER_EINSETZEN
Datum: 2026-05-20

## Was wurde gemacht

Vier Features für die Apple-Health-Integration implementiert. (1) Der Trend-Pfeil auf dem Dashboard wurde von 3 auf 5 Richtungen erweitert, um die CGM-Standard-Vocabular (`risingQuickly / rising / stable / falling / fallingQuickly`) direkt abzubilden; die Komponente bevorzugt jetzt den Adapter-Trend aus der API und fällt nur auf den selbst berechneten 15-Minuten-Slope zurück wenn kein Adapter-Trend vorhanden ist. (2) Die Apple-Health-Sektion in den Settings erhält einen iOS-style Toggle-Switch als primäre Geste zum Ein-/Ausschalten der Quelle. (3) Letzter Messwert wird in der Settings-Karte in mmol/L angezeigt wenn der Nutzer diese Einheit bevorzugt — die Einheitenpräferenz wird über einen neuen `useGlucoseUnit`-Hook in `localStorage` gespeichert. (4) Bei verweigerten HealthKit-Berechtigungen wird ein persistentes Banner mit einem direkten Deep-Link-Button in iOS System Settings angezeigt, sodass der Nutzer die Berechtigung ohne manuelles Suchen erteilen kann.

## Geänderte Dateien

- `components/TrendArrowIcon.tsx` — 5-State-Enum (`up-fast / up / flat / down / down-fast`) statt 3; SVG-Pfade für die beiden Fast-Varianten (Doppelpfeil) ergänzt; `TrendDirection` type exportiert
- `components/CurrentDayGlucoseCard.tsx` — `cgmCurrent` um `trend?: string` erweitert; `trendStringToDirection()`-Helper; neues `trendDirection`-Memo bevorzugt Adapter-Trend über `computeDelta15m`-Fallback; `TrendArrow`-Render-Call auf 5-State umgestellt
- `hooks/useGlucoseUnit.ts` — neuer Hook; Subscriber-Pattern (identisch zu `useCarbUnit`) für shared State über alle Instanzen; `mgdlToMmol()` / `mmolToMgdl()` / `display()` / `displayCompact()` exportiert
- `components/CgmSettingsCard.tsx` — `useGlucoseUnit`-Import; `appleHealthPermissionDenied`-State; iOS-style Toggle-Switch; Permission-Denied-Banner mit Deep-Link-Button; mmol/L-Statuszeile via bedingter `tAh("status_connected_with_value_mmol")`-Pfad
- `messages/de.json` — drei neue Keys: `source_toggle_label`, `open_ios_settings`, `status_connected_with_value_mmol`

## TypeScript

`npx tsc --noEmit` → ✅ clean (0 Fehler, 0 Warnungen)

## Manuelle Schritte für Lucas

Keine. Kein DB-Migration, keine neuen Env-Vars, keine Xcode-Schritte. Der `useGlucoseUnit`-Hook nutzt `localStorage` — keine `profiles`-Spalte nötig.

## Offene Punkte

- `useGlucoseUnit` speichert die Einheit nur in `localStorage`, nicht in der DB. Bei einem neuen Gerät oder nach `localStorage`-Leerung wird die Präferenz auf `mg/dL` zurückgesetzt. Für persistente Server-seitige Speicherung: Migration `ALTER TABLE profiles ADD COLUMN glucose_unit text DEFAULT 'mg/dL'` nachliefern + Hook analog zu `useCarbUnit` erweitern.
- Der Deep-Link `App-Prefs:root=Privacy&path=HEALTH` öffnet Systemeinstellungen → Datenschutz, nicht direkt den Glev-Health-Eintrag. Apple erlaubt keinen direkteren Deep-Link aus dem App-Context heraus.
- mmol/L-Umrechnung in `CurrentDayGlucoseCard` (Dashboard-Wert selbst) noch nicht implementiert — nur Settings-Karte und künftig nutzbar via `useGlucoseUnit`. Separater Task empfohlen.
