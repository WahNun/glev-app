---
name: Push-Notifications iOS Debug
description: APNs token flow, 502 root cause, server-side push implementation status
---

## Echter Root Cause 502 (gefunden 2026-06-03)
**Vercel Function crasht vor Output** → Cloudflare bekommt keine Response → 502-HTML-Page → `res.json()` → WebKit `SyntaxError: The string did not match the expected pattern`.

**Nicht** ein Client-Fetch-Problem. Der Crash passiert im Serverhandler (vermutlich JWT-Generierung via `crypto.createSign` mit einem schlecht formatierten P8-Key).

**Fix deployed:**
- Mega try/catch um GESAMTEN Handler in beiden Routes: `app/api/push/self-test/route.ts` + `app/api/admin/push-test/route.ts`
- `console.error(JSON.stringify(diag))` für Vercel Function Logs
- `diagnoseKey()` in beiden Routes (vorher nur Self-Test): zeigt `len`, `hasBegin`, `realNewlines`, `escapedNewlines`, `lineCount`, `firstChars`
- JWT-Crash in eigenem inneren try/catch mit keyDiag im Response-Body

**Nächster Schritt nach Deploy:** `/glev-ops/settings` → Push-Test ausführen → bei Fehler erscheint jetzt JSON statt 502. Vercel Logs zeigen `[glev] unhandled crash:` mit vollem Stack.

## syncCachedPushToken Login-Gap (gefunden 2026-06-03)
`lib/auth.ts` `signIn()` ruft `syncCachedPushToken()` auf — aber `app/login/page.tsx` nutzt `supabase.auth.signInWithPassword()` direkt (nicht `lib/auth.ts`). Token-Sync fand nach Login nicht statt.
**Fix:** `app/login/page.tsx` ruft `syncCachedPushToken()` via dynamischem Import nach erfolgreichem Login.

## APNs Key Format
Vercel speichert `APNS_KEY_P8` oft als Single-Line mit literal `\n` (escaped). `normalizeP8Key()` dekodiert alle Varianten (`\\r\\n`, `\\r`, `\\n`, Zero-Newlines) und rekonstruiert PEM mit 64-char-wrapped Base64. Muss in BEIDEN Routes vorhanden sein.

## Frühere Root Causes
- **AppDelegate.swift fehlten Push-Delegate-Methoden** (2026-05-30) — `didRegisterForRemoteNotificationsWithDeviceToken` + `didFailToRegisterForRemoteNotifications` → Capacitor empfängt Token nie. Fix committed, neuer Build deployed.
- **Provisioning-Profil** musste Push Notifications Capability explizit einschließen (Apple Developer → Identifiers → App-ID).

## Status
- Client-seitige Token-Registrierung + Sync nach Login: ✅ Fixed
- Server-Handler 502-Absicherung: ✅ Fixed (mega try/catch + diagnostics)
- Sandbox-Default: ✅ `false` in beiden Routes (TestFlight/App Store = Production APNs)
- Eigentlicher Push-Test gegen APNs: ⏳ Ungetestet bis nächster Vercel-Deploy
