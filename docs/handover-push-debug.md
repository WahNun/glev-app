# Handover: APNs Push-Notification SyntaxError

## Kontext

**Glev** ist eine Next.js 15 App (deployed auf Vercel → `https://glev.app`), verpackt als Capacitor 8 iOS-Shell. Der iOS-Build lädt `https://glev.app` als WKWebView.

---

## Das Problem

In der App unter **Einstellungen → Push-Debug** gibt es einen „Test-Push"-Button. Er ruft `/api/push/self-test` (POST) auf und zeigt das Ergebnis an.

**Aktueller Fehler (on-device, TestFlight):**
```
❌ SyntaxError: The string did not match the expected pattern.
```

Der Fehler kommt vom Server als JSON `{ "error": "SyntaxError: ..." }` zurück und wird im Client angezeigt. Er entsteht beim Versuch, aus dem `APNS_KEY_P8` Environment-Variable einen JWT zu signieren.

---

## Was bereits versucht wurde

1. `normalizeP8Key()` geschrieben — ersetzt `\r\n`, `\r`, `\n` (literal escape sequences) durch echte Newlines
2. Falls kein Newline vorhanden: PEM wird aus dem Base64-Body mit 64-char-Zeilenumbrüchen rekonstruiert
3. Trailing Newline wird sichergestellt (`\n` am Ende)

Trotzdem schlägt `crypto.createSign("SHA256").sign({ key, dsaEncoding: "ieee-p1363" })` fehl.

---

## Aktueller Stand des Server-Codes

Datei: `app/api/push/self-test/route.ts`

Der JWT-Fehler ist jetzt **gezielt abgefangen** und gibt diagnostische Infos zurück:

```
JWT-Fehler: SyntaxError: ... | key-diag: len=1234 hasBegin=true realNewlines=false escapedNewlines=true lines=1
```

**Das heißt:** Beim nächsten Test-Push-Klick in der App erscheint im Fehlertext der `key-diag:` Block. Das sagt uns genau, in welchem Format der Key in Vercel gespeichert ist.

---

## Was als nächstes zu tun ist

### Schritt 1: Vollständige Fehlermeldung lesen

Auf dem Device in der App: Test-Push drücken → die **vollständige** Fehlermeldung (inkl. `key-diag: ...`) notieren.

Alternativ: Vercel Dashboard → Project → Logs → nach `/api/push/self-test` suchen → Server-Log lesen.

### Schritt 2: Key-Format korrigieren

Je nach `key-diag` Output:

| key-diag | Bedeutung | Fix |
|---|---|---|
| `hasBegin=false` | Key ist nicht als PEM gespeichert — nur der Base64-Body | Manuell `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----` in Vercel eintragen |
| `hasBegin=true realNewlines=false escapedNewlines=true` | Key hat `\n` als literal `\n` gespeichert | `normalizeP8Key` sollte das beheben — wenn nicht, Key in Vercel neu eintragen mit echten Newlines |
| `hasBegin=true realNewlines=true lines=1` | Nur 1 Zeile nach Split — Newlines vorhanden aber `\r` statt `\n` | Key in Vercel als plain PEM mit echten `\n` eintragen |
| `hasBegin=true realNewlines=true lines>5` | Key sieht korrekt aus | Problem liegt woanders — evtl. falscher Key (EC vs RSA), falscher `APNS_KEY_ID` oder `APNS_TEAM_ID` |

### Schritt 3: Key in Vercel korrekt eintragen

Das `.p8` File aus dem Apple Developer Portal öffnen — es sieht so aus:

```
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg...
(mehrere Zeilen à 64 Zeichen)
-----END PRIVATE KEY-----
```

In **Vercel → Project Settings → Environment Variables → `APNS_KEY_P8`**:
- Den **gesamten Inhalt** inklusive `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----` eintragen
- Vercel speichert Newlines korrekt wenn man den Text direkt in das Textfeld kopiert (nicht als JSON-escaped String)

Nach Änderung: **Redeploy** auslösen (Vercel cached Env Vars zur Build-Zeit).

---

## Relevante Dateien

| Datei | Inhalt |
|---|---|
| `app/api/push/self-test/route.ts` | Server-Route für Self-Test (JWT-Generierung, APNs-Request) |
| `app/api/admin/push-test/route.ts` | Admin-Route (gleiche JWT-Logik, für beliebige User per E-Mail) |
| `app/(protected)/settings/app/page.tsx` | `PushDebugSection` Komponente — zeigt Token, Fehler, Test-Button |
| `lib/pushNotifications.ts` | Capacitor Push-Registrierung, speichert Token in `profiles.push_token` |

---

## Xcode-Logs lesen

Wenn der Test-Push-Knopf gedrückt wird:
1. Xcode → Device → Console (⌘+Shift+C) → nach `glev` oder `push` filtern
2. WKWebView-Fehler erscheinen als `[WKWebView]`-Logs
3. Die eigentliche Antwort kommt vom Vercel-Server — am besten direkt in **Vercel Logs** nachschauen (Dashboard → Project → Logs, Real-Time)

---

## Umgebung

- **Push-Token** des Geräts: wird in `localStorage` als `glev_push_token` gespeichert und in Supabase `profiles.push_token` (platform: `"ios"`)
- **APNs Env Vars** (alle in Vercel): `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`
- **Sandbox**: TestFlight und App Store → `sandbox: false`. Nur direkte Xcode-Builds → `sandbox: true`
- **APNs Endpoint**: `api.push.apple.com` (production) oder `api.sandbox.push.apple.com`
