# Settings iPhone-Navigation: 9 Sub-Seiten + vereinfachte Hauptseite

## Was wurde geändert

`app/(protected)/settings/page.tsx` vollständig ersetzt:
- 3625-Zeilen-Monolith (Akkordeons, Sheets, State, Save-Logik) → 130-Zeilen Navigationsliste
- Struktur: `NavSection` + `NavRow`/`FirstNavRow` — jede Zeile navigiert per `router.push()` zur Sub-Seite
- Kein eigener State mehr auf der Hauptseite außer `plan` (PlanSimulator)

Neu erstellt (9 Sub-Seiten):
- `settings/konto/page.tsx` — Account-Sheet, About-Me-Sheet, Glev-AI-Link, Glev+-Kontakt
- `settings/glukose/page.tsx` — TargetRange-, LowAlarm-, Units-Sheets
- `settings/cgm/page.tsx` — LibreLinkUp/Nightscout/Dexcom-Sheets, `?cgmSetup=`-Deep-Link, lokale Hooks
- `settings/insulin/page.tsx` — ICR/CF/TargetBG/DIA/InsulinType/Brand-Sheets, BasalWindow, AdjustmentHistory
- `settings/app/page.tsx` — Notifications/Haptics/Cycle/Language/TimeFormat/CarbUnit/Export/Onboarding/Appearance/Macros, PushDebugSection
- `settings/termine/page.tsx` — Arzttermine Add/Edit/Delete, UpgradeGate
- `settings/daten/page.tsx` — Import- und Historical-Reload-Sheets
- `settings/integrationen/page.tsx` — Google-Sheets-Sheet
- `settings/hilfe/page.tsx` — Feature-Requests-Link, CGM-Quellen-Link

Alle Sub-Seiten: ‹-Rücknavigation zu `/settings`, eigenständiges State-Management.

## Fix

`settings/app/page.tsx`: Import von `NotificationPrefs`/`fetchNotificationPrefs`/`saveNotificationPrefs`/`DEFAULT_NOTIFICATION_PREFS` korrigiert von `@/lib/userSettings` → `@/lib/notificationPrefs`.

## Warum

iPhone-Settings-Pattern: flache Navigationsliste statt aufklappbare Akkordeons. Alle 9 Kategoriezeilen öffnen eine dedizierte Sub-Seite — übersichtlicher, einfacher zu navigieren, Standard-iOS-UX.
