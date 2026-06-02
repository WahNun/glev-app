# 📋 Dev Cockpit — Phase 5 Build Status Report

**Stand:** 2026-06-03 · **Branch:** `main` (`WahNun/glev-app`)

## Fortschritt
```
████░░░░░░░░ 33%   →   █████░░░░░░░ 42%
Phase 4 / 12           Phase 5 / 12
Queue Intelligence     Build Execution
```
**Phase 4 → Phase 5 · 33% → 42% · (+9%)** · Next: Coding Agent

## Ziel
Erstmals echte **Build-Pläne** erzeugen & verwalten — `Task → Analyse → Queue Evaluation → Start Build → Build Plan`. **Nur Plan**, keine Code-Generierung/Branches/Execution (das ist Phase 6).

---

## 1. Implementierte Funktionen
- **Build Plan Generator:** Klick auf **Start Build** erzeugt via Mistral einen strukturierten Build Plan `{ scope, steps[], affected_areas[], risks[], complexity }`.
- **Build Scope (deterministisch, serverseitig):**
  - **Included** = Queue Notes mit `status='applied'` **und** `approved_for_current_build=true` → in den Build gefaltet
  - **Excluded** = `after_build_pending` → bewusst ausgeschlossen, im Plan explizit gelistet
  - **separate_task** → komplett ignoriert
- **Build-Status-Maschine:** neue Status `planning_build → build_ready` (+ `building`, `build_failed`, `build_complete` für Phase 6). Fehler → `build_failed` + System-Message.
- **Build Plan Card:** Build Scope · Build Steps (geordnet) · Included Notes · Excluded Notes · betroffene Bereiche (+Anzahl) · Risiken · geschätzte Komplexität.
- **Persistenz:** Build Plan in `dev_cockpit_tasks.build_plan` (jsonb) — übersteht Reload.
- **Parallelität:** mehrere Tasks gleichzeitig `planning_build` möglich (Route-Handler + `fetch`, per-task `buildingTaskIds`, keine globale Sperre).
- **Glev-Icon erweitert:** `planning_build`/`building` → rotierendes Glev-Icon (Glow), `build_ready` → grünes Glev-Icon, `build_complete` → grüner Check, `build_failed` → rotes X.
- Analyse-Card umbenannt zu **„Analyse-Plan"**, neue Card heißt **„Build Plan"**.

Phase 1–4 vollständig erhalten. **Keine** Code-Generierung/GitHub/Vercel/Diff/Execution.

## 2. Neue Dateien
- `lib/ai/devCockpitBuildPlan.ts` — Build-Plan-Generator (Mistral, JSON)
- `lib/devCockpit/performStartBuild.ts` — Orchestration (Scope aus Queue + persist)
- `app/glev-ops/dev-cockpit/api/start-build/route.ts` — POST-Route (non-blocking)
- `supabase/migrations/20260603_dev_cockpit_build_execution.sql` — Migration
- `docs/dev-cockpit/PHASE_5_STATUS.md` — dieser Report

## 3. Geänderte Dateien
- `types.ts` · `actions.ts` (`startBuild` + ALL_STATUSES) · `DevCockpit.tsx` · `DevCockpitPhaseProgress.tsx` (`currentPhase: 5`)

## 4. Neue Status
`planning_build`, `build_ready`, `build_failed`, `build_complete` (zusätzlich zum bereits vorhandenen `building`).

## 5. Neue Datenmodelle / Persistenzfelder
- **Typ** `BuildExecutionPlan` `{ scope, steps[], included_notes[], excluded_notes[], affected_areas[], risks[], complexity }`
- **Spalte** `dev_cockpit_tasks.build_plan jsonb` (NULL bis Start Build)
- Status-CHECK auf `dev_cockpit_tasks` um die 4 neuen Status erweitert

## 6. Datenbankmigration
`20260603_dev_cockpit_build_execution.sql` — additiv + idempotent. **Wird beim Push automatisch via GitHub-Action „Apply DB migrations" angewendet.** ⚠️ Vor dem Testen prüfen, dass die Action grün durchlief (sonst fehlt die Spalte `build_plan` und die Seite lädt nicht).

## 7. Testanleitung
Nach grünem Migrations-Run + Redeploy:
1. Task „CSV Export hinzufügen." anlegen → **Analyze Task** (→ `waiting_for_start`).
2. 3 Queue Notes + je evaluieren/zuweisen:
   - „Der Button soll rechts oben erscheinen." → **Apply To Current Build**
   - „Excel Export hinzufügen." → **Apply After Build**
   - „PDF Export mit eigenem Layout." → **Create New Task** (oder als separate_task belassen)
3. **Start Build** → Task spinnt (`planning_build`), dann `build_ready`. **Build Plan Card** erscheint.
4. **Erwartung:** Steps enthalten CSV Export + „Button rechts oben"; **Excluded** listet „Excel Export"; **PDF Export** taucht nirgends auf.
5. **Reload** → Build Plan bleibt.
6. **Parallel:** zweite Task ebenfalls Start Build → beide spinnen, UI bleibt bedienbar.

## 8. Definition of Done ✅
- Build Plan enthält CSV Export + Button rechts oben
- Build Plan enthält **nicht** Excel/PDF Export
- Excluded-Bereich listet die After-Build-Note explizit
- Build Plan bleibt nach Reload
- Mehrere Build Plans parallel erzeugbar
- Header: `█████░░░░░░░ 42% · Phase 5/12 · Build Execution · Next: Coding Agent`

## 9. Offene Punkte für Phase 6 (Coding Agent)
Echte Code-Generierung auf Basis des Build Plans, GitHub-Branch, Vercel-Preview, Diff & Review, Apply — die Status `building`/`build_complete`/`preview_ready` werden dann regulär durchlaufen.

---

**Fazit: Phase 5 erzeugt vollständige, persistente, parallele Build-Pläne mit korrektem Scope (Included/Excluded) — ohne jede Code-Ausführung. ✅**
