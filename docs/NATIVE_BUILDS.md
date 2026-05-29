# Glev — Native Build Status (Source of Truth)

> **Zweck:** Einzige verlässliche Quelle für iOS/Android Build-Nummern, TestFlight/Play-Store-Status und was einen neuen nativen Build erfordert vs. was rein über Web-Deploy geht.  
> **Aktualisieren:** Jedes Mal wenn ein nativer Build geschippt wird — iOS oder Android.

---

## Aktueller Stand

| | iOS | Android |
|---|---|---|
| **Marketing-Version** | 1.0 | 1.0 |
| **Build-Nummer / Version-Code** | 1 | 2 |
| **Kanal** | TestFlight | Play Store Internal Track |
| **Letzter Build** | _(unbekannt — vor 2026-05-24)_ | _(unbekannt — vor 2026-05-24)_ |
| **Enthaltene native Änderungen** | Push-Notifications (Capacitor + APNs) | Push-Notifications (Capacitor + FCM) |

---

## Push-Notifications Status

### Was ist implementiert

| Komponente | Datei | Status |
|---|---|---|
| Capacitor Plugin-Setup | `lib/pushNotifications.ts`, `components/PushNotificationsProvider.tsx` | ✅ Im Code |
| Provider in Root-Layout | `app/layout.tsx` | ✅ Eingebunden |
| Token-Speicherung in DB | `supabase/migrations/20260525_push_token.sql` | ✅ Migration existiert |
| Token-API-Route | `app/api/profile/push-token/route.ts` | ✅ Existiert |
| Server-Push Edge Function | `supabase/functions/hypo-check/` | ✅ Deployed (alle 5 min) |
| Cooldown-Tabelle | `supabase/migrations/20260525_hypo_push_cooldown.sql` | ✅ Migration existiert |
| Android `google-services.json` | `android/app/google-services.json` | ⚠️ Gitignored — muss auf Build-Maschine vorhanden sein |
| iOS APNs-Konfiguration | Im Xcode-Projekt (Capability: Push Notifications) | ❓ Status unklar |

### Offene Fragen / Probleme

- [ ] Werden Push-Tokens tatsächlich vom Gerät registriert und in `profiles.push_token` gespeichert?  
  → Prüfen: Supabase Dashboard → `profiles`-Tabelle → `push_token`-Spalte für Testgerät
- [ ] Sendet die `hypo-check`-Edge-Function erfolgreich? → Supabase Dashboard → Edge Functions → hypo-check → Logs
- [ ] Sind die Supabase Edge Function Secrets gesetzt?

### Erforderliche Supabase Edge Function Secrets

| Secret | Beschreibung | Gesetzt? |
|---|---|---|
| `FIREBASE_SERVER_KEY` | FCM Server-Key für Android | ❓ |
| `APNS_KEY_P8` | APNs-Privat-Key (PEM-Inhalt) | ❓ |
| `APNS_KEY_ID` | APNs-Key-ID (10 Zeichen) | ❓ |
| `APNS_TEAM_ID` | Apple-Developer-Team-ID (10 Zeichen) | ❓ |
| `APNS_BUNDLE_ID` | Bundle-ID der iOS-App (z. B. `app.glev`) | ❓ |

→ Setzen via: Supabase Dashboard → Project Settings → Edge Functions → Secrets

---

## Wann brauche ich einen neuen nativen Build?

| Änderung | Neuer Build nötig? |
|---|---|
| Web-Code (Next.js Seiten, Components, API-Routes) | ❌ Nein — Vercel-Deploy reicht |
| Neue Capacitor-Plugins hinzugefügt | ✅ Ja |
| `AndroidManifest.xml` geändert | ✅ Ja (Android) |
| `styles.xml` geändert | ✅ Ja (Android) |
| Xcode-Projekt / `Info.plist` geändert | ✅ Ja (iOS) |
| `capacitor.config.ts` geändert | ✅ Ja (beide) |
| `android/app/google-services.json` geändert | ✅ Ja (Android) |
| Neue iOS-Capabilities (z. B. HealthKit, Push) | ✅ Ja (iOS) |
| Neue Permissions in `AndroidManifest.xml` | ✅ Ja (Android) |

---

## Build-History

| Datum | Plattform | Version | Build | Kanal | Enthält |
|---|---|---|---|---|---|
| _(vor 2026-05-24)_ | iOS | 1.0 | 1 | TestFlight | Push-Notifications-Basis |
| _(vor 2026-05-24)_ | Android | 1.0 | 2 | Internal Track | Push-Notifications-Basis |

> **Nächster Eintrag:** Beim nächsten Build hier Datum, Version und was neu war eintragen.

---

## Build-Befehle (Kurzreferenz)

```bash
# iOS — TestFlight
bundle exec fastlane ios beta

# Android — Play Store Internal Track
bundle exec fastlane android beta

# Android — Internal Track → Production promoten (kein Rebuild)
bundle exec fastlane android release

# Aktuelle Versionsnummern anzeigen
node scripts/bump-ios-version.mjs show
node scripts/bump-android-version.mjs show
```

Vollständige Docs: `fastlane/README.md`
