# Voice Transcribe Residuals — Diagnose nach Legacy Rip-Out (PR #7)

**Branch:** `diagnose/voice-residual`  
**Datum:** 2026-06-20  
**Scope:** Grep-Scan auf `transcribe`, `startRecording`, `handleVoice`, `VoiceRecording`, `voice=1`, `AiHelperSheet`, `openai429`, `whisper`, `speech_recognition`/`speechRecognition`, `mic`  
**Ausgeschlossen:** `.git/`, `node_modules/`, `.next/`, `dist/`, `ios/App/Pods/`

---

## Zusammenfassung

| Kategorie | Befund |
|---|---|
| DEAD-Datei | `lib/voiceRecordingContext.tsx` (exportiert, niemand importiert) |
| BROKEN-Test | `tests/unit/sttVoxtralFilename.test.ts` crasht wegen fehlendem `app/api/transcribe/route.ts` |
| Dead i18n | 10 Keys in `log`-Namespace + 7 Keys in `engine`-Namespace ohne Consumer |
| Dead Comments | 2 Inline-Comments in Layout.tsx (harmlos, kein broken Code) |
| LIVE | Gesamte Voxtral-Pipeline (`useVoxtral`, `/api/transcribe/mistral/*`, GlevAIChatSheet-Mic) intakt |

---

## 1. `transcribe`

### LIVE — Aktive Voxtral-Endpoints
| Datei | Zeile | Kontext |
|---|---|---|
| `app/api/transcribe/mistral/route.ts` | 44, 76 | POST-Handler für REST-Fallback STT |
| `app/api/transcribe/mistral/stream/route.ts` | 76 | POST-Handler für SSE-Streaming STT |
| `hooks/useVoxtral.ts` | 46–47 | `STT_STREAM_ROUTE` + `STT_REST_ROUTE` Konstanten |
| `hooks/useVoxtral.ts` | 98, 355 | `transcribeWithFallback` — aktive Kernfunktion |

### LIVE — Telegram Bot (Whisper-1, unabhängig vom Legacy-Rip-Out)
| Datei | Zeile | Kontext |
|---|---|---|
| `app/api/telegram/webhook/route.ts` | 196 | `async function transcribeVoice(...)` via OpenAI whisper-1 |
| `app/api/telegram/webhook/route.ts` | 444 | `inboundText = await transcribeVoice(buffer, mimeType)` |

### LIVE — Tests für aktive Voxtral-Pipeline
| Datei | Scope |
|---|---|
| `tests/unit/voxtralStream.test.ts` | `transcribeWithFallback` SSE + REST-Fallback Tests |
| `tests/unit/sttTimeout.test.ts` | STT-Timeout-Tests für `transcribeWithFallback` |
| `tests/e2e/mic-button-hold-to-talk.spec.ts` | E2E Hold-to-Talk, interceptiert `/api/transcribe/mistral/*` |
| `tests/e2e/stt-error-banner.spec.ts` | STT-Error-Banner, interceptiert `/api/transcribe/mistral/stream` |

### DEAD — Broken Test (RUNTIME CRASH)
| Datei | Zeile | Klassifikation |
|---|---|---|
| `tests/unit/sttVoxtralFilename.test.ts` | 23–25 | **DEAD → Crash** |

```ts
// Zeile 23–25:
const MAIN_ROUTE_SRC = readFileSync(
  join(process.cwd(), "app/api/transcribe/route.ts"),
  "utf-8",
);
```

**Problem:** `app/api/transcribe/route.ts` wurde in PR #7 gelöscht. Der `readFileSync`-Aufruf liegt auf Modul-Top-Level — der Test-Runner crasht beim Laden des Moduls mit `ENOENT`. Alle 14 Tests in dieser Datei schlagen fehl.

**Betroffen:** Tests auf Zeilen 38, 56, 73, 106 (alle `"transcribe (main route): ..."` Varianten) sind direkt dead; die anderen Tests scheitern kollateral wegen des Top-Level-Crashes.

**Fix:** Entweder `MAIN_ROUTE_SRC` + alle 6 "main route"-Tests entfernen, oder Datei komplett löschen falls die verbleibenden Tests durch `voxtralStream.test.ts` doppelt abgedeckt sind.

