# 📋 Dev Cockpit — Phase 2 Build Status Report

**Stand:** 2026-06-01 · **Branch:** `main` (`WahNun/glev-app`) · **Letzter Phase-2-Commit:** `2ec02531`

## Gesamtstatus: ✅ ABGESCHLOSSEN & IN PRODUKTION VERIFIZIERT

Die lokale Mock-State-UI aus Phase 1 wurde vollständig durch **persistente
Supabase-Speicherung** ersetzt. Das Phase-1-Layout bleibt erhalten; alle
Akzeptanzkriterien wurden live smoke-getestet.

---

## 1. Gelieferte Funktionen

| Bereich | Umfang | Status |
|---|---|---|
| **Persistenz** | 4 Tabellen: Tasks / Messages / Prompt-Queue / Attachments | ✅ |
| **Task-Management** | Create, List, Get, Update, Status, Archive, Cancel, Backlog | ✅ |
| **Sidebar-Filter** | Active / Backlog / Archived / Cancelled / Applied / Rejected / All | ✅ |
| **Context-Menü** | Rechtsklick → Cancel / Archive / Move to Backlog | ✅ |
| **Guard Rails** | `building` nicht archivierbar (UI + Server), `applied` archivierbar, `building` cancelbar | ✅ |
| **Prompt → Task** | Prompt in `task.prompt` **+** erste `user`-Message | ✅ |
| **Prompt Queue** | Notiz persistent speichern + Discard (soft) | ✅ |
| **Attachments** | Metadaten-Struktur + Server-Funktionen (kein echter Upload) | ✅ |
| **Admin-Sicherheit** | Alle Actions `isAdminAuthed()`-gated, RLS ohne Policies | ✅ |

