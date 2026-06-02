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

### Nachbesserung (2026-06-02): Annahmen statt Blockieren

`waiting_for_input` wird jetzt **nur bei echten Blockern** gesetzt (widersprüchliches
Ziel, sicherheitsrelevante/destruktive/Billing-Entscheidung unklar, Wahl zwischen
stark unterschiedlichen Produktrichtungen, fehlende externe Credentials). Normale
Unklarheiten (genaue Datei unbekannt, SQL vs. TS, kleine Design-/Responsive-Details,
Datenstruktur erst prüfen, optionale Zusatzanzeige) führen **nicht** mehr zu
Rückfragen — der Agent trifft plausible **Annahmen**, listet sie im neuen Build-Plan-
Abschnitt **„Annahmen"** und setzt trotzdem `ready_to_build = true` → `waiting_for_start`.
`BuildPlan` hat dafür ein neues Feld `assumptions: string[]` (nur in `plan_text`-JSON,
keine DB-Migration). Antwortsprache folgt dem User (DE bei DE, EN bei EN). Build-Plan-
Reihenfolge: Summary · Betroffene Bereiche · Vermutete Dateien · Annahmen · Risiken ·
Offene Fragen (nur falls echter Blocker).

### Nachbesserung (2026-06-02): Destructive/Billing-Safety-Gate