---

## 2. `startRecording`

| Datei | Zeile | Klassifikation |
|---|---|---|
| `app/mockups/dark-cockpit/page.tsx` | 613, 1566 | **LIVE (Mockup-intern)** |

Die Mockup-Seite definiert `startRecording` lokal als Self-contained-Funktion — kein Import des gelöschten Engine-Codes. Gehört zur Mockup-Standalone-Logik, kein Cleanup nötig.

---

## 3. `handleVoice`

Keine Treffer. Vollständig entfernt in PR #7. ✅

---

## 4. `VoiceRecording` / `VoiceRecordingContext`

### DEAD — Orphaned File
| Datei | Klassifikation |
|---|---|
| `lib/voiceRecordingContext.tsx` | **DEAD → kann weg** |

Die Datei exportiert `VoiceRecordingProvider`, `useVoiceRecording`, `VoiceRecordingState`. Grep über das gesamte Repo zeigt: kein einziger Import dieser Datei existiert mehr. DECISIONS.md (2026-06-19) bestätigt explizit: *"lib/voiceRecordingContext.tsx (exportiert aber nicht mehr importiert)"*.

Hintergrund: Der Context war der Cross-Screen-Bridge zwischen Engine-Recording und dem globalen FAB/Header-"Speak"-Pill. Beide wurden in PR #7 entfernt. `GlevAIChatSheet.tsx` implementiert sein eigenes Tap-Anywhere-to-Stop (Zeile 1417) ohne diesen Context.

**Fix:** `lib/voiceRecordingContext.tsx` löschen.

---

## 5. `voice=1`

| Datei | Zeile | Klassifikation |
|---|---|---|
| `components/Layout.tsx` | 311 | **DEAD Comment** — harmlos |
| `tests/unit/fabAction.test.ts` | 8–9 | **LIVE Comment** — erklärt Bugfix-Hintergrund |

```ts
// Layout.tsx:311 — Kommentar in runFabShortTap():
// Falls back to the legacy /engine?voice=1 route.
```

Kein ausgeführter Code — nur Dokumentation des entfernten Fallback-Verhaltens. Kein Handlungsbedarf.

---

## 6. `AiHelperSheet`

| Datei | Zeile | Klassifikation |
|---|---|---|
| `components/Layout.tsx` | 1379 | **LIVE Comment** — dokumentiert Removal |

```tsx
{/* Phase-1 "Coming soon" toast + the placeholder AiHelperSheet
    render were dropped — see DECISIONS.md D-013. */}
```

Erklärt warum der Code weg ist. Kein Handlungsbedarf.

---

## 7. `openai429`

Keine Treffer. Vollständig entfernt (inkl. `tests/unit/openai429.test.ts` laut DECISIONS.md). ✅

---

## 8. `whisper`

| Datei | Zeile | Klassifikation |
|---|---|---|
| `app/api/telegram/webhook/route.ts` | 194, 216 | **LIVE** |

```ts
// Zeile 194:
* Transkribiert eine Audio-Datei via OpenAI Whisper (whisper-1).
// Zeile 216:
    model: "whisper-1",
```

Telegram-Bot-Transcription, unabhängig vom Legacy-Voice-Rip-Out. Aktiv und korrekt.

---

## 9. `speech_recognition` / `speechRecognition`

Keine Treffer. Vollständig entfernt. ✅

---

## 10. `mic` (kontextabhängig)

### LIVE — Aktive Voice-Pipeline
| Datei | Klassifikation |
|---|---|
| `hooks/useVoxtral.ts` | LIVE — Mic-Permission-Check, Indicator, Rate-Limit-Label |
| `components/GlevAIChatSheet.tsx` | LIVE — Mic-Button (`data-glev-mic`), Tap-to-Stop-Logic |
| `lib/ai/sttRateLimiter.ts` | LIVE — Rate-Limiter für STT/Mic-Taps |
| `components/Layout.tsx:183` | LIVE — Comment: `aiThinking` während STT-Mic aktiv |