**Post-Launch-Nachbesserungen aus dem Test:**
- `6389b962` — ⌘/Strg+Enter sendet Prompt & Queue-Notiz ab
- `2ec02531` — Prompt-Feld legt **immer** eine neue Task an (kein stiller „Save"-Modus, kein Auto-Fill) → mehrere Tasks anlegbar
- `154f8fce` — Mini-UX-Upgrade: Sidebar-Status-Indikatoren + Summary-Chips (siehe §11)

---

## 2. Commits auf `origin/main`

```
154f8fce  feat(glev-ops): dev-cockpit sidebar status indicators + summary chips
2ec02531  fix(glev-ops): dev-cockpit prompt box always creates a NEW task
6389b962  feat(glev-ops): dev-cockpit — Cmd/Ctrl+Enter submits prompt & queue note
d120122b  feat(glev-ops): Dev Cockpit Phase 2 — persistent task management
```

## 3. Dateien

**Neu (3):**
- `app/glev-ops/dev-cockpit/types.ts` (173 Z.) — Typen, Enums, Filter-/Status-Mappings
- `app/glev-ops/dev-cockpit/actions.ts` (382 Z.) — 17 admin-gesicherte Server Actions
- `supabase/migrations/20260601_add_dev_cockpit.sql` (163 Z.) — Migration

**Geändert (2):**
- `app/glev-ops/dev-cockpit/DevCockpit.tsx` (1115 Z.) — Mock-State → Persistenz, Filter, Context-Menü
- `app/glev-ops/dev-cockpit/page.tsx` (40 Z.) — serverseitiger Initial-Load der Active-Tasks

## 4. Server Actions (`actions.ts`)

| Gruppe | Funktionen |
|---|---|
| **Tasks** | `listTasks`, `getTask`, `createTask`, `updateTask`, `updateTaskStatus`, `archiveTask`, `cancelTask`, `moveTaskToBacklog` |
| **Messages** | `addMessage`, `listMessages` |
| **Prompt Queue** | `addQueueNote`, `listQueueNotes`, `updateQueueNote`, `discardQueueNote` |
| **Attachments** | `listAttachments`, `createAttachmentPlaceholder` |

Jede Action prüft zuerst `isAdminAuthed()` und gibt ein `Result<T>`-Envelope
(`{ ok, data } | { ok:false, error }`) zurück — keine Secrets im Frontend.

## 5. Datenbank

| Tabelle | RLS | Status |
|---|---|---|
| `dev_cockpit_tasks` | ✅ on, keine Policy | ✅ live |
| `dev_cockpit_messages` | ✅ on, keine Policy | ✅ live |
| `dev_cockpit_attachments` | ✅ on, keine Policy | ✅ live |
| `dev_cockpit_prompt_queue` | ✅ on, keine Policy | ✅ live |

- Migration **additiv + idempotent** (`CREATE … IF NOT EXISTS`), keine Bestandstabelle berührt.
- Angewendet via `apply-migration.mjs`, Tracking-Eintrag in `schema_migrations` gesetzt.
- **Live-Schema gegen `actions.ts` verifiziert** — alle Spalten & CHECK-Enums stimmen 1:1
  (inkl. `file_url_or_storage_path`, alle 10 Task-Status-Werte).

**Enum-Werte:**
- `tasks.status`: draft, planning, waiting_for_start, building, preview_ready, applied, rejected, cancelled, archived, backlog
- `messages.role`: user, assistant, system
- `prompt_queue.status`: queued, evaluated, applied, discarded, converted_to_task
- `prompt_queue.impact_level`: low, medium, high
- `prompt_queue.recommendation`: current_build, after_build, separate_task, discard

## 6. Verifikations-Ergebnisse (live getestet)

| Test | Ergebnis |
|---|---|
| Create → Reload → Task bleibt | ✅ |
| Prompt als erste `user`-Message | ✅ |
| Mehrere Tasks nacheinander anlegen | ✅ (nach `2ec02531`) |
| Queue-Notiz speichern + Reload | ✅ |
| Cancel / Archive / Backlog → richtiger Filter | ✅ |
| Building-Guard (Archive aus, Cancel geht) | ✅ (Task via SQL auf `building` gesetzt) |
| Auth-Gate (ohne Login kein Zugriff) | ✅ |

## 7. Sicherheit

- Jede Server-Funktion prüft zuerst `isAdminAuthed()`.
- DB-Zugriff ausschließlich über Service-Role-Client (`getSupabaseAdmin()`);
  RLS ohne Policies ⇒ anon/authenticated erhalten 0 Zeilen.
- Keine Secrets im Frontend; Actions geben nur Row-Daten zurück.

## 8. Bewusst NICHT gebaut (Scope-Grenze eingehalten)

Mistral/AI-Calls · GitHub-Branches · Vercel-Previews · Diff-Fetching ·
Voice-Recording · echte File-Uploads · Agent-Execution ·
Supabase-Migration-Manager · Delete-Task (Vorgabe: „falls unsicher, nicht bauen").

## 9. Bekannte Einschränkungen (erwartbar, kein Bug)

- Status `building` ist in Phase 2 nur per SQL erreichbar — der reguläre Weg
  („Start Build") kommt in Phase 3.
- Inline-Prompt-Editing einer bestehenden Task entfernt (war kein Requirement) →
  kommt ggf. als eigenes Edit-Feld in Phase 3.
- Phase-3/4-Buttons (Analyze, Start Build, Evaluate Queue, Apply, Reject)
  sichtbar, aber deaktiviert.

## 10. Nächster Schritt — Phase 3 (Vorschau)

Start Build / Analyze (Status-Übergänge inkl. regulärem `building`), echte
Attachments via Supabase Storage, optional Voice. Previews / Diffs / Branches /
AI bleiben für spätere Phasen. Siehe [`PHASE_1_STATUS.md`](./PHASE_1_STATUS.md)
für die Ausgangsbasis.

---

## 11. Mini-UX-Upgrade — Status-Visualisierung (Nachtrag, 2026-06-01)

Rein visuelles Upgrade der Task Sidebar — **keine** Änderung an Datenmodell
oder Server Actions (Commit `154f8fce`).

**Status-Indikator links neben jedem Task-Titel:**

| Status | Indikator |
|---|---|
| `building` | kleiner kreisförmiger Spinner, sanfte Rotation (0,9 s) — „Agent arbeitet" |
| `planning` | blauer pulsierender Punkt — „Analyse läuft" |
| `waiting_for_input` *(neu)* | gelber Punkt, langsames Pulsieren — „Agent braucht Antwort" (Phase 3) |
| `waiting_for_start` | bernsteinfarbenes Pause-Symbol, statisch — „wartet auf Start Build" |
| `preview_ready` | grüner Punkt mit sanftem Glühen — „wartet auf Apply" |
| `applied` | grüner Haken · `rejected` rotes X |
| `cancelled` | graues Stop · `archived` Archiv-Icon · `backlog` Inbox-Icon |
| `draft` | neutraler grauer Punkt |

Bestehende Status-Badges bleiben zusätzlich erhalten. Animationen via einmalig
injizierte CSS-Keyframes (`dc-spin`, `dc-pulse`, `dc-pulse-slow`, `dc-glow`) —
bewusst sanft, kein aggressives Blinken.

**Summary-Chips oben in der Sidebar:** `Building` · `Waiting` · `Ready` mit
**global** berechneten Zählern (über die bestehende `listTasks('all')`-Action),
klickbar → springt in die Active-Ansicht. Aktualisieren nach Create / Cancel /
Archive / Backlog.

**Neuer Status `waiting_for_input`:** als TS-Typ + Visualisierung ergänzt, in
`ACTIVE_STATUSES` aufgenommen. ⚠️ **Noch NICHT** im DB-`CHECK`-Constraint von
`dev_cockpit_tasks.status` und **nicht** in `actions.ts` → `ALL_STATUSES` — in
Phase 2 schreibt ihn nichts. **Vor erstem echten Einsatz in Phase 3** nötig:
eine Ein-Zeilen-Migration (CHECK erweitern) + Aufnahme in `ALL_STATUSES`.

## 12. Build-Incident (Nachtrag, 2026-06-01)

Ein Vercel-Build auf Commit `3bc5ccd` schlug im TypeScript-Check fehl:

```
./app/glev-ops/users/page.tsx:256
Type error: Property 'user_metadata' does not exist on type '{ id; email; … }'.
  256 |  phone: (u.user_metadata?.phone as string | null) ?? null,
```

- **Ursache:** der parallele CRM-Edit-Flow (Telefonnummer aus `user_metadata`),
  **nicht** der Dev-Cockpit-Code. Alle 5 Dev-Cockpit-Dateien kompilieren sauber.
- **Behoben** durch Commit `6256c93a` „Remove phone number from user table" —
  die fehlerhafte Zeile wurde entfernt; nachfolgender Build grün.
- **Dev-Cockpit-Status:** unverändert intakt auf `origin/main` (byte-identisch
  zu `154f8fce`), Teil des grünen Builds.

---

**Fazit: Phase 2 ist vollständig, getestet und produktiv — inkl. Status-Visualisierungs-Upgrade. ✅**
