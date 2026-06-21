# Legacy AI Removal Plan
**Branch**: `refactor/remove-legacy-ai`
**Phase 1 Diagnose completed**: 2026-06-19
**Status**: Awaiting Lucas-GO for Phase 2

---

## Exec Summary

Diagnostic sweep found **one truly dead file** (safe immediate removal) and **two distinct legacy code paths** (need Lucas GO before touching). The Glev AI Chat stack (Mistral + `/api/ai/chat`) and the voice intent pipeline (Voxtral + classify-intent) are both ACTIVE and must not be touched.

The reported bugs (settings/ai blank, engine Macros-Prüfen unresponsive) are likely caused by `consentLoaded` not being checked in the engine page guards — the old voice UI flashes and potentially blocks rendering for consented users during the consent-fetch window.

---

## 1. Dead Code — Safe to Remove in Phase 2

### 1.1 `components/AiHelperSheet.tsx`
**Classification**: Dead  
**Why**: Phase 1 placeholder for the "Frag Glev" chat sheet. Replaced by `GlevAIChatSheet` in Phase 2 (DECISIONS.md D-013). Layout.tsx already carries the comment: *"The Phase-1 'Coming soon' toast + the placeholder AiHelperSheet render were dropped"*. Zero imports across the entire codebase.  
**Callers**: None.  
**Risk**: Zero.

---

## 2. Flash-of-Old-UI Root Cause

### 2.1 Engine page `consentLoaded` gap
**Files**: `app/(protected)/engine/page.tsx` (lines ~2859, ~2911, ~3951), `lib/useGlevAI.ts`

The engine page suppresses its old voice UI with `!glevAiConsented`. But `consentGranted` starts as `false` in `useGlevAI` and only flips to `true` after the Supabase `profiles` fetch completes (`consentLoaded = true`). During that window the old voice button + `EngineChatPanel` are shown even for fully-consented Glev AI users.

**Current guards (broken)**:
```tsx
{!isMobile && !glevAiConsented && <VoiceStartButton />}     // line ~2859
{isMobile && !glevAiConsented && chatPanelNode}              // line ~2911
{!isMobile && aiVoiceEnabled && !glevAiConsented && <aside>} // line ~3951
```

**Fix** (Phase 2 — low risk):
1. `useGlevAI` already returns `consentLoaded`; it just isn't being read in the engine page.
2. Destructure `consentLoaded` from `useGlevAIContext()` in the engine page.
3. Change guards to: `consentLoaded && !glevAiConsented` → only show old UI when we KNOW consent is absent, not while we're still fetching.

**Related to engine Macros-Prüfen-Button bug**: when the old voice UI flashes in, it may shift layout or interfere with the Step 1 → Step 2 transition button (`btn_advance_to_macros`, line ~2935). The button relies on `hasUsedVoice || anyMacro` being true after a voice/chat parse. If the EngineChatPanel renders unexpectedly it could consume layout and cause the button to be invisible or unresponsive.

---

## 3. Borderline Legacy — Need Lucas GO

### 3.1 Engine page own voice recording path
**Files**: `app/(protected)/engine/page.tsx` — `startRecording()`, `stopRecording()`, `handleVoice()`, all `recording` / `speechAvail` state (lines ~789–850, ~1415–1655)

This is the OLD voice path: `engine.startRecording → MediaRecorder → /api/transcribe → /api/parse-food → fills macro form`. It is shown only when `!glevAiConsented`. It is entirely separate from the new path (`GlevAIChatSheet → useVoiceIntents → useVoxtral → /api/transcribe/mistral/stream`).

**Lucas said**: FAB no longer routes to legacy. If ALL active users have Glev AI consent (i.e., are on Smart/Pro/Plus or have admin `ai_voice` flag), this path is dead.

**Question for Lucas**: Are there any active free users (no plan, no admin flag) who should still see the old engine voice UI? Or have all users been migrated?

**If YES, keep**: fix only the `consentLoaded` guard (§2.1)  
**If NO, remove**: entire `startRecording` / `stopRecording` / `handleVoice` + all `recording` / `speechAvail` / `transcript` / `voiceErr` state, plus the three JSX blocks

**Removal also requires removing**:
- `/api/transcribe` route (see §3.2)
- `hasUsedVoice` flag and auto-start `?voice=1` effect (lines ~474–520) — these serve the old path
- `voiceCtx.markSpoken()` calls and `voiceRecordingContext` bridge (only used for the engine FAB short-tap logic in the old path)

### 3.2 `/api/transcribe` route (`app/api/transcribe/route.ts`)
**Classification**: Transitional (partially migrated)  
**Why**: The route itself was rewritten to use Mistral internally (already migrated), but it has a TODO comment: *"consolidate with /api/transcribe/mistral after engine-stt-migration verified — separate sprint"*. It is only called by the engine page's `handleVoice`. `useVoxtral` (the active path) calls `/api/transcribe/mistral` and `/api/transcribe/mistral/stream` directly.

**Callers**: `app/(protected)/engine/page.tsx:handleVoice` — only  
**Risk**: Medium. Remove only after §3.1 engine voice path is confirmed dead.

### 3.3 `lib/fabAction.ts` `legacy-navigate` branch
**Classification**: Borderline legacy  
**Why**: Returns `{ type: "legacy-navigate" }` when `aiVoiceEnabled === false`, routing to `/engine?voice=1`. Lucas said FAB no longer routes to legacy. But this fires for any user where `useGlevAIAccess()` is `false` (no plan, no admin flag).

