# 📋 Dev Cockpit — Phase 3 Build Status Report

**Stand:** 2026-06-02 · **Branch:** `main` (`WahNun/glev-app`)

## Ziel: Analyze Task erstmals mit Mistral verbinden

Phase 3 verbindet **„Analyze Task"** mit Mistral als reine **Planungs-Engine**.
Ausschließlich: Prompt → Analyse → Plan → Rückfragen → Statuswechsel.
**Kein** Build, GitHub, Commit, Diff, Apply, Preview, Upload, Voice, Agent-Execution.

---

## 1. Implementierte Funktionen

| Bereich | Umfang |
|---|---|
| **Mistral-Analyse** | `runDevCockpitAnalysis()` — serverseitig, Key nur via `MISTRAL_API_KEY`, JSON-Mode (`responseFormat: json_object`), Senior-Software-Architect-System-Prompt |
| **Server Action** | `analyzeTask(taskId)` — sammelt Prompt + Titel + Chat-History + Queue-Notes (nur `queued`), ruft Mistral, persistiert Plan + Status + Assistant-Message |
| **Strukturiertes Output** | `BuildPlan` = `{ summary, affected_areas[], likely_files[], risks[], questions[], ready_to_build }` — validiert/normalisiert |
| **Status-Logik** | `ready_to_build = true` → `waiting_for_start` · `false` → `waiting_for_input` · automatisch gespeichert |
| **Build-Plan-Card** | Neue Card im Chatbereich, schön formatiert (Summary/Areas/Files/Risks/Questions/Ready) — **nie** als JSON |
| **Assistant-Message** | Menschenlesbare Zusammenfassung wird zusätzlich persistent als `assistant`-Message gespeichert |
| **Follow-up-Chat** | Bei offenen Fragen kann der User direkt im Chat antworten (→ `user`-Message), dann **Re-Analyze** (Analyse mit vollständiger History) |
| **Queue-Integration** | Nur Queue-Notes mit Status `queued` fließen ein; `discarded` etc. werden ignoriert |
| **Status-Banner** | `waiting_for_input` → gelber Banner „Agent benötigt zusätzliche Informationen." · `waiting_for_start` → grüner Banner „Plan abgeschlossen. Bereit für Start Build." |
| **Task-Header** | „Current Status" mit den Phase-2-Statusfarben |
| **Fehlerbehandlung** | Mistral-Fehler → Status **unverändert**, Fehlermeldung im UI + persistente `system`-Message „Mistral analysis failed." |
| **Logging** | Analyse-Ergebnis (JSON) in `task.plan_text` gespeichert für spätere Phasen |

Bestehende Phase-2-Funktionalität bleibt vollständig erhalten.

## 2. Neue Dateien

- `lib/ai/devCockpitAnalysis.ts` — Mistral-Analyse-Engine: System-Prompt, JSON-Parsing/Normalisierung, `runDevCockpitAnalysis()` + `formatPlanMessage()`
- `supabase/migrations/20260602_dev_cockpit_waiting_for_input.sql` — erweitert den `dev_cockpit_tasks.status`-CHECK um `waiting_for_input` (namensunabhängiger, idempotenter Constraint-Swap)
- `docs/dev-cockpit/PHASE_3_STATUS.md` — dieser Report

## 3. Geänderte Dateien

- `app/glev-ops/dev-cockpit/actions.ts` — neue Action `analyzeTask()`; `waiting_for_input` in `ALL_STATUSES`
- `app/glev-ops/dev-cockpit/types.ts` — `BuildPlan`-Interface
- `app/glev-ops/dev-cockpit/DevCockpit.tsx` — Analyze/Re-Analyze-Button, Build-Plan-Card, Status-Banner, Follow-up-Antwort-Input, `parsePlan()` + `PlanSection`; altes deaktiviertes „Analyze Task" aus der Composer-Leiste entfernt

## 4. Wie Phase 3 getestet werden soll

**Voraussetzungen:** Migration `20260602_dev_cockpit_waiting_for_input.sql` anwenden
(`node scripts/apply-migration.mjs supabase/migrations/20260602_dev_cockpit_waiting_for_input.sql`)
und sicherstellen, dass `MISTRAL_API_KEY` als Secret gesetzt ist. App neu starten.

1. Task öffnen (oder neu anlegen mit klarem Prompt) → **„Analyze Task"** klicken.
2. Erwartung: nach kurzer Zeit erscheint die **Build-Plan-Card** (Summary, Areas,
   Files, Risks, ggf. Questions) + eine **assistant**-Nachricht im Chat. Status
   wechselt auf **`waiting_for_start`** (grüner Banner) wenn klar, sonst
   **`waiting_for_input`** (gelber Banner).
3. Bei offenen Fragen: Antwort ins Follow-up-Feld schreiben → **„Antwort senden"**
   (erscheint als `user`-Message) → **„Re-Analyze"** → neue Analyse mit History.
4. **Reload** der Seite → Build-Plan-Card + Status bleiben (aus `plan_text` / DB).
5. **Queue:** Eine `queued`-Notiz hinzufügen, dann analysieren → sie wird
   berücksichtigt; eine `discarded`-Notiz wird ignoriert.
6. **Fehlerfall:** `MISTRAL_API_KEY` temporär leeren → „Analyze Task" → Status
   bleibt unverändert, `system`-Message „Mistral analysis failed." erscheint.
7. Gegencheck DB: `SELECT status, plan_text FROM dev_cockpit_tasks WHERE id='…';`

## 5. Offene Punkte für Phase 4

- **Start Build** (regulärer `building`-Übergang), echte Code-Generierung,
  GitHub-Branch, Vercel-Preview, Diff-Viewer, Apply/Reject — bewusst NICHT in Phase 3.
- **Evaluate Queue** (AI-Bewertung der Queue-Notes → `impact_level`,
  `recommendation`, `evaluation_text`).
- Modellwahl/Kosten: `DEV_COCKPIT_ANALYSIS_MODEL` (Default `mistral-large-latest`)
  ggf. tunen; optional Streaming der Analyse.
- Attachments/Voice-Verarbeitung weiterhin offen.

---

**Fazit: Phase 3 liefert eine vollständige Analyze→Plan→Rückfragen→Statuswechsel-Schleife mit Mistral — ohne jede Build-/Code-Aktion. ✅**
