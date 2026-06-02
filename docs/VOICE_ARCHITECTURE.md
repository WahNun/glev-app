# Glev Voice Architecture — Backlog Design

> **Status:** Backlog — not yet implemented. This document captures the intended
> architecture so future agents can implement consistently without re-design.

---

## 1  What exists today (as of 2026-06-02)

| Layer | File | Role |
|---|---|---|
| Microphone + transcription | `hooks/useVoxtral.ts` | Records audio, sends to `/api/voxtral`, returns raw transcript string |
| Chat pipeline | `components/GlevAIChatSheet.tsx` + `hooks/useGlevAI.ts` | Sends transcript as free-text user message; Mistral responds with prose + optional tool calls |
| Tool execution | `lib/ai/glevTools.ts` | Executes write tools (log_meal, etc.) behind a Confirmation-Gate (user must tap to confirm) |
| TTS output | `hooks/useTTS.ts` | Reads AI reply aloud via Voxtral TTS (Mistral) with Web Speech API fallback |

The voice path today:  
**Microphone → Voxtral STT → free-text chat → Mistral → tool call → Confirmation-Gate → save**

---

## 2  Planned: App-Wide Voice Control

### 2.1  Goal

Users should be able to log common T1D events by voice without going through the full chat UI.  
Example: *"4 Einheiten Novorapid"* → opens the insulin log sheet, pre-filled, waits for a single
confirm tap.

### 2.2  Intent types

| Intent key | Example utterance | Target screen / action |
|---|---|---|
| `log_bolus` | "4 Einheiten Novorapid" | `InsulinLogSheet` pre-filled |
| `log_meal` | "Pasta, 80g, 2 Einheiten" | Meal log form pre-filled |
| `log_exercise` | "30 Minuten Radfahren" | Exercise log form |
| `log_symptom` | "Ich fühle mich hypoglykämisch" | Symptom log |
| `edit_macro` | "Korrigiere die Kohlenhydrate auf 60g" | `setMacro` tool via existing Confirmation-Gate |
| `navigate` | "Geh zu Insights" | `navigate` envelope → `useRouter.push` |
| `fallback_chat` | (anything else) | Route to existing free-text chat pipeline |

### 2.3  Confirmation-Gate (non-negotiable)

**No intent that writes data may auto-save without an explicit user tap.**

This is a compliance constraint (D-003): Glev provides *decision support*, not automated insulin
dosing. Every write action opens the relevant log sheet in a pre-filled state and waits for the
user to tap "Speichern".

Read intents (`navigate`, `fallback_chat`) and queries do not need a gate.

### 2.4  Architecture sketch

```
Microphone
   │
   ▼
useVoxtral  (existing — no change)
   │   raw transcript string
   ▼
Intent Classifier   ← NEW  (e.g. lightweight Mistral call or regex heuristic)
   │   IntentEnvelope { type, payload }
   ├── log_bolus   → dispatch glev:open-insulin-log  (existing CustomEvent pattern)
   ├── log_meal    → dispatch glev:open-meal-log
   ├── log_exercise→ dispatch glev:open-exercise-log
   ├── log_symptom → dispatch glev:open-symptom-log
   ├── edit_macro  → glevTools setMacro → existing Confirmation-Gate
   ├── navigate    → router.push (no gate needed)
   └── fallback_chat → existing useGlevAI chat pipeline
```

### 2.5  Where to add each piece

| What | File | Notes |
|---|---|---|
| Intent classification | `lib/ai/intentClassifier.ts` (new) | Small Mistral call with a compact classification prompt; returns `IntentEnvelope`. |
| Intent routing hook | `hooks/useVoiceIntents.ts` (new) | Wraps `useVoxtral`, calls classifier, dispatches CustomEvents or calls GlevTools. |
| Confirmation-Gate | Existing `GlevAIChatSheet.tsx` write-tool confirm flow | Reuse as-is for `edit_macro`; other intents open existing log sheets. |
| Log-sheet pre-fill events | Each log sheet (`EngineLogTab`, `InsulinLogSheet`, …) | Add `window.addEventListener("glev:open-*-log", handler)` to pre-fill form fields. |
| Integration point | `components/VoiceInputButton.tsx` (or FAB voice mode) | Switch from direct-to-chat to `useVoiceIntents` when a feature flag is set. |

### 2.6  Feature flag

Gate the new flow behind `voice_intent_routing` (boolean, default `false`) in `lib/featureFlags.ts`
so it can be rolled out incrementally and disabled if a regression is found.

### 2.7  Accessibility framing

App-wide voice control is primarily an accessibility feature: it reduces the number of taps needed
for users with motor impairments and lets users log data without looking at the screen (e.g. while
eating or exercising). Frame it as such in all user-facing copy.

---

## 3  TTS (Text-to-Speech) — current architecture

All TTS output is centralized through a single pipeline:

```
useTTS.speak(text)
   │
   ├── extractAssistantText(text)   ← strips system-prompt echoes
   │
   ├── POST /api/tts/mistral        ← server-side proxy; loads ref_audio from DB
   │      (Voxtral TTS, primary)
   │
   └── Web Speech API               ← fallback (German voice, DeviceLocal preferred)
```

Key invariants:
- **One instance per app session** — `useTTS` is consumed only in `GlevAIChatSheet`; no second
  instance exists on the Engine/Macro screen.
- **ref_audio loaded server-side** — callers never pass ref_audio; the route reads it from
  `admin_tts_config` on every request. Voice consistency is guaranteed across all screens.
- **Speed controlled client-side via `playbackRate`** — `glev_tts_speed` in `localStorage`
  (`"slow"` → 0.75, `"normal"` → 1.0, `"fast"` → 1.3). Applied to `HTMLAudioElement.playbackRate`
  before `play()` in `useTTS.ts`. Mistral confirmed (2026-06-02) that voxtral-mini-tts-2603 has no
  native speed parameter; the client-side approach works on the already-decoded MP3 across all
  browsers and also on the Web Speech API fallback via `SpeechSynthesisUtterance.rate`.
- **Single fixed style prefix** — the route prepends one German style instruction to every TTS
  input regardless of the `speed` parameter. Three-variant tempo hints (slow/normal/fast) were
  evaluated (2026-06-02): Voxtral's neural vocoder does not respond reliably to text-based pace
  instructions — the slow-hint text and fast-hint text produced no audible difference in speaking
  rate compared to the neutral-tone prompt. Conclusion: `playbackRate` is the only reliable speed
  lever; prompt-based tempo instructions add complexity without measurable benefit and were removed.
- **Persona-leak guard** — `extractAssistantText()` in `useTTS.ts` strips lines matching known
  system-prompt patterns before any text reaches the TTS API.

---

## 4  Related decisions

- **D-003** — Compliance principle: no direct dose instructions; every write action confirmed by user.
