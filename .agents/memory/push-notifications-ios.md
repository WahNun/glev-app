---
name: Push-Notifications iOS Debug
description: register() fired, Permission granted, aber kein APNs-Token — Debugging-Stand und nächste Schritte
---

## Symptom
- TestFlight-App zeigt: Platform iOS (native ✓), Permission: granted, Letzter Schritt: register() called → Kein Token
- Kein Error, kein Token — APNs antwortet einfach nicht (silent timeout)

## Was korrekt ist (Code-seitig)
- `App.entitlements` hat `aps-environment: production` ✅
- `AppDelegate.swift` ruft `ApplicationDelegateProxy.shared.application(...)` auf ✅ (Capacitor-Bridge korrekt initialisiert)
- `lib/pushNotifications.ts` — register() wird korrekt aufgerufen ✅
- Push-Debug-Panel in Einstellungen eingebaut ✅

## Wahrscheinliche Ursache
Das Provisioning-Profil im aktuellen TestFlight-Build (Build 1) enthält **nicht** die Push-Notifications-Capability.
Ein Provisioning-Profil ist nicht dasselbe wie die Entitlements-Datei — beide müssen übereinstimmen.
Wenn die App ID in Apple Developer → Identifiers nicht explizit Push Notifications aktiviert hat UND das Profil nicht mit dieser Capability generiert wurde, antwortet APNs nie (kein Error, kein Token).

## Checkliste für Fix
1. Apple Developer → Identifiers → App-ID → Edit → Push Notifications = ON ← prüfen
2. fastlane match neu ausführen (regeneriert Profil mit Push-Capability): `bundle exec fastlane match appstore --force`
3. Neuen Build hochladen: `bundle exec fastlane ios beta`
4. Neuen TestFlight-Build installieren und testen

## Was danach noch fehlt (Server-Push)
Supabase Edge Function Secrets für hypo-check Edge Function:
- FIREBASE_SERVER_KEY (Android)
- APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (iOS)
→ Supabase Dashboard → Project Settings → Edge Functions → Secrets

## Echter Root Cause (gefunden 2026-05-30)
**AppDelegate.swift fehlten zwei Pflichtmethoden** für Capacitor 4+:

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}
func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```

Ohne diese leitet iOS den APNs-Token ans AppDelegate zurück, aber das Capacitor-Plugin empfängt ihn nie → `registration`- und `registrationError`-Events feuern nicht → JS hängt still nach `register() called`.

**Fix:** Beide Methoden in `ios/App/App/AppDelegate.swift` ergänzt (2026-05-30). Neuen Build nötig.

## Status (2026-05-30)
- Root Cause: AppDelegate-Methoden fehlten → Fix committed
- Client-seitige Token-Registrierung: ⏳ Fix deployed, neuer TestFlight-Build ausstehend
- Server-seitiger Hypo-Push (hypo-check Edge Function): ❓ ungetestet (erst wenn Token funktioniert)
