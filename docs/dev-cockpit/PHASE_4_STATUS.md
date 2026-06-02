# 📋 Dev Cockpit — Phase 4 Build Status Report

**Stand:** 2026-06-02 · **Branch:** `main` (`WahNun/glev-app`)

## Ziel: Prompt Queue Evaluation mit Mistral

Queue-Notizen werden nicht nur gespeichert, sondern von Mistral bewertet:
gehört die Idee in den aktuellen Build, danach, in eine separate Task — oder
verworfen? **Nur Evaluation** — keine Code-/Build-/GitHub-/Vercel-Funktion.

---

## 1. Implementierte Funktionen

| Bereich | Umfang |
|---|---|
| **Queue Evaluation** | `runQueueEvaluation()` (server-only, Dev-Cockpit-Key, JSON-Mode) bewertet eine Note relativ zur **eigenen Task** |
| **Strukturiertes Output** | `{ impact_level, recommendation, evaluation_text, affected_areas[], risks[] }` |
| **Impact/Recommendation-Logik** | low→current_build, medium→after_build/current_build, high→separate_task (per System-Prompt) |
| **Safety-Override** | destruktive Note (Nutzer/DB löschen, Stripe/Billing, Auth, destructive SQL) → **impact=high, recommendation=separate_task, Risiko im evaluation_text**, deterministisch erzwungen (`isTaskDestructive`) |
| **Persistenz** | status=`evaluated`, impact/recommendation/evaluation_text/affected_areas/risks gespeichert; Task-Status unverändert |
| **Sprache** | Evaluation folgt der Sprache der Note (DE/EN) |
| **Buttons pro Note** | Evaluate Queue · Apply To Current Build · Apply After Build · Create New Task · Discard |
| **Non-blocking** | Evaluation via Route-Handler (`fetch`), **per-note** Pending (`evaluatingNoteIds`/`noteBusyIds`) — UI/Tasks/andere Notes bleiben bedienbar |

**Scope (Input):** aktuelle Task (title/prompt/plan_text/status), Task-Messages,
Note-Inhalt, **andere `queued` Notes derselben task_id** — **nie** andere Tasks /
globale History / fremde Assistant-Messages.

**Button-Verhalten (kein Build):**
- *Evaluate Queue* → Mistral-Bewertung der Note
- *Apply To Current Build* → status=`applied` + `approved_for_current_build=true`
- *Apply After Build* → status=`after_build_pending`
- *Create New Task* → neue Task (Titel/Prompt aus Note, status `draft`), Note → `converted_to_task`
- *Discard* → status=`discarded`

Bestehende Funktionalität (Task-Erstellung, Analyze/Re-Analyze, Statuslogik,
Safety Gate, Glev-Icon-Loader, Task-Switching, Cancel/Archive/Backlog,
Persistenz, Non-blocking) bleibt vollständig erhalten.

## 2. Neue Dateien
- `lib/ai/devCockpitQueueEval.ts` — Eval-Engine (Prompt, JSON-Parsing, Safety-Override)
- `lib/devCockpit/performQueueEval.ts` — Orchestration (gather scoped + persist)
- `app/glev-ops/dev-cockpit/api/evaluate-queue/route.ts` — POST-Route (non-blocking)
- `supabase/migrations/20260602_dev_cockpit_queue_eval.sql` — additive Migration
- `docs/dev-cockpit/PHASE_4_STATUS.md` — dieser Report

## 3. Geänderte Dateien
- `app/glev-ops/dev-cockpit/types.ts` — `QueueStatus` += `after_build_pending`; `DevQueueNote` += `affected_areas`/`risks`/`approved_for_current_build`; `QueueEvaluation`-Typ; `QUEUE_COLUMNS`
- `app/glev-ops/dev-cockpit/actions.ts` — `applyQueueNoteToCurrentBuild`, `applyQueueNoteAfterBuild`, `convertQueueNoteToTask`; Queue-Selects auf `QUEUE_COLUMNS`
- `app/glev-ops/dev-cockpit/DevCockpit.tsx` — Queue-Karte mit Badges/Eval-Text/Areas/Risks + 5 Buttons, per-note Pending, Evaluate via fetch

## 4. Datenbankmigration (nötig)
`supabase/migrations/20260602_dev_cockpit_queue_eval.sql` — additiv + idempotent:
- 3 neue Spalten auf `dev_cockpit_prompt_queue`: `affected_areas jsonb DEFAULT '[]'`,
  `risks jsonb DEFAULT '[]'`, `approved_for_current_build boolean DEFAULT false`
- Queue-Status-CHECK um `after_build_pending` erweitert (namensunabhängiger Swap)

Anwenden (Replit-Shell):
```bash
git pull origin main
node scripts/apply-migration.mjs supabase/migrations/20260602_dev_cockpit_queue_eval.sql
```
oder den SQL-Block direkt im Supabase SQL Editor ausführen.

## 5. Wie Phase 4 getestet wird
Voraussetzung: Migration angewendet, `MISTRAL_DEV_COCKPIT_API_KEY` (oder `MISTRAL_API_KEY`) gesetzt.

1. Task „Füge einen CSV Export hinzu." → Note „Der Button soll rechts oben erscheinen." → **Evaluate Queue** → Erwartung: impact **low**, recommendation **current_build**.
2. Note „Exportiere zusätzlich auch PDF mit eigenem Layout." → impact **medium/high**, **after_build/separate_task**.
3. Note „Wir wechseln von Stripe auf LemonSqueezy." → impact **high**, **separate_task**.
4. Note „Lösche alle Nutzer ohne aktive Zahlung aus der Datenbank." → impact **high**, **separate_task**, **Sicherheitsrisiko** im evaluation_text.
5. **Reload** → Badges/Evaluation/Areas/Risks bleiben.
6. **Parallelität:** während eine Note evaluiert (zeigt „Bewerte…"), Task wechseln / andere Note bedienen / neue Task — alles sofort.
7. Buttons: Apply To Current Build (→ Badge „✓ Current Build", status applied), Apply After Build (status after_build_pending), Create New Task (neue Draft-Task, Note → „→ Task"), Discard (status discarded).

## 6. Offene Punkte für Phase 5
- Echte **Build-Ausführung**: Notes mit `approved_for_current_build`/`after_build_pending` in einen Build einspeisen.
- Start Build / Code-Generierung / GitHub-Branch / Vercel-Preview / Diff / Apply.
- Optional: Bulk-Apply, Re-Order der Queue, Eval-Caching, Attachments/Voice.

---

**Fazit: Phase 4 liefert vollständige, sichere, nicht-blockierende Queue-Evaluation mit persistenten, strukturierten Ergebnissen — ohne jede Build-Aktion. ✅**
