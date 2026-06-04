# Test-Lead-Injector — Implementierungsbericht

**Datum:** 2026-06-04  
**Branch:** Direkt auf main (kein Feature-Branch, da Agent-Workflow auf main arbeitet)

---

## Was geändert wurde

### 1. DB-Migrationen (beide angewendet via Supabase REST API)

| Datei | Was |
|---|---|
| `supabase/migrations/20260604_meta_leads_synthetic_test.sql` | `is_synthetic_test BOOLEAN NOT NULL DEFAULT FALSE` zu `meta_leads` |
| `supabase/migrations/20260604_reminder_sms_founder_voice.sql` | Reminder-SMS-Template auf Founder-Voice (upsert in `message_templates`) |

**Verifikation:** `is_synthetic_test` ✓ per REST-API-Abfrage bestätigt. `message_templates`-Row ✓ per Upsert-Response bestätigt.

### 2. `lib/messageTemplates.ts` — Hardcoded Default

Hardcoded-Fallback für `meta_lead_reminder_sms.sms_text` geändert von:
> "Hast du Glev noch nicht ausprobiert? Als T1D-Nutzer:in hilft dir Glev …"

auf:
> "Lucas hier, Glev-Gründer. Du hattest dich für den 7-Tage-Test gespeichert — hier dein Link: {{link}}\n\nAbmelden: glev.app/sms-stop?t={{token}}&u={{user_id}} · Fragen: lucas@glev.app"

**Welcome-SMS (`meta_lead_invite_sms`) unverändert.**

### 3. `app/api/admin/inject-test-lead/route.ts` — Neuer Endpoint

`POST /api/admin/inject-test-lead`

- **Auth:** `isAdminAuthed()` (Admin-Cookie `glev_ops_token`)
- **Body:** `{ email, phone?, firstName?, lastName? }`
- **Validierung:** E-Mail-Format, Phone E.164 (auto-normalize 0xxx → +49xxx)
- **Idempotency:** Prüft `meta_leads.email` → 409 Conflict wenn bereits vorhanden
- **Flow:** Ruft `provisionMetaLead()` auf → kompletter Downstream (Welcome-Email + SMS, Profile, meta_leads-Insert)
- **Flag:** Setzt `is_synthetic_test = true` auf der neuen Row
- **Response:** `{ ok, userId, created, leadId, crmUrl, message }`

### 4. `app/glev-ops/crm/TestLeadInjector.tsx` — Neue Client-Komponente

Purple-themed Formular-Panel mit:
- Feldern: Vorname, Nachname, E-Mail (required), Telefon
- Fetch zu `/api/admin/inject-test-lead` (credentials: include für Cookie)
- Inline-Ergebnis: Erfolg (Lead-ID + CRM-Link + User-ID-Link), Conflict (409 mit Lead-ID), Fehler

### 5. `app/glev-ops/crm/page.tsx`

`<TestLeadInjector />` als erstes Panel im oberen Grid eingefügt.

### 6. `app/api/cron/remind-meta-leads/route.ts` — Bug-Fix

**Problem:** 24h-Cutoff (`received_at <= jetzt - 24h`) wurde immer angewendet, auch beim manuellen Reminder-Button im CRM (der `userIds` mitschickt). Frisch injizierte Test-Leads konnten daher nicht sofort erinnert werden.

**Fix:** Cutoff nur noch ohne `filterUserIds` (Cron-Aufruf). Mit `filterUserIds` (manueller Button) → kein Cutoff.

---

## Lucas's Lead — Injiziert

| Feld | Wert |
|---|---|
| Email | lroelleke@icloud.com |
| Phone | +491602296233 |
| Lead-ID | 7d36842f-4e6a-4b97-837d-6c969d2bfe6c |
| Auth-User-ID | 3e14dd7b-9da5-490d-821c-4becefadb238 |
| `is_synthetic_test` | true |
| `created` | false (Account existiert bereits) |
| `reminder_sent_at` | null (zurückgesetzt für Prod-Test) |
| Welcome-Aktion | Recovery-Link generiert + Welcome-Email verschickt |

**Hinweis:** Da Lucas schon einen Supabase-Account hat, wurde ein Recovery-Link (kein Invite-Link) generiert. Welcome-SMS sendet in dev nicht (kein Twilio in Replit) — in Prod ✓.

---

## Dev-Tests durchgeführt

| Test | Ergebnis |
|---|---|
| Inject `lroelleke@icloud.com` via Endpoint | ✓ `ok: true, leadId: 7d36842f` |
| `is_synthetic_test = true` in Supabase | ✓ per REST-Abfrage bestätigt |
| Idempotency (zweiter Inject gleiche Email) | ✓ HTTP 409 |
| Reminder-Button für Lucas (bypasst 24h-Cutoff) | ✓ `sms: "error"` (kein Twilio dev), `emailSent: true` |
| `reminder_sent_at` zurückgesetzt | ✓ null in Supabase |

---

## Was in Prod noch zu testen ist

1. Inject via Admin-UI `/glev-ops/crm` → Welcome-SMS kommt bei Lucas an
2. Reminder-Button im CRM → Founder-Voice-SMS kommt an
3. Abmelde-Link klicken → `profiles.sms_opted_out = true`
4. Nach Opt-Out erneut Reminder → `[sms] skipped: user opted out`

---

## Wo das Reminder-Template jetzt steht

**DB** (`message_templates.sms_text` für Key `meta_lead_reminder_sms`):
```
Lucas hier, Glev-Gründer. Du hattest dich für den 7-Tage-Test gespeichert — hier dein Link: {{link}}

Abmelden: glev.app/sms-stop?t={{token}}&u={{user_id}} · Fragen: lucas@glev.app
```

**Hardcoded Fallback** (`lib/messageTemplates.ts`): identischer Text.

---

## Keine D-XXX-Entscheidung erforderlich

- Kein neuer Cloud-Service
- Schema-Änderung (`is_synthetic_test`) ist rückwärtskompatibel (neue Spalte mit DEFAULT)
- Kein neues Auth-/Compliance-Prinzip
- Keine neue E-Mail-/Webhook-/Cron-Infrastruktur (Endpoint nutzt bestehenden `provisionMetaLead`)