Gegenstück zur Annahmen-Lockerung: **destruktive Tasks müssen immer blocken.**
Ein **SAFETY OVERRIDE** im System-Prompt (Vorrang vor „default to planning") plus
ein **harter, deterministischer serverseitiger Gate** in `devCockpitAnalysis.ts`,
der **unabhängig vom Modelloutput** greift (nach dem Mistral-Call als Post-Processing):

- `isTaskDestructive(text)` blockt, wenn der **gesamte Text** (Titel + Prompt +
  **komplette Chat-History** + Queue-Notes) **(destructive verb) UND (sensitive
  target)** enthält — verb/target-Listen wortgenau (Lookbehind verhindert z. B.
  „db" in „feedback"). Zusätzlich **hardcoded** der Testfall „Lösche alle Nutzer
  ohne aktive Zahlung aus der Datenbank".
- `enforceSafetyBlock(plan, text)` erzwingt dann `ready_to_build = false`
  (→ `waiting_for_input`) und merged die **Pflicht-Sicherheitsfragen** in `questions`.
- Assistant-Message enthält „🔒 Benötigt Sicherheitsfreigabe / Definition vor Build"
  und **nie** „Bereit für Start Build".
- `runSafetyGateSelfTest()` (exportiert) prüft verifizierbar: destruktiv DE/EN →
  blocked, „Delete-Button für einzelne Notizen" → nicht blocked.

Bewusst eng: ein Verb **ohne** sensibles Target (z. B. „Delete-Button für Notizen")
blockt nicht.

**Scope-Fix (2026-06-02):** Der Gate scannt jetzt **ausschließlich user-authored
Current-Task-Inhalt** — `title` + `prompt` + nur die **`user`**-Messages dieser
task_id + queued notes dieser task_id. **Assistant-/System-Outputs werden nie
gescannt** (sie enthalten alte Analysen / bereits injizierte Safety-Fragen mit
„Nutzer/Zahlung/Löschung" bzw. Pläne, die legitim „delete users" erwähnen).
Vorher trippte das beim Re-Analyze den Gate erneut und leakte Safety-Fragen in
harmlose Tasks (Self-Contamination). Nie wird Kontext anderer Tasks geprüft;
`plan_text` fließt nicht in die Analyse. `runSafetyGateSelfTest()` deckt den
Rollen-/Berechtigungs-Fall (nicht destruktiv) zusätzlich ab.

**Question-Filter-Fix (2026-06-02):** Der Scope-Fix verhinderte nur die
deterministische *Injektion*. Das **Modell** echo'te die alten Safety-Fragen aber
weiter aus der Assistant-History in seinem `questions`-Output → erneut
`waiting_for_input`. Jetzt filtert der Gate bei **nicht-destruktivem** Kontext
destruktive Safety-Fragen deterministisch aus dem finalen Plan heraus
(`filterOutDestructiveSafetyQuestions()`, Phrasen-basiert DE+EN: „aktive Zahlung",
„Dry Run", „Preview", „welche Tabellen", „Backup", „Export vor Löschung",
„batchweise", „Audit Log", „Wer darf diese Aktion auslösen", „no active payment",
„backup before deletion", „affected tables" …). Wenn das Entfernen die einzigen
Blocker leert → `ready_to_build = true` (→ `waiting_for_start`, **keine** 🔒-Message).
Echte (nicht-destruktive) Fragen bleiben erhalten. Safety-Fragen erscheinen
**ausschließlich**, wenn `isTaskDestructive(currentUserAuthoredContext)` true ist.

### Infrastruktur (2026-06-02): separate AI-Keys + Usage-Tracking-Prep

Dev-Cockpit-AI nutzt jetzt einen **eigenen Credential-Bucket**, getrennt von der
user-facing Glev-AI — für separate Kostenverfolgung. **Kein** Verhaltens-/Prompt-/
Logik-Change.

- `getDevCockpitMistralKey()` (in `lib/ai/mistralClient.ts`): nutzt
  `MISTRAL_DEV_COCKPIT_API_KEY`, sonst Fallback `MISTRAL_API_KEY`, sonst klare
  Fehlermeldung. `getDevCockpitMistralClient()` baut den Client damit; die Analyse
  ruft jetzt diesen statt `getMistralClient()`.
- Alle übrigen Glev-Features bleiben auf `MISTRAL_API_KEY`.
- `lib/ai/aiUsageLog.ts`: leichter `logAiUsage()`-Helper (noch **keine** DB) —
  zentralisiert `source = "dev_cockpit"` (+ Modell, Tokens, Dauer, ok). Vorbereitung
  für späteres `ai_usage_logs`. Keine Secrets/Bodies geloggt.
- `.env.example` dokumentiert `MISTRAL_API_KEY`, `MISTRAL_DEV_COCKPIT_API_KEY`,
  `DEV_COCKPIT_ANALYSIS_MODEL`.

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

### UX-Fix (2026-06-02): Analyse-Persistenz beim Task-Wechsel + Glev-Icon-Status

- **Race-Condition / Cross-Task-Leak behoben:** `loadTaskDetail()` verwirft jetzt
  veraltete Antworten via `activeTaskIdRef` (eine langsame Lade-Antwort einer
  früheren Task überschreibt nicht mehr die aktuelle). Beim Task-Wechsel werden
  `messages/queue/attachments` sofort geleert → kein Aufblitzen fremder Daten.
- **Analyse bleibt persistent:** Build-Plan-Card + Status werden aus der **Task-Row**
  (`plan_text`/`status`) gerendert, nie aus globalem Lade-State → stabil beim
  Wechsel und nach Browser-Reload. `analyzeTask` aktualisiert die Row by-id (auch
  wenn der User weggewechselt hat).
- **Sidebar-Status-Icons aus dem bestehenden Glev-Logo** (`components/GlevLogo`):
  analyzing/planning/building → rotierendes Glev-Icon (Glev-Blau `#4F6EF7`, 2,6 s
  linear infinite, leichter Glow); `waiting_for_input` → statisch gelb;
  `waiting_for_start`/`preview_ready` → statisch grün; `applied` → grüner Check;
  `rejected` → rotes X; `cancelled` → graues X; draft/archived/backlog → statisch
  grau. Mehrere Tasks können gleichzeitig rotieren (`analyzingIds`-Set). Der globale
  „lädt…"-Hinweis bleibt sekundär.

### Responsiveness-Fix (2026-06-02): Analyse blockiert die UI nicht mehr

Zwei Ursachen behoben: (1) ein **globaler `useTransition`/`isPending`** sperrte
alle Buttons, sobald *irgendeine* Action lief; (2) **Next.js serialisiert Server
Actions** → der lange `analyzeTask`-Action blockierte Cancel/Archive/Reads bis er
fertig war.

- **Analyze läuft jetzt über einen Route-Handler** (`POST /glev-ops/dev-cockpit/api/analyze`,
  via `fetch`) statt als Server Action → **raus aus der Server-Action-Queue**, echt
  parallel, blockiert nichts. Logik extrahiert nach `lib/devCockpit/performAnalyze.ts`
  (gleiche Analyse + Safety-Gate); der `analyzeTask`-Server-Action delegiert nur noch
  dorthin. Route liegt unter `/glev-ops`, damit das Admin-Cookie mitgesendet wird.
- **Globaler `useTransition` entfernt** → **task-/action-spezifische Pending-States:**
  `analyzingIds` (mehrere Tasks rotieren parallel), `actionPendingByTaskId`
  (Cancel/Archive/Backlog pro Task), sowie unabhängige `creating`/`queueing`/`answering`
  für die Composer-Buttons. Nur der jeweils betroffene Button ist „busy".
- Task-Wechsel, New Task, Cancel/Archive/Backlog, Prompt-/Queue-/Antwort-Eingabe
  reagieren **sofort**, auch während eine Analyse läuft. Der globale Hinweis zeigt nur
  noch „Analyse läuft…" (sekundär, blockiert nichts).

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