### LIVE — Tests
| Datei | Klassifikation |
|---|---|
| `tests/e2e/mic-button-hold-to-talk.spec.ts` | LIVE — E2E für Hold-to-Talk Mic-Button |
| `tests/e2e/stt-error-banner.spec.ts` | LIVE — Mic-Button + Error-Banner-Tests |
| `tests/e2e/footer-nav-audit.spec.ts:230,265` | LIVE — `context.grantPermissions(["microphone"])` Setup |
| `tests/e2e/tts-speaker-and-autoread.spec.ts` | LIVE — referenziert Mic-Spec Pattern |

### LIVE — Marketing/Mockup
| Datei | Klassifikation |
|---|---|
| `app/mockups/dark-cockpit/page.tsx:638` | LIVE (Mockup SpeechRecognition-Stub) |
| `components/AppMockupPhone.tsx` | LIVE — Mockup Mic-State-Machine |
| `playwright.config.ts:43` | LIVE — Kommentar über Mic-Pulse-Animation |

---

## 11. Dead i18n Keys

### `log`-Namespace — 10 Dead Keys

`EngineChatPanel.tsx` und `AppMockupPhone.tsx` nutzen zwar `useTranslations("log")`, aber keiner der folgenden Keys wird aufgerufen. Alle gehörten zur alten Engine-SpeechRecognition-Maske.

| Key | `messages/en.json` Zeile | `messages/de.json` Zeile | Klassifikation |
|---|---|---|---|
| `log.hint_speak_or_type` | ~130 | ~130 | **DEAD** |
| `log.listening` | ~131 | ~131 | **DEAD** |
| `log.tap_to_speak` | ~132 | ~132 | **DEAD** |
| `log.voice_unavailable` | 133 | 133 | **DEAD** |
| `log.voice_unsupported` | 134 | 134 | **DEAD** |
| `log.voice_example` | 135 | 135 | **DEAD** |
| `log.voice_aria_start` | 136 | 136 | **DEAD** |
| `log.voice_aria_stop` | 137 | 137 | **DEAD** |
| `log.speak` | ~138 | ~138 | **DEAD** |
| `log.error_mic_unavailable` | 226 | 226 | **DEAD** |

### `engine`-Namespace — 7 Dead Keys

Die `engine.voice_btn_*` und `engine.voice_aria_*` Keys sind LIVE (AppMockupPhone.tsx). Die folgenden Error-Keys haben keinen Consumer mehr — sie gehörten zum alten Engine-SpeechRecognition-Error-Handling.

| Key | Klassifikation |
|---|---|
| `engine.voice_err_no_speech` | **DEAD** |
| `engine.voice_err_mic_denied` | **DEAD** |
| `engine.voice_err_network` | **DEAD** |
| `engine.voice_err_processing_failed` | **DEAD** |
| `engine.voice_unavailable_hint` | **DEAD** |
| `engine.voice_mic_failed` | **DEAD** |
| `engine.voice_chat_no_macros` | **DEAD** |

### `engine`-Namespace — LIVE Keys (zum Abgleich)

| Key | Consumer |
|---|---|
| `engine.voice_btn_speak` | `AppMockupPhone.tsx:1006`, E2E-Specs |
| `engine.voice_btn_stop` | `AppMockupPhone.tsx:1003` |
| `engine.voice_btn_processing` | `AppMockupPhone.tsx:1005` |
| `engine.voice_aria_start` | `AppMockupPhone.tsx:1045`, `engine-chat-sidebar.spec.ts:64` |
| `engine.voice_aria_stop` | `AppMockupPhone.tsx:1045` |

---

## Cleanup-Checkliste (nach Lucas-Review)

| Prio | Aktion | Datei(en) |
|---|---|---|
| 🔴 Hoch | BROKEN Test fixen — MAIN_ROUTE_SRC + 6 "main route"-Tests entfernen | `tests/unit/sttVoxtralFilename.test.ts` |
| 🟠 Mittel | Orphaned Context-File löschen | `lib/voiceRecordingContext.tsx` |
| 🟡 Niedrig | 10 tote `log`-Namespace i18n-Keys entfernen | `messages/en.json`, `messages/de.json` |
| 🟡 Niedrig | 7 tote `engine`-Namespace i18n-Keys entfernen | `messages/en.json`, `messages/de.json` |
| ⚪ Optional | Dead Comments in Layout.tsx bereinigen (harmlos) | `components/Layout.tsx:311` |
