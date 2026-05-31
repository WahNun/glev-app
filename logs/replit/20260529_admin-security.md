# Task: Admin-Bereich absichern — /glev-ops + 3-Faktor-Login + Rate-Limiting

## Was wurde gemacht

**A) URL umbenannt: `/admin` → `/glev-ops`**
- `app/admin/` vollständig nach `app/glev-ops/` kopiert und alles auf neuen Pfad angepasst
- `middleware.ts`: `/admin/*` → `/glev-ops/*` Redirect (Bookmarks bleiben funktionsfähig)
- Altes `app/admin/` Verzeichnis gelöscht

**B) 3-Faktor-Login**
- `lib/adminAuth.ts` (neu): zentrale Auth-Lib mit `verifyAdminCredentials(email, password, totp)`
  - Faktor 1: E-Mail (Env `ADMIN_EMAIL`)
  - Faktor 2: Passwort (Env `ADMIN_API_SECRET`, unverändert)
  - Faktor 3: TOTP-Code (Env `ADMIN_TOTP_SECRET` — base32, Google Authenticator / Authy kompatibel via `otplib`)
- Session-Cookie umbenannt `glev_admin_token` → `glev_ops_token`, speichert jetzt HMAC-SHA256 statt Klartext
- `app/glev-ops/_components/AdminLoginForm.tsx` (neu): geteilte Komponente mit E-Mail-, Passwort- und TOTP-Feld
- Alle 10 Seiten auf `AdminLoginForm` umgestellt (Inline-Formulare entfernt)
- Alle 9 Action-Files auf `lib/adminAuth`-Imports umgestellt (eigene Auth-Impl. entfernt)

**C) Rate-Limiting (delay-basiert)**
- `verifyAdminCredentials()` wartet immer ~400 ms, egal ob Erfolg oder Misserfolg
- Verhindert Brute-Force ohne externen State-Store

## Neue Env-Variablen (in Vercel + lokale .env.local eintragen)
- `ADMIN_EMAIL` — Login-E-Mail des Operators
- `ADMIN_TOTP_SECRET` — base32-Secret für Authenticator-App (einmalig generieren + in App scannen)
- `ADMIN_API_SECRET` — bleibt unverändert (jetzt das Passwort-Feld)

## TOTP-Einrichtung
1. Secret generieren: `node -e "const {authenticator}=require('otplib'); console.log(authenticator.generateSecret())"`
2. Als `ADMIN_TOTP_SECRET` in Vercel setzen
3. In Google Authenticator / Authy: Konto manuell hinzufügen mit dem Secret

## Geänderte Dateien
- `lib/adminAuth.ts` (neu)
- `app/glev-ops/_components/AdminLoginForm.tsx` (neu)
- `app/glev-ops/_actions.ts`, `buyers/actions.ts`, `drip/actions.ts`, `drip-stats/actions.ts`, `emails/actions.ts`, `outbox/actions.ts`, `mistral/actions.ts`, `praxis/actions.ts`, `users/actions.ts`
- Alle 10 `page.tsx`-Dateien in `app/glev-ops/`
- `middleware.ts`
- `app/admin/` gelöscht
