# Sprint Y Status Report

**Datum:** 2026-06-21  
**Branch:** diagnose/sprint-y-status  
**Scope:** Zwei offene Issues aus Sprint Y — Engine-Page-leer + Chat-Verlauf-Persistenz

---

## Issue 1: Engine-Page Direktaufruf

### Aktueller Render-Zustand: LEER (für Glev-AI-konsente User)

Die Engine-Page rendert auf Step 0 (ESSEN-Tab) für **consented Users** ein leeres schwarzes Panel.

**Verantwortlicher Code-Pfad:** `app/(protected)/engine/page.tsx:2539`

```tsx
// Zeile 2539 — Mobile
{isMobile && consentLoaded && !glevAiConsented && chatPanelNode}

// Zeile 3579 — Desktop Sidebar
{!isMobile && aiVoiceEnabled && consentLoaded && !glevAiConsented && (
```

Beide Render-Sites für `chatPanelNode` (= `EngineChatPanel`, der legacy AI-Food-Parser) sind auf `!glevAiConsented` gegattet. Sobald der User AI-Consent hat, ist kein Replacement inline. Step 0 zeigt dann:
- Einen leeren `<div>` Container mit Cockpit-CSS
- Den "Weiter zu Makros" Button — aber nur wenn `anyMacro === true` (Carbs/Protein/Fat/Fiber > 0), was beim direkten Aufruf immer false ist
- Kein Chat-Input, kein Mikrofon, kein Placeholder

Die `GlevAIChatSheet` läuft als globales Sheet aus `LayoutInner` — sie wird auf `/engine` nicht inline in Step 0 eingebettet.

### Git-Log-Aktivität auf engine/page.tsx seit PR #7

| Commit | Wirkung |
|---|---|
| `3955eb87` Hide legacy chat panel when Glev AI is activated | **Ursache des Bugs**: `chatPanelNode` auf `!glevAiConsented` gegattet, kein Replacement für consented User |
| `ab11c050` fix(engine): gate old voice/chat UI on consentLoaded | Verhindert Flash-of-Old-UI während Supabase-Fetch; Bug selbst bleibt |
| `e253701d` refactor(engine): remove legacy MediaRecorder voice path | Legacy-Voice-Code raus, keine Auswirkung auf dieses Issue |
| `91f03be6` refactor(ai): Phase 3 cleanup | VoiceRecordingContext entfernt; Step-0-Problem bleibt |
| `8696e425` fix(ai): persist mini-preview until save + re-open path from chat | engine_opened-State-Handling; kein Fix für Step-0-Leerstand |

### Verdikt: OFFEN

Der Bug ist nicht durch einen anderen Sprint mitgefixed worden. Die Render-Kondition `!glevAiConsented` existiert unverändert. Für Lucas (Glev AI konsent aktiv) ist Step 0 leer.

**D-025** (Entscheidung vom 2026-06-05) sagt: FAB-Tap navigiert zu `/glev-ai`, nicht `/engine`. Aber der **Bottom-Nav-Glev-Tab** zeigt direkt auf `/engine` — daher trifft Lucas diesen leeren Step 0.

### Empfehlung

**Sprint Y starten.** Fix-Scope ist eng:

Option A (einfachste): `app/(protected)/engine/page.tsx:2539` — für consented User in Step 0 statt `chatPanelNode` die `GlevAIChatSheet variant="fullscreen"` inline rendern (oder ein `<Link href="/glev-ai">` Redirect-Banner).

Option B: Bottom-Nav-Glev-Tab für consented User auf `/glev-ai` umbiegen statt `/engine`. Prüfen in `components/Layout.tsx` welcher href für den Glev-Tab steht.

---

## Issue 2: messages-Persist über App-Sessions

### Aktueller Persist-Layer: sessionStorage `"glev_ai_history_v1"`

**Kein localStorage** — nur sessionStorage. Das ist der Root Cause.

**Code-Pfad:** `lib/useGlevAI.ts`

