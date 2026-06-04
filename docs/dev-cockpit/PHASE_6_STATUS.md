# 📋 Dev Cockpit — Phase 6 Build Status Report

**Stand:** 2026-06-04 · **Branch:** `main` (`WahNun/glev-app`)

## Fortschritt
```
█████░░░░░░░ 42%   →   ██████░░░░░░ 50%
Phase 5 / 12           Phase 6 / 12
Build Execution        Coding Agent
```
**Phase 5 → Phase 6 · 42% → 50% · (+8%)** · Next: Preview Pipeline

## Ziel
Der Coding Agent erzeugt erstmals **echten Code** — als **Code Draft** aus dem Build Plan. **Vollständig sandboxed:** kein Merge, keine Datei überschrieben, kein Commit, kein PR, kein Deploy. Nur Vorschläge.

---

## 1. Implementierte Funktionen
- **„Generate Code"** (sichtbar ab `build_ready`; Re-Generate ab `code_ready`/`code_failed`): `build_ready → generating_code → code_ready` (Fehler → `code_failed` + System-Message).
- **Coding Agent** (`runCodeGeneration`, server-only, Dev-Cockpit-Key, JSON): Input = Build Plan + Included/Excluded Snapshot + Analyse + Titel + Nachrichtenhistorie (strikt task-lokal). Output = `CodeGenerationDraft { summary, files_to_create[], files_to_modify[], implementation_steps[], generated_code_blocks[], risks[], estimated_change_size }`.
- **Konkrete Vorschläge:** Dateinamen + echte Code-Blöcke. Agent **schreibt/committet/deployt nichts**.
- **Versionierung & Immutable History:** jede Generierung = Code Draft #N (eigene `code_id`, eingefrorenes Snapshot-Prinzip wie Phase 5). Tabelle `dev_cockpit_code_generations`.
- **Persistenz:** neuester Draft denormalisiert in `dev_cockpit_tasks.generated_code` (+ `code_generation_version`, `generated_at`) → bleibt nach Reload.
- **Parallelität:** mehrere Tasks gleichzeitig `generating_code` (Route-Handler + per-task `generatingCodeIds`, keine globale Sperre).
- **Glev-Icon:** `generating_code` → rotierend; `code_ready` → grün; `code_failed` → rotes X.
- **UI:** neue **Code Draft Card** (Version · Created · Updated · Status · Summary · Files To Create · Files To Modify · Implementation Steps · Risks · Estimated Change Size · ausklappbare Code-Blöcke) + **Code History** getrennt von Build History.

Phase 1–5 vollständig erhalten.

## 2. Neue Dateien
- `lib/ai/devCockpitCodeGen.ts` — Coding-Agent (Prompt, JSON-Parsing)
- `lib/devCockpit/performGenerateCode.ts` — Orchestration (Versionierung + Draft-Record)
- `app/glev-ops/dev-cockpit/api/generate-code/route.ts` — POST-Route (non-blocking)
- `supabase/migrations/20260604_dev_cockpit_code_generation.sql` — Migration
- `docs/dev-cockpit/PHASE_6_STATUS.md` — dieser Report

## 3. Geänderte Dateien
- `types.ts` · `actions.ts` (`generateCode`, `listCodeGenerations`, ALL_STATUSES) · `DevCockpit.tsx` · `DevCockpitPhaseProgress.tsx` (`currentPhase: 6`)

## 4. Neue Status
`generating_code`, `code_ready`, `code_failed`

## 5. Neue Datenmodelle
`GeneratedCodeDraft` (Core vom Agent), `CodeGenerationDraft` (eingefrorenes Artefakt + Metadaten), `CodeBlock {file, code}`, `DevCodeGeneration` (History-Row)

## 6. Neue Persistenzfelder
- `dev_cockpit_tasks.generated_code jsonb`, `code_generation_version integer`, `generated_at timestamptz`
- neue Tabelle `dev_cockpit_code_generations` (immutable Drafts)
- Task-Status-CHECK um die 3 Status erweitert

## 7. Datenbankmigration
`20260604_dev_cockpit_code_generation.sql` — additiv + idempotent. **Wird beim Push automatisch via GitHub-Action angewendet.** ⚠️ Vor dem Test im Actions-Tab grün prüfen.

## 8. Testanleitung (Definition of Done)
1. Task bis `build_ready` bringen (Analyze → Start Build).
2. **Generate Code** → `generating_code` → `code_ready`; **Code Draft #1** erscheint mit konkreten Dateien + Code-Blöcken.
3. **Reload** → Draft bleibt.
4. **Re-Generate Code** → **Code Draft #2**; ältere Drafts unverändert.
5. **Code History** zeigt #1 + #2, **getrennt** von der Build History.
6. **Keine** Datei geändert, **keine** GitHub-/Deploy-Aktion.
7. Header: `██████░░░░░░ 50% · Phase 6/12 · Coding Agent · Next: Preview Pipeline`.

## 9. Nicht Teil von Phase 6 (kommt später)
GitHub · Branches · PRs · Commits · Dateisystem-Writes · Vercel · Deployment · Auto-Merge · Auto-Apply.

## 10. Offene Punkte für Phase 7 (Preview Pipeline)
Aus dem Code Draft eine echte Preview erzeugen (Branch/Vercel-Preview) — die Status `preview_ready` etc. werden dann regulär durchlaufen.

---

**Fazit: Phase 6 liefert einen vollständig sandboxed Coding Agent, der versionierte, persistente Code-Drafts mit echten Datei-/Code-Vorschlägen erzeugt — ohne jede Schreib-/Merge-/Deploy-Aktion. ✅**
