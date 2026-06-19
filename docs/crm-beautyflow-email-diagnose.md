# Diagnose: CRM-Beautyflow-Email broken (2026-06-19)

**Symptom:** Keine CRM-Notification-Email mehr an `glev@beauty-flow.de` für neue Leads.  
**Status:** Root cause identifiziert. KEIN Production-Code-Change. Separater Fix-Sprint geplant.

---

## A) Git-Log letzte 48h — Verdachtsliste

| Commit | Datum | Beschreibung | Relevanz |
|--------|-------|--------------|----------|
| `7758463b` | 2026-06-17 15:52 | refactor(meta): migrate from inline server-side CAPI to layer-one cloudflare worker gateway | **MITTEL** — rewritten `app/api/fb-capi/route.ts` + deleted `lib/fb-capi-server.ts`. Berührt CRM-Route NICHT direkt, aber ändert CAPI-Infrastruktur. Neuer fb-capi-Endpunkt returned 503 wenn `CAPI_GATEWAY_URL` env var fehlt. |
| `21b88982` | 2026-06-17 16:21 | fix(auth): hash-flow type check + locale param in signup confirmation links | **NIEDRIG** — `app/signup/page.tsx` nur minimal geändert (`emailRedirectTo` + `lang=` param). CRM-Notification-Block unverändert. |
| `bc2f11f1` | 2026-06-18 | feat(insulin): ke/be-aware icr display | **KEIN Bezug** |

**Kein Commit in den letzten 48h hat `app/api/crm/signup-notification/route.ts` oder `lib/emails/crm-signup-notification.ts` berührt.**

---

## B) Resend Dashboard

Nicht direkt prüfbar ohne Dashboard-Zugang. Hypothese auf Basis Code-Analyse (siehe F).

- `from:` `"Glev CRM <crm@glev.app>"` — Resend muss `glev.app` als verifizierte Domain haben
- `to:` `["glev@beauty-flow.de", "crm@glev.app"]`
- Resend SDK v6.12.2, unterstützt Edge Runtime via Fetch API

**Aktion:** Im Resend Dashboard → Activity → letzte 48h → filter by `glev@beauty-flow.de`. Prüfen: delivered / failed / gar nicht angekommen?

---

## C) Supabase email_outbox

Die CRM-Route (`/api/crm/signup-notification`) verwendet **NICHT** die `email_outbox`. Sie sendet direkt via Resend SDK. Keine Outbox-Einträge erwartet.

---

## D) Vercel Function-Logs

```
Zeitraum:  2026-06-17T00:00:00Z → 2026-06-19T15:50:00Z
Route:     /api/crm/signup-notification
Runtime:   edge (export const runtime = "edge")
Ergebnis:  0 Log-Einträge
```

**Befund:** Die Vercel MCP Log API liefert keinerlei Edge-Function-Logs zurück (auch mit `source: ["edge-function"]`). Serverless Cron-Logs sind sichtbar. Zwei mögliche Erklärungen:
1. Vercel MCP Log Tool unterstützt Edge-Function-Logs nicht (API-Limitierung).
2. Die Route wurde tatsächlich nicht aufgerufen.

Gleichzeitig: Serverless-Logs zeigen aktive Cron-Jobs (`/api/cron/*`) — das Log-System selbst funktioniert für serverless.

---

## E) Code-Trace

### Trigger-Pfad
```
app/signup/page.tsx → handleProfileSubmit() → fetch("/api/crm/signup-notification", {...})
```

### Bedingungen für den Aufruf
```tsx
// signup/page.tsx L245
if (userId) {                          // userId = state aus Step 1 (nach supabase.auth.signUp)
  fetch("/api/crm/signup-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ... }),
  }).catch((e) => console.warn("[signup] CRM notification failed:", e));
}
```
- Fire-and-forget vom **Browser**. Fehler → Browser-Console-Warn, KEIN Vercel-Log.
- Wird übersprungen wenn `userId` null ist (sollte nach erfolgreichem signUp nie passieren).

### Silent Skip im Route-Handler
```ts
// app/api/crm/signup-notification/route.ts L29-31
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.warn("[crm/signup-notification] RESEND_API_KEY not set — skipping send");
  return NextResponse.json({ ok: true, skipped: true });   // ← Silent skip, Status 200
}
```
Ein fehlendes/abgelaufenes `RESEND_API_KEY` in der Edge-Function-Umgebung → 200 OK zurück, kein Fehler für den Browser, kein Log für Vercel Serverless.

---

## F) Root Cause — HAUPTBEFUND (HIGH CONFIDENCE)

### ✅ Die CRM-Notification existiert NUR für Web-Signups

```
Web-Signup-Pfad:      /signup → supabase.auth.signUp() → fetch(/api/crm/signup-notification)
Meta-Lead-Pfad:       /api/meta/leads → provisionMetaLead() → [KEIN CRM-Notify]
```

`provisionMetaLead()` (`lib/meta-lead-provisioning.ts`) sendet:
- ✅ Gebrandete Invite-Email an den Lead selbst (via Resend, from `info@glev.app`)
- ✅ SMS via Twilio (fire-and-forget)
- ❌ **KEIN CRM-Notify an `glev@beauty-flow.de`**

### Supabase-Befund: Fast alle neuen User kommen via Meta Leads

```sql
SELECT signup_source, COUNT(*) 
FROM profiles 
WHERE user_id IN (users created since 2026-06-17)
GROUP BY signup_source;
```

| signup_source | Anzahl (2026-06-17 bis 2026-06-19) |
|---------------|-------------------------------------|
| `meta_lead`   | 14                                  |
| `null`        | 5 (Apple Sign-In + Web-Signup)      |
| Gesamt        | ~19                                 |

