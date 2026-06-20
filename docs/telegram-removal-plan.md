# Telegram-Integration: Diagnose + Removal-Plan

**Erstellt:** 2026-06-20  
**Entscheider:** Lucas Wahnon  
**Begründung:** Telegram war ausschließlich ein Dev-Notification-Pfad (OpenAI Whisper-1, US-Infrastruktur). Kein Glev-App-User nutzt es direkt. Passt nicht zur EU-Konsolidierungs-Linie.

---

## Gefundene Telegram-Surface (vollständige Auflistung)

### Code-Dateien — DELETE

| Datei | Surface | Aktion |
|---|---|---|
| `app/api/telegram/webhook/route.ts` | Webhook-Handler (POST), Whisper-1-Transkription, agent_messages INSERT | **DELETE** |
| `scripts/notify-telegram.mjs` | Dev-Notification via Bot-API, wartet auf Realtime-Antwort | **DELETE** |
| `scripts/ask-telegram.mjs` | Agent-Frage via Bot-API + 10-min Timeout | **DELETE** |
| `scripts/reply-telegram.mjs` | Einweg-Antwort via Bot-API + agent_messages INSERT | **DELETE** |
| `scripts/check-inbox.mjs` | Liest agent_messages (task_id=inbox, inbound) | **DELETE** |
| `scripts/inbox-daemon.mjs` | Supabase Realtime Listener → Telegram-ACK | **DELETE** |
| `scripts/start-task.mjs` | Sendet Telegram-Startnotification + liest Inbox | **DELETE** |
| `scripts/lib/telegramNotify.mjs` | Testbarer Kern: waitForReply() via Realtime | **DELETE** |
| `scripts/lib/telegramResolve.mjs` | shouldResolveInbound() Pure-Helper | **DELETE** |
| `tests/unit/telegramWebhook.test.ts` | extractTaskId Unit-Tests | **DELETE** |
| `tests/unit/telegramIntegration.test.ts` | Webhook + agent_messages Integration-Tests | **DELETE** |

### package.json — MODIFY (Lucas-freigegeben)

| Eintrag | Aktion |
|---|---|
| `"telegram:notify": "node scripts/notify-telegram.mjs"` | **REMOVE** |
| `"telegram:ask": "node scripts/ask-telegram.mjs"` | **REMOVE** |

Kein npm-Package (node-telegram-bot-api o.ä.) vorhanden — alle Scripts nutzen native `fetch()`.

### scripts/finalize-task.sh — MODIFY

| Block | Aktion |
|---|---|
| Header-Kommentar `--ask` Sektion (Zeilen 7–17) | **REMOVE** |
| `ASK_QUESTION`/`ASK_OPTIONS` Parsing (Zeilen 25–45) | **REMOVE** |
| `--ask`-Ausführungsblock (Zeilen 103–116) | **REMOVE** |

### Supabase DB — MIGRATION

| Tabelle | Inhalt | Aktion |
|---|---|---|
| `public.agent_messages` | 26 Rows (Task-Message-Bus für Telegram) | **DROP via Migration** |

Migration: `supabase/migrations/20260620120000_drop_agent_messages.sql`  
Wird **nicht** auto-applied — Lucas appliert manuell im Supabase-SQL-Editor.

### ENV-Vars — Manuell von Lucas

| Var | Quelle | Aktion |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Vercel + Replit Secrets | Lucas löscht manuell |
| `TELEGRAM_CHAT_ID` | Vercel + Replit Secrets | Lucas löscht manuell |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel Secrets | Lucas löscht manuell |

Keine `.env.example` im Repo — kein File-Edit nötig.

### Docs — TRANSFORM (historisch markieren)

| Datei | Telegram-Surface | Aktion |
|---|---|---|
| `docs/legacy-ai-removal-plan.md` | 2 Zeilen: Tabellen-Row + Cross-Dependency-Map | Markiert als „entfernt 2026-06-20" |
| `docs/voice-residual-diagnose.md` | Sektion „LIVE — Telegram Bot (Whisper-1)" | Markiert als „entfernt 2026-06-20" |
| `docs/state-report-2026-06-08.md` | agent_messages Tabellenzeile + AI-Pipeline Row | Markiert als „entfernt 2026-06-20" |
| `docs/HANDOFF.md` | Struktur-Listing + ENV-Var-Tabelle + Scripts-Tabelle | Historisch (kein Edit — Handoff-Snapshot) |
| `OPEN_TASKS.md` | 2 Telegram-Bot-Tasks (Backlog) | **DELETE** |

### Restbestände in Logs (READ-ONLY)

| Datei | Typ | Aktion |
|---|---|---|
| `logs/replit/20260520_433.md` | Historisches Log | **KEEP** (Git-History) |
| `logs/replit/20260524_*.md` | Historische Logs | **KEEP** (Git-History) |
| `logs/replit/20260523_—.md` | Historisches Log | **KEEP** (Git-History) |
| `docs/asana/sprints.json` | Asana-Sync-Snapshot | **KEEP** (externe Referenz) |
| `replit.md` | Agent-Workflow-Doku | 4 Zeilen Telegram-Schritt entfernen |

---

## Akzeptanz-Kriterien

- `grep -ri telegram .` zeigt 0 Treffer außer in `DECISIONS.md`-Append, `docs/HANDOFF.md` (historisch), Log-Dateien, `docs/asana/sprints.json`, `docs/telegram-removal-plan.md` selbst
- `pnpm tsc --noEmit` ohne Errors
- Tests laufen durch (keine Imports von gelöschten Dateien)