**If all users are now on plans or admin-flagged**: This branch is dead. `resolveFabAction` can be simplified — the `"legacy-navigate"` type removed from the union and the `case "legacy-navigate":` block removed from Layout.tsx.

**If some users are still free**: Keep as safety net.

**Cross-dependency**: Removing the branch means the Layout's `case "legacy-navigate"` handler can also be dropped. `fabAction.ts` has unit tests (`__test__` exports) — those must be updated.

---

## 4. Active Code — DO NOT TOUCH

| File | Why active |
|---|---|
| `app/api/ai/chat/route.ts` | Main Glev AI Chat (Mistral). Primary AI path. |
| `app/api/ai/classify-intent/route.ts` | Called by `lib/ai/intentClassifier.ts` → `useVoiceIntents` → `GlevAIChatSheet`. Restored in `fcc1b95f`. **Do not remove.** |
| `lib/ai/intentClassifier.ts` | Fast-path regex + fallback to classify-intent. Powers voice intent dispatch in the new AI chat. |
| `hooks/useVoiceIntents.ts` | Active wrapper for `GlevAIChatSheet` voice flow. |
| `hooks/useVoxtral.ts` | Hold-to-talk hook. Routes to `/api/transcribe/mistral/stream`. |
| `app/api/transcribe/mistral/route.ts` | REST STT. Used by useVoxtral. |
| `app/api/transcribe/mistral/stream/route.ts` | Streaming STT. Primary path used by useVoxtral. |
| `app/api/ai/consent/route.ts` | Consent management. Active. |
| `app/api/ai/confirm-action/route.ts` | Tool confirmation (write-tool gate). Active. |
| `app/api/ai/upload/route.ts` | Chat attachment upload. Active. |
| `components/GlevAIChatSheet.tsx` | New AI chat UI. |
| `components/GlevAIConsentModal.tsx` | Consent modal. |
| `components/GlevAIButton.tsx` | FAB button. |
| `lib/useGlevAI.ts` | Core AI hook. |
| `lib/glevAIContext.tsx` | Shared AI context. |
| `app/api/chat-macros/route.ts` | Meal macro refinement chat (GPT). Active — called by `EngineChatPanel`. |
| `components/EngineChatPanel.tsx` | Food parsing chat panel. Active feature. |
| `lib/nutrition/parseFood.ts` | GPT food text parser. Core nutrition pipeline. |
| `lib/nutrition/estimate.ts` | GPT fallback nutrition estimator. T1D safety contract. |
| `lib/macroEnrich.ts` | GPT enrichment for Google Sheets import. Active. |
| `lib/ai/openaiClient.ts` | Shared OpenAI client. Multiple active callers. |
| ~~`app/api/telegram/webhook/route.ts`~~ | ~~Telegram bot STT (OpenAI Whisper). Separate feature.~~ — **entfernt 2026-06-20** |

---

## 5. settings/ai "hängt + leer" — Hypothesis

The settings/ai page returns `null` while `glevAiAccess === null`. `useGlevAIAccess()` returns null while `usePlan().loading` is true OR `useFeatureFlag("ai_voice")` is null. If either check hangs, the page stays empty.

**Not caused by legacy AI code.** Likely a `usePlan` / `useFeatureFlag` loading-state issue. Investigate separately.

---

## 6. Removal Order (Phase 2, after GO)

1. `components/AiHelperSheet.tsx` — no deps, zero risk ✅
2. Engine page `consentLoaded` guard fix (§2.1) — low risk, fixes Flash, possibly fixes Macros-Prüfen bug
3. If Lucas confirms engine voice path is dead:
   a. Engine page: remove `startRecording`, `stopRecording`, `handleVoice`, `recording`, `speechAvail`, `voiceErr`, `transcript` state, voice section JSX, `?voice=1` auto-start effect, `hasUsedVoice` flag
   b. `app/api/transcribe/route.ts` — after engine page removal confirmed
   c. `lib/fabAction.ts` `legacy-navigate` + `case "legacy-navigate"` in Layout — after confirming no free users still exist

---

## 7. Cross-Dependency Map

```
GlevAIChatSheet
  └── useVoiceIntents
        ├── useVoxtral → /api/transcribe/mistral/stream ← KEEP
        └── classifyIntent (lib/ai/intentClassifier)
              └── /api/ai/classify-intent (GPT-4o-mini fallback) ← KEEP

engine/page.tsx [OLD PATH — borderline dead]
  └── startRecording → handleVoice → /api/transcribe ← candidate for removal
                                   → /api/parse-food (active, shared with other flows)

lib/ai/openaiClient.ts callers (all ACTIVE):
  - /api/ai/classify-intent
  - /api/ai/chat
  - /api/chat-macros
  - lib/macroEnrich.ts
  - lib/nutrition/parseFood.ts
  - lib/nutrition/estimate.ts
  - ~~app/api/telegram/webhook/route.ts (Whisper transcription)~~ — **entfernt 2026-06-20**
```

---

**Action needed from Lucas**: Go/No-go on §3.1 engine voice path and §3.3 fabAction legacy-navigate. Answer: "Are there any users who should still see the old engine voice UI?"