**14 von ~19 neuen Usern kommen über Meta Lead Ads. Für diese feuert `/api/crm/signup-notification` NIEMALS.**

Die 5 null-Einträge sind:
- `r866yhjmf7@privaterelay.appleid.com` → Apple Sign-In (kein CRM-Trigger)
- `lroelleke@yahoo.de` (name: "lucas") → Testaccount / Web-Signup
- `jonas@gieselmann.io` → Web-Signup
- `info@connectinglink-coaching.com` → Web-Signup
- Weitere

Für die Web-Signups (jonas, info@connectinglink) HÄTTE die CRM-Notification feuern sollen. Ob sie das tat, ist unklar (Edge-Logs nicht prüfbar, Resend-Dashboard nötig).

### Chronologie

| Zeitpunkt | Ereignis |
|-----------|----------|
| Vor ~2026-06-17 | Hauptsächlich Web-Signups → CRM-Notification funktioniert |
| Ab ~2026-06-17 | Meta-Ads-Kampagne läuft heiß, Mehrheit der Leads kommt via Meta Lead Form, NICHT via Web-Signup |
| 2026-06-18 Abend | Lucas bemerkt: keine Beautyflow-Emails mehr |

Das erklärt das plötzliche "auf einmal nicht mehr": Es ist kein Bug in einem Deploy — der Traffic-Mix hat sich verschoben. Meta-Leads erzeugen nie CRM-Notifications.

---

## G) Sekundärfund — MEDIUM CONFIDENCE

### Mögliches Edge-Function-Problem mit RESEND_API_KEY

Die CRM-Route hat `export const runtime = "edge"`. In Vercel müssen Env-Vars für Edge Functions explizit verfügbar sein. Falls `RESEND_API_KEY` nicht für die Edge-Runtime konfiguriert ist:

```ts
if (!apiKey) {
  return NextResponse.json({ ok: true, skipped: true });  // stiller Skip
}
```

Dies würde auch Web-Signups betreffen. Prüfung: Vercel Dashboard → Project Settings → Environment Variables → `RESEND_API_KEY` → prüfen ob "Edge" unter "Available to" ausgewählt ist.

---

## H) Fix-Vorschlag (für separaten Fix-Sprint)

### Fix A (Root Cause — PFLICHT)
`lib/meta-lead-provisioning.ts` nach `provisionMetaLead()` erweitern: 
- Nach erfolgreichem Anlegen des Users CRM-Notify an `glev@beauty-flow.de` senden
- Entweder via internem `fetch("/api/crm/signup-notification")` oder direkte Resend-Call mit `CrmSignupPayload`-kompatiblem Body
- Source-Feld: `plan: "meta_lead"` (statt `"free-trial-7d"`)

### Fix B (Absicherung — EMPFOHLEN)
Vercel Dashboard prüfen: `RESEND_API_KEY` muss für Edge-Runtime verfügbar sein.  
Route entweder auf `runtime = "nodejs"` umstellen ODER Edge-Variable-Verfügbarkeit sicherstellen.

### Fix C (Monitoring — NICE TO HAVE)
CRM-Notification-Calls in Supabase `email_outbox` oder eigenem Log-Table tracken, damit Delivery-Failures nicht still verschwinden.

---

## I) Dateien mit Änderungsbedarf (Fix-Sprint)

| Datei | Änderung | Prio |
|-------|----------|------|
| `lib/meta-lead-provisioning.ts` | CRM-Notify nach User-Anlage hinzufügen | HOCH |
| `app/api/crm/signup-notification/route.ts` | Optional: `runtime = "nodejs"` + Logging verbessern | MITTEL |
| `lib/emails/crm-signup-notification.ts` | Meta-Lead-spezifische Felder aufnehmen (`plan: "meta_lead"`) | NIEDRIG |

---

*Erstellt: 2026-06-19 | Branch: diagnose/crm-beautyflow-email | KEIN Production-Code geändert*

---

## J) Smoke-Test nach Deploy (Fix-Sprint fix/crm-meta-lead-notify)

### Was wurde geändert
- `lib/meta-lead-provisioning.ts` → CRM-Notify nach meta_leads-Upsert eingebaut
- `app/api/crm/signup-notification/route.ts` → `runtime = "nodejs"` (war "edge")

### Test 1 — Meta-Lead-Notify
1. Im Meta Business Manager → Testformular-Submission für Seite Glev absetzen (oder bestehende Lead-ID via Graph API Replay an `/api/meta/leads` POST schicken)
2. Vercel-Log von `/api/meta/leads` prüfen: `[meta-lead-provisioning] CRM notify failed` darf NICHT erscheinen
3. `glev@beauty-flow.de` Inbox: E-Mail mit Subject `[CRM] Neue Anmeldung: …` prüfen
4. Resend Dashboard → Activity → `glev@beauty-flow.de` als Empfänger → Status `delivered`

### Test 2 — Web-Signup-Notify (Regression-Check)
1. `/signup` Seite aufrufen, Testaccount anlegen (Step 1 + Step 2 ausfüllen)
2. Beautyflow Inbox: E-Mail prüfen (plan = "free-trial-7d")
3. Vercel-Log von `/api/crm/signup-notification` prüfen: kein Fehler, Status 200

### Test 3 — Idempotenz
1. Gleiche Meta-Lead-E-Mail zweimal submittieren (Replay)
2. Nur EINE CRM-Notify-Email soll ankommen (zweite wird durch `existingMetaLead`-Check in provisionMetaLead verhindert)

### Rollback
Falls Beautyflow weiterhin leer: `RESEND_API_KEY` in Vercel Dashboard prüfen (Production env var). Route ist jetzt nodejs → Key sollte immer verfügbar sein. Falls Resend-Dashboard zeigt "failed": Domain `glev.app` in Resend Console prüfen.