```ts
// Zeile 173
const HISTORY_KEY = "glev_ai_history_v1";

// Zeile 181 — Read (sessionStorage!)
const raw = window.sessionStorage.getItem(HISTORY_KEY);

// Zeile 216 — Write (sessionStorage!)
window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
```

### Hydrate-on-Mount: ja

```ts
// Zeile 279 — Mount-Effekt
useEffect(() => {
  setMessages(safeReadHistory()); // liest sessionStorage
  // ... Supabase consent check
}, []);
```

### Write-on-Change: ja, kein Debounce

```ts
// Zeile 313
useEffect(() => {
  safeWriteHistory(messages);
}, [messages]);
```

Kein Debounce, kein Throttle. Jedes messages-Update → sofortiger Write.

### Cap auf max-messages: ja — MAX_HISTORY = 10

`safeWriteHistory` trimmt auf die letzten 10 Nachrichten und stripped dabei:
- `isStreaming` Feld
- Canceld/confirmed pendingActions (verbleiben nur `pending` + `engine_opened`)
- Normalisiert `confirming → pending` (für mid-flight Chips nach Reload)

### Was `safeWriteHistory` NICHT persistiert

Die vollständigen `GlevChatMessage`-Felder `retryAllowed` und vollständige `pendingActions` (nur Non-Terminal-Chips). Das ist bewusstes Design.

### Verdikt: OFFEN

Die GANZE messages-Liste überlebt keine App-Sessions weil `sessionStorage` bei iOS-App-Kill (Recents-Swipe-Up = WKWebView-Session-End) geleert wird. Es ist nicht ein Bug im Write/Read-Mechanismus — der ist korrekt implementiert — sondern der falsche Storage-Typ.

**PR #10 Mini-Preview** (`8696e425`) hat `safeWriteHistory` um `engine_opened`-State-Erhaltung erweitert (damit Meal-Chips nach Page-Refresh nicht verloren gehen), aber an `sessionStorage` vs `localStorage` nichts geändert.

### Was fehlt

Einzige Änderung nötig: in `safeReadHistory()` und `safeWriteHistory()` `window.sessionStorage` → `window.localStorage` ersetzen.

Optionale Ergänzung: Content-Cap in Bytes (z.B. 50 KB) wegen localStorage-Quota auf mobilen iOS-Geräten (typisch 5–10 MB gesamt). Mit MAX_HISTORY=10 und durchschnittlich ~500 Zeichen/Nachricht sind das ≈5 KB — unkritisch.

### Empfehlung

**Sprint Y starten.** 2-Zeilen-Fix in `lib/useGlevAI.ts`. Key-Name kann bleiben (`glev_ai_history_v1` — nicht mit Session zu verwechseln, es ist nur ein String). Evtl. Version auf `v2` bumpen um alte sessionStorage-Einträge nicht aufzugreifen beim ersten App-Öffnen nach dem Deploy.

---

## Gesamt-Empfehlung

**Sprint Y starten: JA**

Beide Issues sind **OFFEN** und wurden von keinem anderen Sprint mitgefixed.

### Kompakter Fix-Scope

| # | File | Änderung | Aufwand |
|---|---|---|---|
| 1a | `app/(protected)/engine/page.tsx:2539` | Für `glevAiConsented=true` in Step 0 entweder GlevAIChatSheet inline rendern ODER | ~30 min |
| 1b | `components/Layout.tsx` | Bottom-Nav-Glev-Tab für consented User → `/glev-ai` statt `/engine` | ~10 min |
| 2 | `lib/useGlevAI.ts:181,216` | `sessionStorage` → `localStorage`, Key-Version bump | ~5 min |

**Empfohlene Lösung für Issue 1:** Option 1b (Bottom-Nav umbiegen) ist einfacher und konsistenter mit D-025. Dann braucht `/engine` kein inline-Chat-Embed.

**Für Issue 2:** localStorage-Swap in `safeReadHistory` + `safeWriteHistory`. Key auf `glev_ai_history_v2` bumpen.

**Nicht nötig:** Kein neuer Sprint-Branch, keine neuen Features. Beide Fixes sind Bugfixes auf bestehendem Code.
